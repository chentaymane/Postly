import { NextResponse } from 'next/server';
import { query } from '../../../../../lib/db';
import { currentUserId } from '../../../../../lib/auth';
import { cancelUpstream } from '../../../../../lib/publishqueued';

export const runtime = 'nodejs';

// Cancels a scheduled post: best-effort cancellation at the aggregator that
// holds it, then the post returns to the drafts list for editing/rescheduling.
export async function POST(request, { params }) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'not authenticated' }, { status: 401 });

  const { rows } = await query(
    `SELECT * FROM queued_posts WHERE id = $1 AND user_id = $2 AND status = 'scheduled'`,
    [params.id, userId]
  );
  const post = rows[0];
  if (!post) return NextResponse.json({ error: 'scheduled post not found' }, { status: 404 });

  // Only a post the aggregator is holding needs cancelling upstream. One held
  // by Postly has never left this database, so there is nothing to call.
  const upstream = await cancelUpstream(post);

  // The slot key stays on the row. Cancelling means "not this one" — the
  // scheduler must not helpfully regenerate the post the user just cancelled.
  await query(
    `UPDATE queued_posts
        SET status = 'draft', scheduled_at = NULL, published_post_id = NULL,
            delivery = NULL, error_message = NULL, failure_kind = NULL,
            next_attempt_at = NULL, updated_at = now()
      WHERE id = $1 AND user_id = $2 AND status = 'scheduled'`,
    [params.id, userId]
  );

  return NextResponse.json({ ok: true, upstream });
}
