// Zernio (formerly Late) client — second aggregator, used for Pinterest,
// which SocialAPI.ai does not offer. Docs: docs.zernio.com
//
// Model: a "profile" is a workspace container; accounts connect into one.
// Connect flow: GET /v1/connect/{platform}?profileId=..&redirect_url=..
// -> { authUrl } -> user authorizes -> Zernio redirects back to redirect_url
// with ?connected=pinterest&profileId=..&accountId=..&username=..

const BASE = 'https://api.zernio.com/v1';

export function zernioEnabled() {
  return Boolean(process.env.ZERNIO_API_KEY);
}

export const ZERNIO_PLATFORMS = new Set(['pinterest']);

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.ZERNIO_API_KEY}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
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

export async function listPinterestBoards(accountId) {
  const json = await api(`/accounts/${accountId}/pinterest-boards`);
  const items = json.boards || json.items || json.data || [];
  return items.map((b) => ({ id: String(b.id || b._id), name: b.name }));
}

export function disconnectAccount(accountId) {
  return api(`/accounts/${accountId}`, { method: 'DELETE' });
}

// Publishes a Pinterest pin immediately, or schedules it when `scheduledFor`
// (ISO 8601, UTC) is given. Media is attached by URL directly.
export async function createPinPost({ accountId, boardId, title, description, link, imageUrl, scheduledFor }) {
  const json = await api('/posts', {
    method: 'POST',
    body: {
      content: description,
      ...(scheduledFor
        ? { scheduledFor, timezone: 'UTC', publishNow: false }
        : { publishNow: true }),
      mediaItems: [{ type: 'image', url: imageUrl }],
      platforms: [
        {
          platform: 'pinterest',
          accountId,
          platformSpecificData: {
            ...(boardId ? { boardId } : {}),
            ...(title ? { title: title.slice(0, 100) } : {}),
            ...(link ? { link } : {}),
          },
        },
      ],
    },
  });
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
