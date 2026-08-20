// Automation execution. Shared by the scheduler tick and the "Run now" button
// so a manual test behaves exactly like a scheduled run.
//
// The unit of work is a *slot*: one automation, one local date, one wall-clock
// time, one platform. Every slot has a stable key, and the database refuses a
// second post for a key it has already seen — which is what makes a retried
// tick, an overlapping "Run now" and a duplicated cron delivery all safe.

import { query } from './db.js';
import { generateContent } from './pipeline.js';
import { withUserKeys } from './keycontext.js';
import { platformSupportsFormat, formatMismatchReason } from './platforms.js';
import { dueSlots, nextRunAt as slotNextRunAt, safeTimezone, normaliseTimes } from './schedule.js';
import { requestRender } from './renderdispatch.js';

export const POST_TYPES = ['promo', 'tips', 'engage', 'mixed'];
export const FORMATS = ['single', 'carousel', 'video'];
export const APPROVALS = ['review', 'auto'];

// Rotating angles keep a daily automation from writing the same post forever.
const ANGLES = [
  'a specific benefit for the buyer',
  'a common problem the product solves',
  'a gift idea framing',
  'a quick tip involving the product',
  'why now is a great moment to try it',
];
const TYPE_ROTATION = ['promo', 'tips', 'engage'];

// Re-exported so callers keep importing scheduling from one place.
export { dueSlots, safeTimezone, normaliseTimes };
export const nextRunAt = slotNextRunAt;

// Generating copy and artwork takes tens of seconds, so a run stops before the
// serverless function is killed rather than being cut off mid-insert.
const SLOT_BUDGET_MS = 55000;

function slotKey(slot, platform) {
  return `${slot.key}|${platform}`;
}

// The connected account for one platform, or null.
async function connectionFor(userId, platform) {
  const { rows } = await query(
    `SELECT * FROM social_connections
      WHERE user_id = $1 AND platform = $2 AND status = 'connected'
      ORDER BY updated_at DESC LIMIT 1`,
    [userId, platform]
  );
  return rows[0] || null;
}

// Aggregators accept a future time and release the post themselves. A direct
// platform connection cannot, so Postly holds the post and publishes it at the
// minute instead. Before this distinction existed, every auto-approval
// automation on a directly connected account failed with "scheduling is only
// supported for one-click connections" and never posted at all.
function deliveryFor(conn) {
  return conn?.provider === 'zernio' || conn?.provider === 'socialapi' ? 'aggregator' : 'postly';
}

// Builds the generation input for one slot.
function inputFor(automation, brand, { index, rotation }) {
  const postType =
    automation.post_type === 'mixed'
      ? TYPE_ROTATION[(index + rotation) % TYPE_ROTATION.length]
      : automation.post_type;

  const theme =
    automation.theme?.trim() ||
    `${brand?.products || brand?.store_name || 'our products'} — ${ANGLES[(index + rotation) % ANGLES.length]}`;

  // Brand rules apply to every post; the automation's are added on top rather
  // than replacing them. Overriding silently would make a brand-wide rule
  // ("never mention discounts") look ignored on one stream and honoured on
  // another, with nothing in the UI to explain the difference.
  const customPrompt = [brand?.custom_prompt, automation.custom_prompt]
    .map((t) => String(t || '').trim())
    .filter(Boolean)
    .join('\n\n');

  return {
    theme,
    postType,
    format: automation.format,
    productName: brand?.store_name || '',
    description: brand?.benefits || '',
    tone: automation.tone || brand?.default_tone || 'friendly and engaging',
    destinationUrl: brand?.store_url || '',
    customPrompt,
  };
}

// Claims a slot by inserting its (empty) row first.
//
// The claim happens *before* generation, not after: generating takes the better
// part of a minute, and two overlapping ticks would otherwise both generate and
// only collide at the end — paying twice for the copy and artwork of a post one
// of them must then throw away. Returns null when another run owns the slot.
async function claimSlot(automation, platform, slot) {
  const { rows } = await query(
    `INSERT INTO queued_posts
       (user_id, automation_id, platform, status, format, slot_key, scheduled_at, theme)
     VALUES ($1,$2,$3,'generating',$4,$5,$6,$7)
     ON CONFLICT (automation_id, slot_key) WHERE automation_id IS NOT NULL AND slot_key IS NOT NULL
     DO NOTHING
     RETURNING *`,
    [
      automation.user_id, automation.id, platform, automation.format,
      slotKey(slot, platform), slot.at.toISOString(),
      automation.theme?.trim() || null,
    ]
  );
  return rows[0] || null;
}

// A claim that could not be filled must not leave a husk behind: the row is
// removed so the slot can be attempted again on the next tick.
async function releaseSlot(postId) {
  await query(`DELETE FROM queued_posts WHERE id = $1 AND status = 'generating'`, [postId]);
}

