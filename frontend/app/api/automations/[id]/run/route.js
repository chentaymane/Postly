import { NextResponse } from 'next/server';
import { query } from '../../../../../lib/db';
import { currentUserId } from '../../../../../lib/auth';
import { runAutomation } from '../../../../../lib/automations';

export const runtime = 'nodejs';
export const maxDuration = 300;

// "Run now": executes the automation immediately so the user can see what it
// produces without waiting for the daily cron. Capped to 2 generations to stay
// inside the request budget.
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
    const { results, runStatus, detail } = await runAutomation(automation, { limit: 2 });
    return NextResponse.json({ ok: runStatus !== 'failed', runStatus, detail, results });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 502 });
  }
}
