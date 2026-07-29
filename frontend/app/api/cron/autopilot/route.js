import { NextResponse } from 'next/server';
import { query } from '../../../../lib/db';
import { runAutomation } from '../../../../lib/automations';

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

// Daily cron (Vercel). Runs every enabled automation once: each one generates
// its posts and either schedules them at the chosen hours or leaves drafts in
// Review, depending on its approval mode.
export async function GET(request) {
  const auth = request.headers.get('authorization') || '';
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { rows: automations } = await query(
    `SELECT * FROM automations WHERE enabled = true ORDER BY id LIMIT 20`
  );

  const runs = [];
  let budget = 10; // total generations across all automations this invocation

  for (const automation of automations) {
    if (budget <= 0) break;
    try {
      const { results, runStatus, detail } = await runAutomation(automation, { limit: budget });
      budget -= results.length;
      runs.push({ id: automation.id, name: automation.name, runStatus, detail });
    } catch (e) {
      runs.push({ id: automation.id, name: automation.name, runStatus: 'failed', detail: e.message });
    }
  }

  return NextResponse.json({ ran: true, automations: runs });
}
