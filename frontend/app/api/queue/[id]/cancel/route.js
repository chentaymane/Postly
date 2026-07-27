import { NextResponse } from 'next/server';
import { query } from '../../../../../lib/db';
import { currentUserId } from '../../../../../lib/auth';

export const runtime = 'nodejs';

// Cancels a scheduled post: best-effort cancellation at the aggregator that
// holds it, then the post returns to the drafts list for editing/rescheduling.
export async function POST(request, { params }) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'not authenticated' }, { status: 401 });

  const { rows } = await query(
    `SELECT qp.*, sc.provider
       FROM queued_posts qp
       LEFT JOIN social_connections sc
         ON sc.user_id = qp.user_id AND sc.platform = qp.platform AND sc.status = 'connected'
      WHERE qp.id = $1 AND qp.user_id = $2 AND qp.status = 'scheduled'`,
    [params.id, userId]
  );
  const post = rows[0];
  if (!post) return NextResponse.json({ error: 'scheduled post not found' }, { status: 404 });

  let upstream = 'skipped';
  if (post.published_post_id) {
    try {
      if (post.provider === 'socialapi') {
        const { deletePost } = await import('../../../../../lib/socialapi');
        await deletePost(post.published_post_id);
        upstream = 'cancelled';
      } else if (post.provider === 'zernio') {
        const { deletePost } = await import('../../../../../lib/zernio');
        await deletePost(post.published_post_id);
        upstream = 'cancelled';
      }
    } catch (e) {
      upstream = `cancel failed upstream: ${e.message}`;
    }
  }

  await query(
    `UPDATE queued_posts
        SET status = 'draft', scheduled_at = NULL, published_post_id = NULL,
            error_message = NULL, updated_at = now()
      WHERE id = $1 AND user_id = $2`,
    [params.id, userId]
  );

  return NextResponse.json({ ok: true, upstream });
}
