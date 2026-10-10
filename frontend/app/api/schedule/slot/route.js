import { NextResponse } from 'next/server';
import { query } from '../../../../lib/db';
import { currentUserId } from '../../../../lib/auth';
import { runAutomation } from '../../../../lib/automations';
import { slotFor } from '../../../../lib/plan';

export const runtime = 'nodejs';
export const maxDuration = 300;

// Acts on a slot that has not been written yet.
//
//   skip    — keep this slot empty. A placeholder row takes the slot's key, so
//             the scheduler finds it already handled and never writes it.
//   restore — undo a skip by removing the placeholder.
//   write   — write it now instead of a day ahead, to see it early. It is held
//             for its own minute like any other, so nothing goes out sooner.
export async function POST(request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'not authenticated' }, { status: 401 });

  let b;
  try {
    b = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const { rows } = await query('SELECT * FROM automations WHERE id = $1 AND user_id = $2', [
    b.automation_id, userId,
  ]);
  const automation = rows[0];
  if (!automation) return NextResponse.json({ error: 'automation not found' }, { status: 404 });

  const slot = slotFor(automation, b.slot);
  if (!slot) return NextResponse.json({ error: 'that time is not in this automation’s schedule' }, { status: 400 });

  const platforms = (Array.isArray(automation.platforms) ? automation.platforms : []).filter(Boolean);

  if (b.action === 'skip') {
    for (const platform of platforms) {
      await query(
        `INSERT INTO queued_posts
           (user_id, automation_id, platform, status, format, slot_key, scheduled_at, error_message)
         VALUES ($1,$2,$3,'skipped',$4,$5,$6,'Skipped by you')
         ON CONFLICT (automation_id, slot_key) WHERE automation_id IS NOT NULL AND slot_key IS NOT NULL
         DO NOTHING`,
        [userId, automation.id, platform, automation.format, `${slot.key}|${platform}`, slot.at.toISOString()]
      );
    }
    return NextResponse.json({ ok: true, skipped: true });
  }

  if (b.action === 'restore') {
    // Only empty placeholders: a post that was written and then skipped is
    // restored from its own card, where its content is.
    await query(
      `DELETE FROM queued_posts
        WHERE automation_id = $1 AND user_id = $2 AND status = 'skipped' AND caption IS NULL
          AND slot_key = ANY($3::text[])`,
      [automation.id, userId, platforms.map((p) => `${slot.key}|${p}`)]
    );
    return NextResponse.json({ ok: true, restored: true });
  }

  if (b.action === 'write') {
    if (slot.late) {
      return NextResponse.json({ error: 'that time has already passed' }, { status: 400 });
    }
    try {
      const result = await runAutomation(automation, {
        slots: [slot],
        trigger: 'manual',
        maxPosts: platforms.length,
        deadline: Date.now() + 270000,
      });
      return NextResponse.json({
        ok: result.runStatus !== 'failed',
        runStatus: result.runStatus,
        detail: result.detail,
      });
    } catch (e) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 502 });
    }
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
}