// Generates one post for one slot and puts it wherever it belongs: a draft for
// review, a scheduled post the aggregator will release, a post held here for
// timed delivery, or published immediately when its slot has already passed.
async function runSlot(automation, { platform, slot, brand, index, rotation }) {
  // A platform that cannot take this format is checked before anything is
  // generated. TikTok takes video only, so an image automation with TikTok
  // selected used to write and pay for a post the platform then rejected —
  // the run went "partial", Instagram published, TikTok silently did not, and
  // the reason was buried in one long detail string.
  if (!platformSupportsFormat(platform, automation.format)) {
    // Not a failure of the run — a standing mismatch in the configuration. It
    // was counted as one, so an automation posting happily to two platforms
    // reported "failed" every time because a third could not take the format,
    // and a real fault became impossible to spot among the noise.
    return {
      platform, slot: slot.key, ok: false, misconfigured: true,
      error: formatMismatchReason(platform, automation.format),
    };
  }

  const conn = await connectionFor(automation.user_id, platform);
  if (!conn) {
    return { platform, slot: slot.key, ok: false, error: `${platform} is not connected` };
  }

  const claimed = await claimSlot(automation, platform, slot);
  if (!claimed) {
    return { platform, slot: slot.key, ok: true, status: 'already made', skipped: true };
  }

  const input = inputFor(automation, brand, { index, rotation });

  let content;
  try {
    content = await withUserKeys(automation.user_id, () =>
      generateContent({ platform, input, brand })
    );
  } catch (e) {
    await releaseSlot(claimed.id);
    return { platform, slot: slot.key, ok: false, error: e.message };
  }

  // Mirror the manual path: a "video" whose script came back unusable was
  // rendered as a single image, so store it as one rather than as a video the
  // worker can never render.
  const isVideo =
    automation.format === 'video' && Array.isArray(content.scenes) && content.scenes.length > 0;
  const storedFormat = isVideo
    ? 'video'
    : automation.format === 'video'
      ? 'single'
      : automation.format;

  // That downgrade is a fallback, not a licence: on a video-only platform a
  // single image is not publishable, so the slot is released for another run
  // rather than filled with something that can only fail at publish time.
  if (!platformSupportsFormat(platform, storedFormat)) {
    await releaseSlot(claimed.id);
    return {
      platform, slot: slot.key, ok: false,
      error: `the video script came back empty — ${formatMismatchReason(platform, storedFormat)}`,
    };
  }

  const delivery = deliveryFor(conn);
  // Videos wait for the render worker; "review" automations wait for the user.
  const mustWait = isVideo || automation.approval === 'review';

  const { rows: filled } = await query(
    `UPDATE queued_posts SET
        status = 'draft', format = $2, theme = $3, tone = $4, caption = $5,
        hashtags = $6, cta = $7, pin_title = $8, pin_description = $9,
        image_url = $10, image_urls = $11::jsonb, script = $12::jsonb,
        video_status = $13, destination_url = $14, delivery = $15,
        error_message = NULL, updated_at = now()
      WHERE id = $1
      RETURNING *`,
    [
      claimed.id, storedFormat, input.theme, input.tone, content.caption,
      content.hashtags, content.cta,
      isVideo ? content.videoTitle || content.pinTitle : content.pinTitle,
      content.pinDescription, content.imageUrl,
      JSON.stringify(content.imageUrls || [content.imageUrl].filter(Boolean)),
      isVideo ? JSON.stringify(content.scenes) : null,
      isVideo ? 'pending' : null,
      input.destinationUrl || null,
      mustWait ? null : delivery,
    ]
  );
  const post = filled[0];

  if (mustWait) {
    // A video generated six minutes before its slot has to start rendering
    // immediately to have any chance of going out near its time; waiting for
    // the renderer's own timer is what made scheduled videos hours late.
    if (isVideo) await requestRender();
    return {
      platform, slot: slot.key, ok: true,
      status: isVideo && automation.approval === 'auto' ? 'rendering' : 'draft',
    };
  }

  const { publishQueuedPost } = await import('./publishqueued.js');

  // A slot that has already passed (a missed tick being caught up) goes out
  // now. Handing the aggregator a time in the past is either rejected or
  // released immediately anyway, and the delay is already spent.
  const scheduledAt = slot.late ? null : slot.at.toISOString();

  // Held posts are not published here at all: the row simply waits with its
  // time, and the tick that runs at that minute delivers it.
  if (scheduledAt && delivery === 'postly') {
    await query(
      `UPDATE queued_posts SET status = 'scheduled', scheduled_at = $2, updated_at = now()
        WHERE id = $1`,
      [post.id, scheduledAt]
    );
    return { platform, slot: slot.key, ok: true, status: 'scheduled', at: scheduledAt };
  }

  const published = await publishQueuedPost(post, { scheduledAt });
  return {
    platform, slot: slot.key,
    ok: published.ok,
    status: published.status,
    at: published.ok && scheduledAt ? scheduledAt : null,
    ...(published.ok ? {} : { error: published.error }),
  };
}

