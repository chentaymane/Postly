// Reconciliation: replace assumptions with what the platform actually did.
//
// Publishing is asynchronous. The aggregator accepts a post in milliseconds
// and only later hands it to the platform, which may reject it. Marking a post
// "published" at acceptance therefore produces a dashboard that counts
// requests rather than posts — numbers that look fine while nothing is live.
//
// This reads each post's real outcome back and stores it, so every figure on
// the dashboard is backed by a confirmed result and, where the platform gives
// one, a clickable link.

import { query } from './db.js';
import { withUserKeys } from './keycontext.js';
import { secretForCredential } from './credentials.js';

// Platforms that never return a public URL even for a successful post.
// TikTok's Content Posting API answers with a publish id only, so a missing
// URL there is normal and must not be read as failure.
const NO_URL_PLATFORMS = new Set(['tiktok']);

// Reads one post's state from Zernio using the caller's key context.
async function zernioStatus(postId) {
  const { keyFor } = await import('./keycontext.js');
  const key = await keyFor('zernio');
  if (!key) return null;
  try {
    const res = await fetch(`https://api.zernio.com/v1/posts/${postId}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const p = json.post || json;
    const target = Array.isArray(p.platforms) ? p.platforms[0] : null;
    return {
      status: target?.status || p.status || null,
      url: target?.platformPostUrl || null,
      error: target?.error || target?.errorMessage || null,
    };
  } catch {
    return null;
  }
}

async function socialApiStatus(postId) {
  const { keyFor } = await import('./keycontext.js');
  const key = await keyFor('socialapi');
  if (!key) return null;
  try {
    const res = await fetch(`https://api.social-api.ai/v1/posts/${postId}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const p = json.post || json;
    const target = Array.isArray(p.targets) ? p.targets[0] : null;
    return {
      status: target?.status || p.status || null,
      url: target?.permalink || target?.url || p.permalink || null,
      error: target?.error || null,
    };
  } catch {
    return null;
  }
}

// Brings recent posts for one user up to date. Returns a small summary.
export async function reconcileUser(userId, { limit = 25 } = {}) {
  const { rows } = await query(
    `SELECT q.id, q.platform, q.status, q.published_post_id, q.remote_status,
            s.provider, s.credential_id
       FROM queued_posts q
       LEFT JOIN social_connections s
         ON s.user_id = q.user_id AND s.platform = q.platform AND s.status = 'connected'
      WHERE q.user_id = $1
        AND q.published_post_id IS NOT NULL
        AND (q.remote_status IS NULL OR q.remote_status = 'pending')
      ORDER BY q.id DESC
      LIMIT $2`,
    [userId, limit]
  );

  let checked = 0;
  let confirmed = 0;
  let failed = 0;

  for (const row of rows) {
    const kind = row.provider === 'zernio' ? 'zernio' : row.provider === 'socialapi' ? 'socialapi' : null;
    if (!kind) continue;

    const secret = await secretForCredential(row.credential_id, kind, userId);
    const info = await withUserKeys(
      userId,
      () => (kind === 'zernio' ? zernioStatus(row.published_post_id) : socialApiStatus(row.published_post_id)),
      secret ? { [kind]: secret } : {}
    );
    if (!info) continue;
    checked++;

    const remote = String(info.status || '').toLowerCase();
    const isPublished = remote === 'published' || remote === 'success' || remote === 'completed';
    const isFailed = remote === 'failed' || remote === 'error' || remote === 'rejected';

    // A post is only "published" for our purposes when the platform confirms
    // it. TikTok never returns a URL, so its absence there proves nothing.
    const urlMissingButExpected = !info.url && !NO_URL_PLATFORMS.has(row.platform);

    let localStatus = row.status;
    if (isPublished) { confirmed++; localStatus = 'published'; }
    else if (isFailed) { failed++; localStatus = 'failed'; }

    await query(
      `UPDATE queued_posts
          SET remote_status = $2,
              platform_post_url = COALESCE($3, platform_post_url),
              status = $4,
              error_message = COALESCE($5, error_message),
              reconciled_at = now(),
              updated_at = now()
        WHERE id = $1`,
      [
        row.id,
        isPublished ? 'published' : isFailed ? 'failed' : 'pending',
        info.url || null,
        localStatus,
        isFailed ? (info.error || 'the platform rejected this post') : null,
      ]
    );

    // Surface the odd case where the platform claims success but produced no
    // link on a platform that normally gives one.
    if (isPublished && urlMissingButExpected) {
      await query(
        `UPDATE queued_posts SET error_message = $2 WHERE id = $1 AND error_message IS NULL`,
        [row.id, 'published, but the platform returned no link — check the account']
      );
    }
  }

  return { checked, confirmed, failed, pending: checked - confirmed - failed };
}
