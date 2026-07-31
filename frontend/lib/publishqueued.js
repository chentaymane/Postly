// Publishing a row from queued_posts. Shared by the Review page's approve
// action and by the render-worker callback, so a video that finishes rendering
// on an auto-approval automation goes out exactly the way a manual approval
// would.

import { query } from './db.js';
import { publishContent, logPost } from './pipeline.js';
import { appBaseUrl } from './platforms.js';

// The link that actually goes out on a post: our tracker, which records the
// click and forwards to the store. Falls back to the raw URL when the app has
// no public base (so a local run still produces a working link).
export function trackedLink(post) {
  if (!post.destination_url) return '';
  const base = appBaseUrl();
  if (!/^https?:\/\//i.test(base)) return post.destination_url;
  return `${base}/r/${post.id}`;
}

// Rebuilds the publishable content from a stored draft.
export function contentFromPost(post) {
  return {
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
    destinationUrl: trackedLink(post),
    fullMessage: [post.caption, post.cta, post.hashtags].filter(Boolean).join('\n\n'),
  };
}

// Publishes (or schedules) one queued post and records the outcome.
// Returns { ok, status, post_id, error, unconfirmed }.
export async function publishQueuedPost(post, { scheduledAt = null } = {}) {
  const { rows: connRows } = await query(
    `SELECT * FROM social_connections
      WHERE user_id = $1 AND platform = $2 AND status = 'connected'
      ORDER BY updated_at DESC LIMIT 1`,
    [post.user_id, post.platform]
  );
  const conn = connRows[0];
  if (!conn) {
    const error = `${post.platform} account not connected`;
    await query(
      `UPDATE queued_posts SET status = 'failed', error_message = $2, updated_at = now()
        WHERE id = $1`,
      [post.id, error]
    );
    return { ok: false, status: 'failed', error };
  }

  if (post.format === 'video' && !post.video_url) {
    return { ok: false, status: post.status, error: 'the video has not finished rendering yet' };
  }

  const content = contentFromPost(post);

  try {
    const result = await publishContent({
      conn,
      platform: post.platform,
      content,
      scheduledAt,
    });
    const newStatus = scheduledAt ? 'scheduled' : 'published';
    await query(
      `UPDATE queued_posts SET status = $2, scheduled_at = $3, published_post_id = $4,
              error_message = NULL, updated_at = now()
        WHERE id = $1`,
      [post.id, newStatus, scheduledAt, result.post_id]
    );
    await logPost({
      run_id: null, user_id: post.user_id, platform: post.platform,
      status: scheduledAt ? 'scheduled' : 'success',
      post_id: result.post_id, error_message: null,
      theme: post.theme, product_name: null, tone: post.tone,
      caption: post.caption, hashtags: post.hashtags, cta: post.cta,
      image_url: post.image_url, destination_url: post.destination_url,
      raw_request: { queued_post_id: post.id, scheduled_at: scheduledAt },
      raw_response: result.raw,
    });
    return { ok: true, status: newStatus, post_id: result.post_id };
  } catch (e) {
    // An unconfirmed publish may well have landed — parking it in its own state
    // keeps the user from retrying into a duplicate.
    const status = e.unconfirmed ? 'unconfirmed' : 'failed';
    await query(
      `UPDATE queued_posts SET status = $2, error_message = $3, updated_at = now()
        WHERE id = $1`,
      [post.id, status, e.message]
    );
    await logPost({
      run_id: null, user_id: post.user_id, platform: post.platform,
      status: e.unconfirmed ? 'unconfirmed' : 'fail',
      post_id: null, error_message: e.message,
      theme: post.theme, product_name: null, tone: post.tone,
      caption: post.caption, hashtags: post.hashtags, cta: post.cta,
      image_url: post.image_url, destination_url: post.destination_url,
      raw_request: { queued_post_id: post.id },
      raw_response: { error: e.message },
    });
    return { ok: false, status, error: e.message, unconfirmed: Boolean(e.unconfirmed) };
  }
}
