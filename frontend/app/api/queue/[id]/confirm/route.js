import { NextResponse } from 'next/server';
import { query } from '../../../../../lib/db';
import { currentUserId } from '../../../../../lib/auth';
import { findPublishedPost, logPost } from '../../../../../lib/pipeline';

export const runtime = 'nodejs';
export const maxDuration = 30;

// Resolves a post whose publish result was never confirmed — the platform
// accepted it but our request timed out first.
//
// Without a body it asks the platform whether the post is actually there.
// With { force: true } the user has looked at their own account and is telling
// us it went live, so we take their word for it.
export async function POST(request, { params }) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'not authenticated' }, { status: 401 });

  let body = {};
  try {
    body = await request.json();
  } catch { /* empty body = check the platform */ }

  const { rows } = await query(
    `SELECT * FROM queued_posts
      WHERE id = $1 AND user_id = $2 AND status IN ('unconfirmed','failed')`,
    [params.id, userId]
  );
  const post = rows[0];
  if (!post) return NextResponse.json({ error: 'post not found' }, { status: 404 });

  const markPublished = async (postId) => {
    await query(
      `UPDATE queued_posts SET status = 'published', published_post_id = $3,
              error_message = NULL, updated_at = now()
        WHERE id = $1 AND user_id = $2`,
      [post.id, userId, postId]
    );
    await logPost({
      run_id: null, user_id: userId, platform: post.platform, status: 'success',
      post_id: postId, error_message: null,
      theme: post.theme, product_name: null, tone: post.tone,
      caption: post.caption, hashtags: post.hashtags, cta: post.cta,
      image_url: post.image_url, destination_url: post.destination_url,
      raw_request: { queued_post_id: post.id, confirmed: body.force ? 'by user' : 'by platform check' },
      raw_response: { post_id: postId },
    });
  };

  if (body.force) {
    await markPublished(post.published_post_id || null);
    return NextResponse.json({ ok: true, status: 'published', confirmed: 'manual' });
  }

  const { rows: connRows } = await query(
    `SELECT * FROM social_connections
      WHERE user_id = $1 AND platform = $2 AND status = 'connected'
      ORDER BY updated_at DESC LIMIT 1`,
    [userId, post.platform]
  );
  const conn = connRows[0];
  if (!conn) {
    return NextResponse.json({ error: `${post.platform} account not connected` }, { status: 400 });
  }

  const content = {
    caption: post.caption,
    pinTitle: post.pin_title,
    pinDescription: post.pin_description,
    fullMessage: [post.caption, post.cta, post.hashtags].filter(Boolean).join('\n\n'),
  };
  const found = await findPublishedPost({ conn, platform: post.platform, content });

  if (found) {
    await markPublished(found);
    return NextResponse.json({ ok: true, status: 'published', post_id: found, confirmed: 'platform' });
  }
  if (found === null) {
    await query(
      `UPDATE queued_posts SET status = 'draft', updated_at = now() WHERE id = $1 AND user_id = $2`,
      [post.id, userId]
    );
    return NextResponse.json({
      ok: true, status: 'draft', found: false,
      message: 'Not on your account — the draft is ready to publish again.',
    });
  }
  return NextResponse.json({
    ok: false, status: post.status, found: null,
    message: `Could not reach ${post.platform} to check. Open your account and confirm manually.`,
  });
}
