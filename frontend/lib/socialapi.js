// SocialAPI.ai client — the aggregator that provides one-click account
// connection and unified publishing across platforms. Docs: docs.social-api.ai
//
// Flow: POST /v1/accounts/connect -> redirect user to auth_url -> SocialAPI
// handles the platform OAuth -> 302 back to our redirect_uri with
// ?status=success&account_id=...

import { keyFor } from './keycontext.js';

const BASE = 'https://api.social-api.ai/v1';

export function socialApiEnabled() {
  return Boolean(process.env.SOCIALAPI_KEY);
}

// Platforms SocialAPI.ai can connect with its own managed OAuth apps.
// Verified against their live API (2026-07): excluded are X/Twitter (412 —
// requires bringing your own keys) and Pinterest (403 — paid tiers only, so
// Pinterest routes through our direct integration instead).
export const SOCIALAPI_PLATFORMS = new Set([
  'instagram',
  'facebook',
  'threads',
  'tiktok',
  'linkedin',
  'youtube',
  'google',
]);

// Postly platform key -> SocialAPI platform name.
export function toSocialApiPlatform(key) {
  if (key === 'x') return 'twitter';
  return key;
}

const READ_TIMEOUT_MS = 30000;
const PUBLISH_TIMEOUT_MS = 120000;

async function api(path, { method = 'GET', body, timeoutMs = READ_TIMEOUT_MS } = {}) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await keyFor('socialapi')}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    // Ambiguous, not failed — the post may already be accepted upstream.
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      const err = new Error(`SocialAPI did not answer within ${Math.round(timeoutMs / 1000)}s`);
      err.unconfirmed = true;
      throw err;
    }
    throw e;
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    let msg = json?.error?.message || json?.message || `SocialAPI HTTP ${res.status}`;
    // Validation failures carry the actual issues in a list — surface them.
    const issues = json?.errors || json?.error?.errors || json?.details;
    if (Array.isArray(issues) && issues.length) {
      msg += ': ' + issues.map((i) => i.message || JSON.stringify(i)).join('; ');
    }
    throw new Error(msg);
  }
  return json;
}

// Returns { auth_url, state } — send the user to auth_url.
export function createConnectLink({ platform, redirectUri, state }) {
  return api('/accounts/connect', {
    method: 'POST',
    body: { platform, redirect_uri: redirectUri, state },
  });
}

export function getAccount(accountId) {
  return api(`/accounts/${accountId}`);
}

export function listAccounts() {
  return api('/accounts');
}

export function disconnectAccount(accountId) {
  return api(`/accounts/${accountId}`, { method: 'DELETE' });
}

export function listPinterestBoards(accountId) {
  return api(`/accounts/${accountId}/pinterest-boards`);
}

// Publishes an image post immediately, or schedules it when `scheduledAt`
// (ISO/RFC3339) is given. `platformData` carries per-platform fields keyed by
// SocialAPI platform name.
export function createPost({ accountId, text, mediaIds, platformData, scheduledAt }) {
  return api('/posts', {
    method: 'POST',
    timeoutMs: PUBLISH_TIMEOUT_MS,
    body: {
      text,
      ...(mediaIds?.length ? { media_ids: mediaIds } : {}),
      ...(scheduledAt ? { scheduled_at: scheduledAt } : { publish_now: true }),
      // platform_data lives at the top level of the body (not inside targets).
      ...(platformData ? { platform_data: platformData } : {}),
      targets: [{ account_id: accountId }],
    },
  });
}

export function getPost(postId) {
  return api(`/posts/${postId}`);
}

// Most recent posts, used to confirm whether a publish that timed out on our
// side actually went through.
export async function listRecentPosts(limit = 20) {
  const json = await api(`/posts?limit=${limit}`);
  const posts = json.posts || json.data || (Array.isArray(json) ? json : []);
  return posts.map((p) => ({
    id: p.id || p._id || null,
    content: p.text || p.content || '',
    createdAt: p.created_at || p.createdAt || null,
    status: p.status || p.targets?.[0]?.status || null,
  }));
}

// Cancels a scheduled post (or deletes a draft) on SocialAPI.
export function deletePost(postId) {
  return api(`/posts/${postId}`, { method: 'DELETE' });
}

// Media upload. External URLs in media_ids are silently ignored by SocialAPI,
// so the generated media must be uploaded first. Images are ~100 KB and a
// rendered short is a few MB — both well under the 50 MB single-request limit.
export async function uploadMediaFromUrl(mediaUrl) {
  // 1. fetch the bytes (a generated image, or the worker's rendered MP4)
  const imgRes = await fetch(mediaUrl, { signal: AbortSignal.timeout(120000) });
  if (!imgRes.ok) throw new Error(`could not fetch generated media (HTTP ${imgRes.status})`);
  const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
  const blob = new Blob([await imgRes.arrayBuffer()], { type: contentType });

  // 2. single-request server-side upload
  const form = new FormData();
  form.append('file', blob, contentType.startsWith('video/') ? 'postly-video.mp4' : 'postly-image.jpg');
  const res = await fetch(`${BASE}/media/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await keyFor('socialapi')}` },
    body: form,
    signal: AbortSignal.timeout(120000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.error?.message || json?.message || `media upload failed (HTTP ${res.status})`);
  }
  const mediaId = json.media_id || json.id;
  if (!mediaId) throw new Error('unexpected media upload response from SocialAPI');
  return mediaId;
}
