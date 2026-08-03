// The scheduler tick.
//
// Postly used to have a single daily cron that generated every automation's
// whole day in one go and handed the timing to the aggregator. That is why
// posts went missing: one tick a day is one chance a day, a tick that never
// arrived lost the day silently, direct connections could not be handed a time
// at all, and a failure was final.
//
// This runs often and does five small things instead, each of them safe to
// repeat:
//
//   1. sweep  — release slot claims abandoned by a killed run
//   2. generate — make the posts whose slots are due, catching up missed ones
//   3. deliver — publish posts held here for a specific minute
//   4. retry  — re-attempt transient failures on a backoff
//   5. reconcile — read back what the platforms actually did
//
// Every step is bounded by a wall-clock budget so the tick always returns
// rather than being killed mid-flight, and anything it does not finish is
// simply picked up by the next one.

import { query } from './db.js';
import { runAutomation, dueSlots } from './automations.js';
import { publishQueuedPost } from './publishqueued.js';
import { reconcileUser } from './reconcile.js';
import { nextAttemptAt, MAX_ATTEMPTS } from './retry.js';

// Slots are generated slightly ahead of time so the post is ready *at* its
// minute rather than a minute after it: copy plus artwork is not instant.
export const LEAD_MS = 6 * 60000;

// A claim older than this belongs to a run that was killed. Generation itself
// is capped well below this, so nothing live is ever stolen.
const STALE_CLAIM_MS = 12 * 60000;

const HEARTBEAT_KEY = 'scheduler';
const LEASE_KEY = 'scheduler:lease';

// Slack on the lease past the tick's own budget, so a function killed a moment
// before it could release still frees the lease on its own shortly after.
const LEASE_GRACE_MS = 30000;

function remaining(deadline) {
  return deadline - Date.now();
}

// Exclusive right to run a tick, held as a row rather than a session lock.
//
// Three things drive ticks — the GitHub cron, an open browser tab, and the
// "run now" button — and nothing used to stop two of them overlapping. Two
// ticks reaching the delivery step together each picked up the same due post
// and published it, which is how a single slot went out twice within the hour.
//
// A `pg_try_advisory_lock` would not do: `lib/db.js` hands out pooled
// connections, so the session holding the lock is not the session running the
// next statement. A lease row is atomic across pool connections *and* across
// serverless instances, and it expires by itself if the holder is killed.
async function acquireLease(owner, ttlMs) {
  const until = new Date(Date.now() + ttlMs).toISOString();
  const { rows } = await query(
    `INSERT INTO system_state (key, value, updated_at)
     VALUES ($1, jsonb_build_object('owner', $2::text, 'until', $3::text), now())
     ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value, updated_at = now()
       WHERE (system_state.value->>'until')::timestamptz < now()
     RETURNING value`,
    [LEASE_KEY, owner, until]
  );
  return rows.length > 0;
}

// Hand the lease back immediately rather than letting it time out: the next
// driver along should not have to wait out the remainder of a budget this tick
// never needed.
async function releaseLease() {
  await query(
    `UPDATE system_state
        SET value = jsonb_set(value, '{until}', to_jsonb(now()::text)), updated_at = now()
      WHERE key = $1`,
    [LEASE_KEY]
  );
}

// The two transient states a post passes through while one tick owns it. They
// are separate so a claim abandoned mid-flight can be put back where it came
// from: a due post returns to 'scheduled', a retry returns to 'failed' with its
// error message and backoff intact.
const CLAIM_STATUS = { scheduled: 'publishing', failed: 'retrying' };

