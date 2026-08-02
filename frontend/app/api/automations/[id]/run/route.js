import { NextResponse } from 'next/server';
import { query } from '../../../../../lib/db';
import { currentUserId } from '../../../../../lib/auth';
import { runAutomation } from '../../../../../lib/automations';

export const runtime = 'nodejs';
export const maxDuration = 300;

// "Run now": executes the automation immediately, generating the full day's
// worth of posts — every time slot for every platform — exactly as the daily
// cron would. It used to stop after two, which looked like the automation
// ignoring the configured posts-per-day.
export async function POST(request, { params }) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'not authenticated' }, { status: 401 });

  const { rows } = await query('SELECT * FROM automations WHERE id = $1 AND user_id = $2', [
    params.id,
    userId,
  ]);
  const automation = rows[0];
  if (!automation) return NextResponse.json({ error: 'automation not found' }, { status: 404 });

  try {
    // One post per slot per platform, which is what "N posts per day" means.
    // Capped only by the function's own time budget.
    const slots = (Array.isArray(automation.times) ? automation.times : ['10:00']).length;
    const platforms = (Array.isArray(automation.platforms) ? automation.platforms : []).length;
    const limit = Math.max(1, Math.min(slots * platforms, 12));

    const { results, runStatus, detail } = await runAutomation(automation, { limit });
    return NextResponse.json({ ok: runStatus !== 'failed', runStatus, detail, results });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 502 });
  }
}
