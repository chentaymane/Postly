// Zernio (formerly Late) client — the primary aggregator. Docs: docs.zernio.com
//
// It covers every platform Postly targets except X, and unlike SocialAPI it
// does not meter posts on the free tier (the free allowance is counted in
// connected accounts), so it is preferred wherever it can serve a platform.
//
// Model: a "profile" is a workspace container; accounts connect into one.
// Connect flow: GET /v1/connect/{platform}?profileId=..&redirect_url=..
// -> { authUrl } -> user authorizes -> Zernio redirects back to redirect_url
// with ?connected=<platform>&profileId=..&accountId=..&username=..

import { keyFor } from './keycontext.js';

const BASE = 'https://api.zernio.com/v1';

export function zernioEnabled() {
  return Boolean(process.env.ZERNIO_API_KEY);
}

// Verified live against their API (2026-07): all of these return a real
// authorize URL on the free tier. X/Twitter is excluded because Zernio
// requires a payment method for it (API pass-through costs).
export const ZERNIO_PLATFORMS = new Set([
  'pinterest',
  'instagram',
  'tiktok',
  'facebook',
  'linkedin',
  'threads',
  'youtube',
]);

// Postly platform key -> Zernio platform name.
export function toZernioPlatform(key) {
  return key === 'x' ? 'twitter' : key;
}

// Reads are quick. Publishing is not: the aggregator downloads every image or
// video from its own servers before handing the post to the platform, so a
// carousel routinely needs well over half a minute.
const READ_TIMEOUT_MS = 30000;
const PUBLISH_TIMEOUT_MS = 120000;

async function api(path, { method = 'GET', body, timeoutMs = READ_TIMEOUT_MS } = {}) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await keyFor('zernio')}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    // A timeout is ambiguous, not a failure: the aggregator may already have
    // accepted the post. Flag it so the caller can verify instead of retrying
    // into a duplicate.
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      const err = new Error(`Zernio did not answer within ${Math.round(timeoutMs / 1000)}s`);
      err.unconfirmed = true;
      throw err;
    }
    throw e;
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error?.message || json?.message || json?.error || `Zernio HTTP ${res.status}`;
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg).slice(0, 200));
  }
  return json;
}

// Zernio requires a profile to connect accounts into. Reuse the first
// existing profile, else create one named "Postly".
export async function ensureProfile() {
  try {
    const list = await api('/profiles');
    const profiles = list.profiles || list.data || (Array.isArray(list) ? list : []);
    if (profiles.length > 0) return profiles[0]._id || profiles[0].id;
  } catch { /* fall through to create */ }
  const created = await api('/profiles', { method: 'POST', body: { name: 'Postly' } });
  const p = created.profile || created;
  const id = p._id || p.id;
  if (!id) throw new Error('could not create a Zernio profile');
  return id;
}

// Returns { authUrl } — send the user there.
export async function createConnectLink({ platform, profileId, redirectUrl }) {
  const qs = new URLSearchParams({ profileId, redirect_url: redirectUrl });
  const json = await api(`/connect/${platform}?${qs}`);
  if (!json.authUrl) throw new Error('Zernio returned no authUrl');
  return json;
}

export async function listAccounts() {
  const json = await api('/accounts');
  return json.accounts || json.data || (Array.isArray(json) ? json : []);
}

export async function listPinterestBoards(accountId) {
  const json = await api(`/accounts/${accountId}/pinterest-boards`);
  const items = json.boards || json.items || json.data || [];
  return items.map((b) => ({ id: String(b.id || b._id), name: b.name }));
}

export function disconnectAccount(accountId) {
  return api(`/accounts/${accountId}`, { method: 'DELETE' });
}

// Most recent posts, used to confirm whether a publish that timed out on our
// side actually went through.
export async function listRecentPosts(limit = 20) {
  const json = await api(`/posts?limit=${limit}`);
  const posts = json.posts || json.data || (Array.isArray(json) ? json : []);
  return posts.map((p) => ({
    id: p._id || p.id || null,
    content: p.content || '',
    title: p.platforms?.[0]?.platformSpecificData?.title || '',
    url: p.platforms?.[0]?.platformPostUrl || null,
    createdAt: p.createdAt || p.created_at || null,
    status: p.status || p.platforms?.[0]?.status || null,
  }));
}

// Cancels a scheduled post on Zernio.
export function deletePost(postId) {
  return api(`/posts/${postId}`, { method: 'DELETE' });
}

