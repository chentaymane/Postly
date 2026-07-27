// SocialAPI.ai client — the aggregator that provides one-click account
// connection and unified publishing across platforms. Docs: docs.social-api.ai
//
// Flow: POST /v1/accounts/connect -> redirect user to auth_url -> SocialAPI
// handles the platform OAuth -> 302 back to our redirect_uri with
// ?status=success&account_id=...

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

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.SOCIALAPI_KEY}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error?.message || json?.message || `SocialAPI HTTP ${res.status}`;
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
    body: {
      text,
      ...(mediaIds?.length ? { media_ids: mediaIds } : {}),
      ...(scheduledAt ? { scheduled_at: scheduledAt } : { publish_now: true }),
      targets: [
        {
          account_id: accountId,
          ...(platformData ? { platform_data: platformData } : {}),
        },
      ],
    },
  });
}

export function getPost(postId) {
  return api(`/posts/${postId}`);
}

// Media upload. External URLs in media_ids are silently ignored by SocialAPI,
// so the generated image must be uploaded first. Our images are ~100 KB, well
// under the 50 MB single-request limit.
export async function uploadMediaFromUrl(imageUrl) {
  // 1. fetch the generated image bytes (Pollinations URL)
  const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(60000) });
  if (!imgRes.ok) throw new Error(`could not fetch generated image (HTTP ${imgRes.status})`);
  const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
  const blob = new Blob([await imgRes.arrayBuffer()], { type: contentType });

  // 2. single-request server-side upload
  const form = new FormData();
  form.append('file', blob, 'postly-image.jpg');
  const res = await fetch(`${BASE}/media/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.SOCIALAPI_KEY}` },
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