// 1. Release work claimed by a run that never finished.
//
// A 'generating' row holds a slot key that could otherwise never be made again,
// so it is deleted — nothing of value is in it. A claimed-for-delivery row is
// a finished post that was never sent, so it is restored rather than dropped.
async function sweepStaleClaims() {
  const { rowCount: generating } = await query(
    `DELETE FROM queued_posts
      WHERE status = 'generating'
        AND created_at < now() - ($1 || ' milliseconds')::interval`,
    [String(STALE_CLAIM_MS)]
  );

  let restored = 0;
  for (const [origin, claimed] of Object.entries(CLAIM_STATUS)) {
    const { rowCount } = await query(
      `UPDATE queued_posts SET status = $2, updated_at = now()
        WHERE status = $3
          AND published_post_id IS NULL
          AND updated_at < now() - ($1 || ' milliseconds')::interval`,
      [String(STALE_CLAIM_MS), origin, claimed]
    );
    restored += rowCount || 0;
  }

  return (generating || 0) + restored;
}

// 2. Generate everything due.
//
// Automations are taken least-recently-run first. The old cron walked them in
// id order against a shared budget, so a busy automation near the front could
// consume the whole allowance and the ones behind it were skipped without even
// a log line — an automation that looked enabled and simply never posted.
async function generateDue({ now, deadline, dryRun }) {
  const { rows: automations } = await query(
    `SELECT * FROM automations
      WHERE enabled = true
      ORDER BY last_run_at ASC NULLS FIRST, id
      LIMIT 50`
  );

  const runs = [];
  for (const automation of automations) {
    // A dry run answers "what would happen next" without generating a word or
    // publishing anything — the only safe way to check a live automation's
    // wiring against real connected accounts.
    if (dryRun) {
      const slots = dueSlots(automation, { now, leadMs: LEAD_MS });
      runs.push({
        id: automation.id,
        name: automation.name,
        runStatus: slots.length ? 'would run' : 'nothing due',
        timezone: automation.timezone,
        wouldGenerate: slots.length * (automation.platforms?.length || 0),
        slots: slots.map((s) => ({
          at: s.at.toISOString(), local: `${s.date} ${s.time}`, late: s.late,
        })),
      });
      continue;
    }
    // Leave room to finish at least one post plus the steps that follow.
    if (remaining(deadline) < 20000) {
      runs.push({ id: automation.id, name: automation.name, runStatus: 'deferred' });
      continue;
    }

    const slots = dueSlots(automation, { now, leadMs: LEAD_MS });
    const windowEnd = new Date(now.getTime() + LEAD_MS);

    if (slots.length === 0) {
      // Nothing due: move the watermark up so the next tick does not rescan
      // ground that has been proven empty.
      await query('UPDATE automations SET scheduled_through = $2 WHERE id = $1', [
        automation.id, windowEnd.toISOString(),
      ]);
      continue;
    }

    try {
      const result = await runAutomation(automation, {
        slots,
        trigger: slots.some((s) => s.late) ? 'catchup' : 'cron',
        deadline: Math.min(deadline - 8000, Date.now() + 50000),
      });

      // Only advance past slots this run actually completed.
      const watermark = result.processedThrough
        ? new Date(result.processedThrough)
        : null;
      if (watermark) {
        await query('UPDATE automations SET scheduled_through = $2 WHERE id = $1', [
          automation.id, watermark.toISOString(),
        ]);
      }

      runs.push({
        id: automation.id, name: automation.name,
        runStatus: result.runStatus, detail: result.detail,
        slots: slots.length, ...result.counts,
      });
    } catch (e) {
      await query(
        `UPDATE automations SET last_run_at = now(), last_run_status = 'failed',
                last_error = $2, updated_at = now() WHERE id = $1`,
        [automation.id, e.message.slice(0, 300)]
      );
      runs.push({ id: automation.id, name: automation.name, runStatus: 'failed', detail: e.message });
    }
  }
  return runs;
}

// Returns a claimed post, or null when another tick got there first.
//
// The claim is the whole point: selecting a row and then publishing it left a
// window in which a second tick selected the same row and published it too. The
// status change is the handshake, and SKIP LOCKED means a concurrent claimer
// moves on to the next row instead of blocking on this one.
//
// `where` must not match a row already in a claimed state, so the claim can
// never be taken twice.
async function claimOne(where, params) {
  const { rows } = await query(
    `UPDATE queued_posts SET status = $${params.length + 1}, updated_at = now()
      WHERE id = (
        SELECT id FROM queued_posts
         WHERE ${where.sql}
         ORDER BY ${where.order}
         FOR UPDATE SKIP LOCKED
         LIMIT 1
      )
      RETURNING *`,
    [...params, where.claimStatus]
  );
  return rows[0] || null;
}