// Runs an automation for a given set of slots.
//
// `slots` comes from the scheduler (what is actually due) or from "Run now"
// (a single synthetic slot). Passing them in rather than deriving them here is
// what lets one code path serve both without the manual run inventing times
// that the schedule would never have produced.
export async function runAutomation(automation, {
  slots,
  trigger = 'cron',
  maxPosts = 12,
  deadline = Date.now() + SLOT_BUDGET_MS,
} = {}) {
  const platforms = (Array.isArray(automation.platforms) ? automation.platforms : []).filter(Boolean);

  const { rows: runRows } = await query(
    `INSERT INTO automation_runs (automation_id, user_id, trigger, status, slots)
     VALUES ($1,$2,$3,'running',$4) RETURNING id`,
    [automation.id, automation.user_id, trigger, slots.length]
  );
  const runId = runRows[0].id;

  const finish = async (status, detail, counts) => {
    await query(
      `UPDATE automation_runs
          SET status = $2, detail = $3, generated = $4, published = $5, failed = $6,
              finished_at = now()
        WHERE id = $1`,
      [runId, status, String(detail || '').slice(0, 600), counts.generated, counts.published, counts.failed]
    );
    await query(
      `UPDATE automations
          SET last_run_at = now(), last_run_status = $2, last_run_detail = $3,
              last_error = $4, run_count = run_count + 1, updated_at = now()
        WHERE id = $1`,
      [automation.id, status, String(detail || '').slice(0, 500), status === 'failed' ? String(detail || '').slice(0, 300) : null]
    );
  };

  if (platforms.length === 0) {
    const detail = 'no platforms selected';
    await finish('failed', detail, { generated: 0, published: 0, failed: 0 });
    return { runStatus: 'failed', detail, results: [{ ok: false, error: detail }] };
  }
  if (slots.length === 0) {
    await finish('skipped', 'nothing due', { generated: 0, published: 0, failed: 0 });
    return { runStatus: 'skipped', detail: 'nothing due', results: [] };
  }

  const { rows: brandRows } = await query('SELECT * FROM brand_profiles WHERE user_id = $1', [
    automation.user_id,
  ]);
  const brand = brandRows[0] || null;

  // Rotate by run as well as by date. Keying on the date alone meant two runs
  // on the same day produced byte-identical posts, which the platforms reject
  // as duplicates.
  const rotation = new Date().getUTCDate() + (automation.run_count || 0);

  const results = [];
  let made = 0;
  let ranOutOfTime = false;
  // The instant up to which this run is definitively done. Only slots whose
  // every platform was attempted count: advancing the watermark past a slot the
  // run never reached would drop it silently, which is exactly the class of bug
  // this rewrite exists to remove.
  let processedThrough = null;

  for (const [i, slot] of slots.entries()) {
    let complete = true;
    for (const platform of platforms) {
      // Stop cleanly rather than being killed halfway through an insert.
      if (made >= maxPosts || Date.now() > deadline) {
        ranOutOfTime = true;
        complete = false;
        break;
      }
      made++;
      try {
        results.push(await runSlot(automation, {
          platform, slot, brand, index: i, rotation,
        }));
      } catch (e) {
        results.push({ platform, slot: slot.key, ok: false, error: e.message });
      }
    }
    if (!complete) break;
    processedThrough = slot.at;
  }

  const counts = {
    generated: results.filter((r) => r.ok && !r.skipped).length,
    published: results.filter((r) => r.ok && (r.status === 'published' || r.status === 'scheduled')).length,
    failed: results.filter((r) => !r.ok && !r.misconfigured).length,
  };

  // A slot already made, and a platform that can never take this format, are
  // both excluded from the verdict: neither says anything about whether this
  // run worked.
  const attempted = results.filter((r) => !r.skipped && !r.misconfigured);
  const okCount = attempted.filter((r) => r.ok).length;
  const misconfigured = results.filter((r) => r.misconfigured).length;
  const runStatus =
    attempted.length === 0
      ? (misconfigured ? 'misconfigured' : 'skipped')
      : okCount === 0 ? 'failed'
        : okCount === attempted.length ? 'ok' : 'partial';

  const detail = [
    ...results.map((r) => `${r.platform} ${r.slot?.slice(11) || ''} ${r.ok ? r.status || 'ok' : r.error}`.trim()),
    ranOutOfTime ? 'stopped early — out of time this tick, the rest resume next tick' : '',
  ].filter(Boolean).join(' · ').slice(0, 600);

  await finish(runStatus, detail, counts);
  return { runStatus, detail, results, ranOutOfTime, counts, processedThrough };
}
