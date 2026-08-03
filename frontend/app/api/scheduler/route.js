import { NextResponse } from 'next/server';
import { currentUserId } from '../../../lib/auth';
import { readHeartbeat, runSchedulerTick, LEAD_MS } from '../../../lib/scheduler';
import { query } from '../../../lib/db';

export const runtime = 'nodejs';
export const maxDuration = 120;
export const dynamic = 'force-dynamic';

// How stale the heartbeat has to be before the app is willing to drive a tick
// itself. Vercel's Hobby plan fires a cron once a day whatever the expression
// says, so on that plan the cron alone cannot post on the hour — an open tab
// covers the gap, and the health payload tells the user plainly when the cron
// is not keeping up so they can point a real scheduler at it.
const STALE_MS = 6 * 60000;

// Scheduler health, for the banner on Automations.
export async function GET() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'not authenticated' }, { status: 401 });

  const beat = await readHeartbeat();
  const ageMs = beat?.at ? Date.now() - new Date(beat.at).getTime() : null;

  const { rows: pending } = await query(
    `SELECT
       count(*) FILTER (WHERE status = 'scheduled' AND scheduled_at <= now()) AS overdue,
       count(*) FILTER (WHERE status = 'scheduled' AND scheduled_at > now())  AS upcoming,
       count(*) FILTER (WHERE status = 'failed' AND failure_kind = 'transient'
                          AND next_attempt_at IS NOT NULL)                     AS retrying,
       count(*) FILTER (WHERE status = 'failed' AND failure_kind = 'permanent') AS blocked
     FROM queued_posts WHERE user_id = $1`,
    [userId]
  );

  const p = pending[0] || {};
  return NextResponse.json({
    lastTickAt: beat?.at || null,
    ageMs,
    // Ticks are asked for every 5 minutes, but GitHub delays scheduled
    // workflows under load — often by 10-15 minutes. The threshold sits past
    // that so a normal delay does not cry wolf, while a scheduler that has
    // actually stopped still shows up within half an hour.
    healthy: ageMs !== null && ageMs < 25 * 60000,
    neverRan: !beat,
    last: beat ? { generated: beat.generated, delivered: beat.delivered, failed: beat.failed, ms: beat.ms } : null,
    leadMinutes: Math.round(LEAD_MS / 60000),
    overdue: Number(p.overdue || 0),
    upcoming: Number(p.upcoming || 0),
    retrying: Number(p.retrying || 0),
    blocked: Number(p.blocked || 0),
  });
}

// Runs a tick on behalf of a signed-in user, but only when the scheduler has
// actually fallen behind. Anyone with an account may trigger it; the staleness
// gate is what stops a reload storm from running the pipeline repeatedly, and a
// tick is idempotent anyway.
export async function POST(request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'not authenticated' }, { status: 401 });

  const force = new URL(request.url).searchParams.get('force') === '1';
  const beat = await readHeartbeat();
  const ageMs = beat?.at ? Date.now() - new Date(beat.at).getTime() : Infinity;

  if (!force && ageMs < STALE_MS) {
    return NextResponse.json({ ok: true, skipped: 'recent', ageMs });
  }

  try {
    const result = await runSchedulerTick({ budgetMs: 95000 });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
