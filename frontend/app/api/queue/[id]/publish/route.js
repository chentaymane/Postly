import { NextResponse } from 'next/server';
import { query } from '../../../../../lib/db';
import { currentUserId } from '../../../../../lib/auth';
import { publishContent, logPost } from '../../../../../lib/pipeline';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Approve a draft: publish it now, or schedule it ({ when: ISO datetime }).
// Timed delivery is handled by the aggregator, so no cron is needed.
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

  if (post.format === 'video' && !post.video_url) {
    return NextResponse.json(
      { error: 'the video has not finished rendering yet' },
      { status: 409 }
    );
  }

  const content = {
    caption: post.caption,
    hashtags: post.hashtags,
    cta: post.cta,
    pinTitle: post.pin_title,
    pinDescription: post.pin_description,
    imageUrl: post.image_url,
    imageUrls: Array.isArray(post.image_urls) ? post.image_urls : null,
    videoUrl: post.video_url || null,
    videoTitle: post.pin_title || post.theme || null,
    coverUrl: post.image_url || null,
    destinationUrl: post.destination_url || '',
    fullMessage: [post.caption, post.cta, post.hashtags].filter(Boolean).join('\n\n'),
  };

  try {
    const result = await publishContent({ conn, platform: post.platform, content, scheduledAt });
    const newStatus = scheduledAt ? 'scheduled' : 'published';
    await query(
      `UPDATE queued_posts SET status = $3, scheduled_at = $4, published_post_id = $5,
              error_message = NULL, updated_at = now()
        WHERE id = $1 AND user_id = $2`,
      [post.id, userId, newStatus, scheduledAt, result.post_id]
    );
    await logPost({
      run_id: null, user_id: userId, platform: post.platform,
      status: scheduledAt ? 'scheduled' : 'success',
      post_id: result.post_id, error_message: null,
      theme: post.theme, product_name: null, tone: post.tone,
      caption: post.caption, hashtags: post.hashtags, cta: post.cta,
      image_url: post.image_url, destination_url: post.destination_url,
      raw_request: { queued_post_id: post.id, scheduled_at: scheduledAt },
      raw_response: result.raw,
    });
    return NextResponse.json({ ok: true, status: newStatus, post_id: result.post_id, scheduled_at: scheduledAt });
  } catch (e) {
    // An unconfirmed publish is NOT a failure: the platform may well have taken
    // the post. Parking it in its own state stops the user from retrying into a
    // duplicate, and keeps it out of the "failed" count.
    const status = e.unconfirmed ? 'unconfirmed' : 'failed';
    await query(
      `UPDATE queued_posts SET status = $3, error_message = $4, updated_at = now()
        WHERE id = $1 AND user_id = $2`,
      [post.id, userId, status, e.message]
    );
    await logPost({
      run_id: null, user_id: userId, platform: post.platform,
      status: e.unconfirmed ? 'unconfirmed' : 'fail',
      post_id: null, error_message: e.message,
      theme: post.theme, product_name: null, tone: post.tone,
      caption: post.caption, hashtags: post.hashtags, cta: post.cta,
      image_url: post.image_url, destination_url: post.destination_url,
      raw_request: { queued_post_id: post.id },
      raw_response: { error: e.message },
    });
    return NextResponse.json(
      { ok: false, unconfirmed: Boolean(e.unconfirmed), status, error: e.message },
      { status: e.unconfirmed ? 202 : 502 }
    );
  }
}
