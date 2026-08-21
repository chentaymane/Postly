// Publishing a row from queued_posts.
//
// This is the only place a queued post changes into a published one. The Review
// page, the automation runner, the scheduler tick and the render-worker
// callback all come through here, so approval, autopilot and a retry cannot
// drift apart in how they schedule, how they classify a failure, or what they
// record afterwards.

import { query } from './db.js';
import { publishContent, logPost, canScheduleRemotely } from './pipeline.js';
import { appBaseUrl } from './platforms.js';
import { withUserKeys } from './keycontext.js';
import { secretForCredential } from './credentials.js';
import { classifyFailure, nextAttemptAt, exhaustedMessage, MAX_ATTEMPTS } from './retry.js';

// Platforms that refuse a redirect in a post's link.
//
// Pinterest treats any hop through another domain as a shortener or a "funnel
// page" and rejects the pin outright — and repeat attempts put the account at
// risk, which is a far worse outcome than losing a click count. Nothing about
// this is specific to our domain: no redirector we could host would pass.
const NO_REDIRECT_PLATFORMS = new Set(['pinterest']);

// Attribution without a redirect. The destination sees which platform sent the
// visitor through its own analytics, which is what the tracker was for; we just
// do not get to count the click ourselves.
function taggedLink(destination, platform, postId) {
  try {
    const url = new URL(destination);
    if (!url.searchParams.has('utm_source')) url.searchParams.set('utm_source', platform);
    if (!url.searchParams.has('utm_medium')) url.searchParams.set('utm_medium', 'social');
    if (!url.searchParams.has('utm_campaign')) url.searchParams.set('utm_campaign', 'postly');
    url.searchParams.set('utm_content', String(postId));
    return url.toString();
  } catch {
    // Not a parseable URL — send it exactly as the user typed it rather than
    // mangling it into something that will not resolve.
    return destination;
  }
}

// The link that goes out on a post: our tracker, which records the click and
// forwards to the destination. Falls back to the raw URL when the app has no
// public base (so a local run still produces a working link), and skips the
// tracker entirely on platforms that ban redirects.
export function trackedLink(post, platform = post.platform) {
  if (!post.destination_url) return '';
  if (NO_REDIRECT_PLATFORMS.has(platform)) {
    return taggedLink(post.destination_url, platform, post.id);
  }
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

async function connectionFor(userId, platform) {
  const { rows } = await query(
    `SELECT * FROM social_connections
      WHERE user_id = $1 AND platform = $2 AND status = 'connected'
      ORDER BY updated_at DESC LIMIT 1`,
    [userId, platform]
  );
  return rows[0] || null;
}

async function recordFailure(post, error) {
  const kind = classifyFailure(error);

  if (kind === 'unconfirmed') {
    // An unconfirmed publish may well have landed. Parking it in its own state
    // keeps a retry — automatic or human — from posting it twice.
    await query(
      `UPDATE queued_posts
          SET status = 'unconfirmed', error_message = $2, failure_kind = 'unconfirmed',
              next_attempt_at = NULL, last_attempt_at = now(), updated_at = now()
        WHERE id = $1`,
      [post.id, error.message]
    );
    return { ok: false, status: 'unconfirmed', error: error.message, unconfirmed: true };
  }

  const attempts = (post.attempts || 0) + 1;
  const retryAt = kind === 'transient' ? nextAttemptAt(attempts) : null;
  const message = kind === 'transient' && !retryAt
    ? exhaustedMessage(error.message, attempts)
    : error.message;

  await query(
    `UPDATE queued_posts
        SET status = 'failed', error_message = $2, failure_kind = $3,
            attempts = $4, next_attempt_at = $5, last_attempt_at = now(), updated_at = now()
      WHERE id = $1`,
    [post.id, message, kind, attempts, retryAt ? retryAt.toISOString() : null]
  );

  return {
    ok: false,
    status: 'failed',
    error: message,
    failureKind: kind,
    willRetry: Boolean(retryAt),
    retryAt: retryAt ? retryAt.toISOString() : null,
    attempts,
  };
}

// Publishes (or schedules) one queued post and records the outcome.
// Returns { ok, status, post_id, error, unconfirmed, willRetry }.
export async function publishQueuedPost(post, { scheduledAt = null } = {}) {
  const conn = await connectionFor(post.user_id, post.platform);
  if (!conn) {
    const error = new Error(`${post.platform} account not connected`);
    return recordFailure(post, error);
  }

  if (post.format === 'video' && !post.video_url) {
    return { ok: false, status: post.status, error: 'the video has not finished rendering yet' };
  }

  // A future time on a connection that cannot hold one is not an error: Postly
  // keeps the post and the scheduler publishes it at the minute. This is what
  // used to fail outright, which is why auto automations on directly connected
  // accounts generated posts and then never sent any of them.
  if (scheduledAt && !canScheduleRemotely(conn)) {
    await query(
      `UPDATE queued_posts
          SET status = 'scheduled', scheduled_at = $2, delivery = 'postly',
              error_message = NULL, failure_kind = NULL, next_attempt_at = NULL,
              updated_at = now()
        WHERE id = $1`,
      [post.id, scheduledAt]
    );
    return { ok: true, status: 'scheduled', held: true, scheduled_at: scheduledAt };
  }

  const content = contentFromPost(post);

  try {
    // Publish through the exact key this account was connected with —
    // aggregators only recognise an account under its own key.
    const kind = conn.provider === 'zernio' ? 'zernio' : conn.provider === 'socialapi' ? 'socialapi' : null;
    const secret = kind ? await secretForCredential(conn.credential_id, kind, post.user_id) : null;
    const result = await withUserKeys(
      post.user_id,
      () => publishContent({ conn, platform: post.platform, content, scheduledAt }),
      secret && kind ? { [kind]: secret } : {}
    );

    const newStatus = scheduledAt ? 'scheduled' : 'published';
    await query(
      `UPDATE queued_posts
          SET status = $2, scheduled_at = $3, published_post_id = $4,
              platform_post_url = COALESCE($5, platform_post_url),
              delivery = $6, error_message = NULL, failure_kind = NULL,
              next_attempt_at = NULL, last_attempt_at = now(),
              attempts = attempts + 1, updated_at = now()
        WHERE id = $1`,
      [
        post.id, newStatus, scheduledAt, result.post_id, result.post_url || null,
        scheduledAt ? 'aggregator' : 'postly',
      ]
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
    return { ok: true, status: newStatus, post_id: result.post_id, post_url: result.post_url || null };
  } catch (e) {
    const outcome = await recordFailure(post, e);
    await logPost({
      run_id: null, user_id: post.user_id, platform: post.platform,
      status: outcome.unconfirmed ? 'unconfirmed' : 'fail',
      post_id: null, error_message: outcome.error,
      theme: post.theme, product_name: null, tone: post.tone,
      caption: post.caption, hashtags: post.hashtags, cta: post.cta,
      image_url: post.image_url, destination_url: post.destination_url,
      raw_request: { queued_post_id: post.id, attempt: outcome.attempts || null },
      raw_response: { error: e.message, kind: outcome.failureKind || null },
    });
    return outcome;
  }
}

export { MAX_ATTEMPTS };
