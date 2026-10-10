import { NextResponse } from 'next/server';
import { query } from '../../../../../lib/db';
import { currentUserId } from '../../../../../lib/auth';
import { cancelUpstream } from '../../../../../lib/publishqueued';

export const runtime = 'nodejs';

// Skip one post — "not this one" — or undo that with { undo: true }.
//
// Skipping keeps the row and its slot key, so the scheduler sees the slot as
// handled and does not write a replacement. Deleting would free the key, and
// the very post the user just rejected could be written again.
export async function POST(request, { params }) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'not authenticated' }, { status: 401 });

  let b = {};
  try { b = await request.json(); } catch { /* empty body = skip */ }

  const { rows } = await query(
    `SELECT q.*, a.approval, a.enabled AS automation_enabled
       FROM queued_posts q
       LEFT JOIN automations a ON a.id = q.automation_id
      WHERE q.id = $1 AND q.user_id = $2`,
    [params.id, userId]
  );
  const post = rows[0];
  if (!post) return NextResponse.json({ error: 'post not found' }, { status: 404 });

  if (b.undo) {
    if (post.status !== 'skipped') return NextResponse.json({ ok: true, status: post.status });

    // A placeholder for a slot that was never written: removing it hands the
    // slot back to the scheduler.
    if (!post.caption && !post.pin_description) {
      await query('DELETE FROM queued_posts WHERE id = $1 AND user_id = $2', [post.id, userId]);
      return NextResponse.json({ ok: true, status: 'planned' });
    }

    // Back to where it would be now: held for its minute if that is still
    // ahead and nobody needs to approve it, otherwise a draft to act on.
    const ahead = post.scheduled_at && new Date(post.scheduled_at).getTime() > Date.now() + 60000;
    const needsApproval = post.approval === 'review';
    const waitingOnVideo = post.format === 'video' && !post.video_url;
    const status = ahead && !needsApproval && !waitingOnVideo ? 'scheduled' : 'draft';
    await query(
      `UPDATE queued_posts
          SET status = $3, delivery = CASE WHEN $3 = 'scheduled' THEN 'postly' ELSE NULL END,
              published_post_id = NULL, error_message = NULL, updated_at = now()
        WHERE id = $1 AND user_id = $2 AND status = 'skipped'`,
      [post.id, userId, status]
    );
    return NextResponse.json({ ok: true, status });
  }

  const skippable = ['draft', 'scheduled', 'failed', 'unconfirmed'];
  if (!skippable.includes(post.status)) {
    return NextResponse.json(
      { error: post.status === 'published' ? 'it has already been published' : `cannot skip a post that is ${post.status}` },
      { status: 409 }
    );
  }

  // An aggregator holding it for later has to be told, or it goes out anyway.
  const upstream = post.status === 'scheduled' ? await cancelUpstream(post) : null;

  const { rowCount } = await query(
    `UPDATE queued_posts
        SET status = 'skipped', error_message = 'Skipped by you',
            next_attempt_at = NULL, updated_at = now()
      WHERE id = $1 AND user_id = $2 AND status = ANY($3)`,
    [post.id, userId, skippable]
  );
  if (rowCount === 0) {
    return NextResponse.json({ error: 'it is being published right now' }, { status: 409 });
  }
  return NextResponse.json({ ok: true, status: 'skipped', upstream });
}
