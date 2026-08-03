import { NextResponse } from 'next/server';
import { query } from '../../../../../lib/db';
import { currentUserId } from '../../../../../lib/auth';
import { runAutomation } from '../../../../../lib/automations';
import { zonedDateString, safeTimezone } from '../../../../../lib/schedule';

export const runtime = 'nodejs';
export const maxDuration = 300;

// "Run now": generates this automation's posts immediately, once per platform.
//
// It runs one synthetic slot rather than the whole day. Firing every configured
// hour at once produced a day's posts in a single minute and consumed the
// slots, so the real schedule then had nothing left to do — the automation
// looked like it had stopped. A manual run is a *test*: one post per platform,
// out now, and today's real slots still happen.
export async function POST(request, { params }) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'not authenticated' }, { status: 401 });

  const { rows } = await query('SELECT * FROM automations WHERE id = $1 AND user_id = $2', [
    params.id,
    userId,
  ]);
  const automation = rows[0];
  if (!automation) return NextResponse.json({ error: 'automation not found' }, { status: 404 });

  const now = new Date();
  const tz = safeTimezone(automation.timezone);

  // A key of its own, so a manual run never collides with a scheduled slot and
  // never blocks one — but two clicks a minute apart still collapse into one.
  const stamp = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit',
  }).format(now);

  const slot = {
    date: zonedDateString(now, tz),
    time: stamp,
    at: now,
    key: `manual-${zonedDateString(now, tz)}T${stamp}`,
    late: true,   // publish immediately rather than scheduling
  };

  try {
    const result = await runAutomation(automation, {
      slots: [slot],
      trigger: 'manual',
      maxPosts: 6,
      deadline: Date.now() + 260000,
    });
    return NextResponse.json({
      ok: result.runStatus !== 'failed',
      runStatus: result.runStatus,
      detail: result.detail,
      results: result.results,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 502 });
  }
}