// Publishes a Pinterest pin immediately, or schedules it when `scheduledFor`
// (ISO 8601, UTC) is given. Media is attached by URL directly: several image
// URLs become a carousel pin, a video URL becomes a video pin.
// TikTok refuses a post whose privacy level the creator has not allowed, so
// the allowed set is read first. Returns null when unavailable — the caller
// then falls back to the most private option, which every account permits.
export async function tiktokCreatorInfo(accountId) {
  for (const path of [
    `/accounts/${accountId}/tiktok-creator-info`,
    `/accounts/${accountId}/creator-info`,
  ]) {
    try {
      const json = await api(path);
      // These paths do not exist on Zernio today: the API host answers with an
      // HTML page, which parses into something object-shaped but meaningless.
      // Only a real array of levels counts as an answer.
      const info = json?.creatorInfo || json?.data || json;
      const levels = info?.privacy_level_options || info?.privacyLevelOptions || info?.privacyLevels;
      if (Array.isArray(levels) && levels.length) return { levels, raw: info };
    } catch { /* try the next shape */ }
  }
  return null;
}

// Publishes to any Zernio-supported platform. Media attaches by URL, so no
// upload step is needed.
export async function createZernioPost({
  platform, accountId, title, description, link, imageUrls = [], videoUrl, coverUrl,
  scheduledFor, boardId,
}) {
  const zPlatform = toZernioPlatform(platform);

  // Pinterest carousels cap at 5 slides; Instagram and TikTok allow more.
  const maxSlides = platform === 'pinterest' ? 5 : 10;
  const mediaItems = videoUrl
    ? [{ type: 'video', url: videoUrl, ...(coverUrl ? { thumbnailUrl: coverUrl } : {}) }]
    : imageUrls.slice(0, maxSlides).map((url) => ({ type: 'image', url }));
  if (mediaItems.length === 0) throw new Error('nothing to publish: the post has no media');

  const platformSpecificData = {};
  if (platform === 'pinterest') {
    if (boardId) platformSpecificData.boardId = boardId;
    if (title) platformSpecificData.title = title.slice(0, 100);
    if (link) platformSpecificData.link = link;
  } else if (platform === 'instagram') {
    // Feed images and carousels need nothing; a single video posts as a Reel.
    if (videoUrl) platformSpecificData.shareToFeed = true;
    platformSpecificData.isAiGenerated = true;
  } else if (platform === 'youtube') {
    if (title) platformSpecificData.title = title.slice(0, 100);
  }

  const body = {
    content: description,
    ...(scheduledFor
      ? { scheduledFor, timezone: 'UTC', publishNow: false }
      : { publishNow: true }),
    mediaItems,
    platforms: [
      {
        platform: zPlatform,
        accountId,
        ...(Object.keys(platformSpecificData).length ? { platformSpecificData } : {}),
      },
    ],
  };

  // TikTok's settings sit at the top level, and the two consent flags are a
  // legal requirement — the API rejects the post without them.
  if (platform === 'tiktok') {
    const info = await tiktokCreatorInfo(accountId);
    const allowed = info?.levels || [];
    // Default to public. Falling back to SELF_ONLY when the allowed set is
    // unknown published every post privately — the account owner saw nothing
    // and the post looked like it had failed. If TikTok genuinely disallows
    // public posting for this account it rejects the call, which is a visible
    // error the user can act on, unlike a silently invisible post.
    const privacy = allowed.length
      ? (allowed.includes('PUBLIC_TO_EVERYONE') ? 'PUBLIC_TO_EVERYONE' : allowed[0])
      : 'PUBLIC_TO_EVERYONE';
    body.tiktokSettings = {
      privacy_level: privacy,
      allow_comment: true,
      ...(videoUrl ? { allow_duet: true, allow_stitch: true } : {}),
      content_preview_confirmed: true,
      express_consent_given: true,
      is_ai_generated: true,
    };
  }

  const json = await api('/posts', { method: 'POST', body, timeoutMs: PUBLISH_TIMEOUT_MS });
  const post = json.post || json;
  const target = Array.isArray(post.platforms) ? post.platforms[0] : null;
  if (target?.status === 'failed' || post.status === 'failed') {
    throw new Error(target?.error || post.error || 'Zernio publish failed');
  }
  return {
    post_id: target?.platformPostUrl || post._id || post.id || null,
    raw: post,
  };
}

// Backwards-compatible Pinterest wrapper.
export async function createPinPost({
  accountId, boardId, title, description, link, imageUrls = [], videoUrl, coverUrl, scheduledFor,
}) {
  return createZernioPost({
    platform: 'pinterest', accountId, boardId, title, description, link,
    imageUrls, videoUrl, coverUrl, scheduledFor,
  });
}

