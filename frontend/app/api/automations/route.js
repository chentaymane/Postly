import { NextResponse } from 'next/server';
import { query } from '../../../lib/db';
import { currentUserId } from '../../../lib/auth';
import { POST_TYPES, FORMATS, APPROVALS } from '../../../lib/automations';
import { nextRunAt, normaliseTimes, isValidTimezone, timezoneLabel } from '../../../lib/schedule';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Validates and normalises an automation payload from the client.
function clean(b) {
  const times = normaliseTimes(b.times);
  return {
    name: String(b.name || '').trim().slice(0, 80) || 'Untitled automation',
    enabled: b.enabled !== false,
    post_type: POST_TYPES.includes(b.post_type) ? b.post_type : 'mixed',
    format: FORMATS.includes(b.format) ? b.format : 'single',
    platforms: (Array.isArray(b.platforms) ? b.platforms : []).slice(0, 6),
    times: times.length ? times : ['10:00'],
    // An unknown zone would throw inside the scheduler and take every other
    // automation in that tick down with it, so it is rejected at the door.
    timezone: isValidTimezone(b.timezone) ? b.timezone : 'UTC',
    theme: String(b.theme || '').trim().slice(0, 500) || null,
    custom_prompt: String(b.custom_prompt || '').trim().slice(0, 4000) || null,
    tone: String(b.tone || '').trim().slice(0, 100) || null,
    approval: APPROVALS.includes(b.approval) ? b.approval : 'review',
    catch_up_hours: Math.max(0, Math.min(48, Number(b.catch_up_hours) || 6)),
  };
}

// Everything the UI needs to describe an automation's schedule truthfully.
export function decorate(a, extras = {}) {
  return {
    ...a,
    ...extras,
    next_run_at: a.enabled ? nextRunAt(a) : null,
    tz_label: timezoneLabel(a.timezone),
  };
}

export async function GET() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'not authenticated' }, { status: 401 });

  const { rows } = await query(
    `SELECT a.*,
            (SELECT count(*) FROM queued_posts q
              WHERE q.automation_id = a.id AND q.status <> 'generating') AS posts_made,
            (SELECT count(*) FROM queued_posts q
              WHERE q.automation_id = a.id AND q.status = 'published')    AS posts_live,
            (SELECT count(*) FROM queued_posts q
              WHERE q.automation_id = a.id AND q.status = 'failed')       AS posts_failed
       FROM automations a
      WHERE a.user_id = $1
      ORDER BY a.id`,
    [userId]
  );

  // Last few runs per automation, so the card can show what actually happened
  // rather than only the single most recent status.
  const ids = rows.map((r) => r.id);
  const runsByAutomation = new Map();
  if (ids.length > 0) {
    const { rows: runs } = await query(
      `SELECT * FROM (
         SELECT r.*, row_number() OVER (PARTITION BY r.automation_id ORDER BY r.started_at DESC) AS rn
           FROM automation_runs r
          WHERE r.automation_id = ANY($1::bigint[])
       ) t WHERE rn <= 5
       ORDER BY automation_id, started_at DESC`,
      [ids]
    );
    for (const run of runs) {
      if (!runsByAutomation.has(run.automation_id)) runsByAutomation.set(run.automation_id, []);
      runsByAutomation.get(run.automation_id).push(run);
    }
  }

  const automations = rows.map((a) =>
    decorate(a, {
      posts_made: Number(a.posts_made),
      posts_live: Number(a.posts_live),
      posts_failed: Number(a.posts_failed),
      runs: runsByAutomation.get(a.id) || [],
    })
  );
  return NextResponse.json({ automations });
}

export async function POST(request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'not authenticated' }, { status: 401 });

  let b;
  try {
    b = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const a = clean(b);

  const { rows } = await query(
    `INSERT INTO automations
       (user_id, name, enabled, post_type, format, platforms, times, timezone,
        theme, tone, approval, catch_up_hours, custom_prompt)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    [
      userId, a.name, a.enabled, a.post_type, a.format,
      JSON.stringify(a.platforms), JSON.stringify(a.times), a.timezone,
      a.theme, a.tone, a.approval, a.catch_up_hours, a.custom_prompt,
    ]
  );
  return NextResponse.json({
    automation: decorate(rows[0], { posts_made: 0, posts_live: 0, posts_failed: 0, runs: [] }),
  });
}