// Puts a claim back when the post was not in fact sent, so it is picked up
// again rather than being stranded in a transient state until the sweep.
async function releaseClaim(post, origin) {
  await query(
    `UPDATE queued_posts SET status = $2, updated_at = now()
      WHERE id = $1 AND status = $3`,
    [post.id, origin, CLAIM_STATUS[origin]]
  );
}

// 3. Publish the posts Postly is holding for a specific minute.
//
// Only posts with delivery = 'postly' are ours to send: an aggregator-scheduled
// post already sits on their side with its time, and publishing it here would
// post it twice.
//
// One post is claimed at a time rather than a batch: a batch claimed up front
// and then abandoned on the deadline has to be unwound, and the unwinding is
// exactly the step a killed function skips.
async function deliverDue({ now, deadline }) {
  const where = {
    // A video whose render never finished cannot go out. Excluding it here
    // rather than skipping it in the loop means it is never claimed, so it
    // cannot be left parked in 'publishing' waiting for a sweep.
    sql: `status = 'scheduled'
            AND delivery = 'postly'
            AND published_post_id IS NULL
            AND scheduled_at <= $1
            AND (format <> 'video' OR video_url IS NOT NULL)`,
    order: 'scheduled_at',
    claimStatus: CLAIM_STATUS.scheduled,
  };

  let attempted = 0;
  let published = 0;
  let failed = 0;
  while (remaining(deadline) >= 12000 && attempted < 20) {
    const post = await claimOne(where, [now.toISOString()]);
    if (!post) break;
    attempted++;

    let result;
    try {
      result = await publishQueuedPost(post, { scheduledAt: null });
    } catch (e) {
      await releaseClaim(post, 'scheduled');
      throw e;
    }
    // publishQueuedPost writes the outcome status itself on both paths; the
    // only case it leaves the row alone is one it refused to send.
    if (!result.ok && result.status === 'publishing') {
      await releaseClaim(post, 'scheduled');
    }
    result.ok ? published++ : failed++;
  }
  return { attempted, published, failed };
}

// 4. Retry transient failures.
//
// A publish that failed on a timeout or a 502 used to stay failed forever, so a
// single bad moment cost the post entirely. Those are retried on a growing
// backoff; anything classified permanent is left alone and shown to the user.
async function retryFailed({ now, deadline }) {
  const where = {
    // A row that already carries a remote post id reached the platform once,
    // whatever happened afterwards. Re-sending it would duplicate the post.
    sql: `status = 'failed'
            AND failure_kind = 'transient'
            AND attempts < $2
            AND next_attempt_at IS NOT NULL
            AND next_attempt_at <= $1
            AND (format <> 'video' OR video_url IS NOT NULL)
            AND published_post_id IS NULL`,
    order: 'next_attempt_at',
    claimStatus: CLAIM_STATUS.failed,
  };

  let attempted = 0;
  let recovered = 0;
  while (remaining(deadline) >= 12000 && attempted < 10) {
    const post = await claimOne(where, [now.toISOString(), MAX_ATTEMPTS]);
    if (!post) break;
    attempted++;

    let result;
    try {
      // Retries always publish now: the moment they were scheduled for is gone.
      result = await publishQueuedPost(post, { scheduledAt: null });
    } catch (e) {
      await releaseClaim(post, 'failed');
      throw e;
    }
    if (!result.ok && result.status === 'retrying') {
      await releaseClaim(post, 'failed');
    }
    if (result.ok) recovered++;
  }
  return { attempted, recovered };
}

