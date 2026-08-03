import { NextResponse } from 'next/server';
import { query } from '../../../../../lib/db';
import { currentUserId } from '../../../../../lib/auth';
import { publishQueuedPost } from '../../../../../lib/publishqueued';

export const runtime = 'nodejs';
export const maxDuration = 120;

// Approve a draft: publish it now, or schedule it ({ when: ISO datetime }).
//
// The work itself lives in publishQueuedPost, which is also what the scheduler
// and the automation runner call. This route used to carry its own copy of the
// publish-and-record logic, so approving by hand and approving automatically
// could — and did — behave differently.
export async function POST(request, { params }) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'not authenticated' }, { status: 401 });

  let body = {};
  try {
    body = await request.json();
  } catch { /* empty body = publish now */ }

  let scheduledAt = null;
  if (body.when) {
    const d = new Date(body.when);
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json({ error: 'invalid schedule datetime' }, { status: 400 });
    }
    if (d.getTime() > Date.now() + 60000) scheduledAt = d.toISOString();
    // A past/imminent time just means "publish now".
  }

  const { rows } = await query(
    `SELECT * FROM queued_posts
      WHERE id = $1 AND user_id = $2 AND status IN ('draft','failed','unconfirmed')`,
    [params.id, userId]
  );
  const post = rows[0];
  if (!post) return NextResponse.json({ error: 'draft not found (or already published)' }, { status: 404 });

  if (post.format === 'video' && !post.video_url) {
    return NextResponse.json({ error: 'the video has not finished rendering yet' }, { status: 409 });
  }

  const result = await publishQueuedPost(post, { scheduledAt });

  if (result.ok) {
    return NextResponse.json({
      ok: true,
      status: result.status,
      post_id: result.post_id || null,
      scheduled_at: scheduledAt,
      // A held post is scheduled just as firmly as an aggregator one; the user
      // only needs to know Postly is the one sending it.
      held: Boolean(result.held),
    });
  }

  return NextResponse.json(
    {
      ok: false,
      unconfirmed: Boolean(result.unconfirmed),
      status: result.status,
      error: result.error,
      willRetry: Boolean(result.willRetry),
      retryAt: result.retryAt || null,
    },
    { status: result.unconfirmed ? 202 : 502 }
  );
}
