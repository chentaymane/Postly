import { NextResponse } from 'next/server';
import { query } from '../../../../../lib/db';
import { currentUserId } from '../../../../../lib/auth';
import { publishQueuedPost, holdForDelivery } from '../../../../../lib/publishqueued';

export const runtime = 'nodejs';
export const maxDuration = 120;

// Approve a draft for its own slot.
//
// Automations set to "wait for my approval" now write their drafts a day
// ahead, so approving one usually means "yes, post this at 13:00 tomorrow" —
// not "post it now", which was the only fast path Review offered. A draft
// whose time has passed (or that never had one) is published straight away.
export async function POST(request, { params }) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'not authenticated' }, { status: 401 });

  const { rows } = await query(
    `SELECT * FROM queued_posts WHERE id = $1 AND user_id = $2 AND status = 'draft'`,
    [params.id, userId]
  );
  const post = rows[0];
  if (!post) return NextResponse.json({ error: 'draft not found (or already handled)' }, { status: 404 });

  if (post.format === 'video' && !post.video_url) {
    return NextResponse.json({ error: 'the video has not finished rendering yet' }, { status: 409 });
  }

  const at = post.scheduled_at ? new Date(post.scheduled_at) : null;
  if (at && at.getTime() > Date.now() + 60000) {
    await holdForDelivery(post.id, at.toISOString());
    return NextResponse.json({ ok: true, status: 'scheduled', scheduled_at: at.toISOString() });
  }

  const result = await publishQueuedPost(post, { scheduledAt: null });
  if (result.ok) return NextResponse.json({ ok: true, status: result.status });
  return NextResponse.json(
    { ok: false, status: result.status, error: result.error, unconfirmed: Boolean(result.unconfirmed) },
    { status: result.unconfirmed ? 202 : 502 }
  );
}