// 5. Ask the platforms what actually happened, for the users who have had
// activity recently. Without this the dashboard counts requests we sent rather
// than posts that exist.
async function reconcileRecent({ deadline }) {
  const { rows } = await query(
    `SELECT DISTINCT user_id FROM queued_posts
      WHERE published_post_id IS NOT NULL
        AND (remote_status IS NULL OR remote_status = 'pending')
        AND updated_at > now() - interval '3 days'
      LIMIT 25`
  );

  let checked = 0;
  let confirmed = 0;
  for (const row of rows) {
    if (remaining(deadline) < 8000) break;
    try {
      const r = await reconcileUser(row.user_id, { limit: 10 });
      checked += r.checked;
      confirmed += r.confirmed;
    } catch { /* a stale figure beats a failed tick */ }
  }
  return { users: rows.length, checked, confirmed };
}

// Records that the tick ran, so the app can tell "nothing was due" apart from
// "the cron stopped firing" — indistinguishable before, and the reason a
// missed day looked like an automation problem.
async function heartbeat(summary) {
  await query(
    `INSERT INTO system_state (key, value, updated_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = now()`,
    [HEARTBEAT_KEY, JSON.stringify(summary)]
  );
}

export async function readHeartbeat() {
  const { rows } = await query('SELECT value, updated_at FROM system_state WHERE key = $1', [
    HEARTBEAT_KEY,
  ]);
  if (rows.length === 0) return null;
  return { ...rows[0].value, at: rows[0].updated_at };
}

// One full tick. `budgetMs` must stay under the route's own maxDuration.
// `dryRun` reports what the tick would do and changes nothing.
// `source` records which driver fired it — a tick from an open browser tab and
// a tick from a real cron look identical in the heartbeat otherwise, and the
// difference decides whether closing the tab stops the posting.
export async function runSchedulerTick({
  now = new Date(), budgetMs = 240000, dryRun = false, source = 'unknown',
} = {}) {
  const startedAt = Date.now();
  const deadline = startedAt + budgetMs;

  if (dryRun) {
    const automations = await generateDue({ now, deadline, dryRun: true });
    const { rows: due } = await query(
      `SELECT id, platform, scheduled_at FROM queued_posts
        WHERE status = 'scheduled' AND delivery = 'postly'
          AND published_post_id IS NULL AND scheduled_at <= $1
        ORDER BY scheduled_at LIMIT 20`,
      [now.toISOString()]
    );
    const { rows: retryable } = await query(
      `SELECT id, platform, next_attempt_at FROM queued_posts
        WHERE status = 'failed' AND failure_kind = 'transient'
          AND attempts < $2 AND next_attempt_at IS NOT NULL AND next_attempt_at <= $1
        ORDER BY next_attempt_at LIMIT 10`,
      [now.toISOString(), MAX_ATTEMPTS]
    );
    return {
      ok: true, dryRun: true, at: now.toISOString(),
      runs: automations, wouldDeliver: due, wouldRetry: retryable,
    };
  }

  // Only one tick at a time, whichever driver asked for it. Two overlapping
  // ticks used to publish the same due post twice.
  const owner = `${source}:${startedAt}`;
  if (!(await acquireLease(owner, budgetMs + LEASE_GRACE_MS))) {
    return { ok: true, skipped: 'locked', source, at: now.toISOString() };
  }

  try {
    const swept = await sweepStaleClaims();
    const automations = await generateDue({ now, deadline });
    const delivered = await deliverDue({ now, deadline });
    const retried = await retryFailed({ now, deadline });
    const reconciled = await reconcileRecent({ deadline });

    const summary = {
      source,
      swept,
      automations: automations.length,
      generated: automations.reduce((n, r) => n + (r.generated || 0), 0),
      delivered: delivered.published,
      retried: retried.recovered,
      reconciled: reconciled.confirmed,
      failed: automations.reduce((n, r) => n + (r.failed || 0), 0) + delivered.failed,
      ms: Date.now() - startedAt,
    };

    await heartbeat(summary).catch(() => {});

    return { ok: true, ...summary, runs: automations, delivered, retried, reconciled };
  } finally {
    // Never leave the lease held on the way out: an error here would otherwise
    // lock every other driver out until the grace period expired.
    await releaseLease().catch(() => {});
  }
}
