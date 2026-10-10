// How the server itself downloads a generated image.
//
// Posts carry public image.pollinations.ai URLs, which anyone can open — a
// browser, or a platform fetching the picture. But that host now rations
// anonymous use by address, and requests from shared cloud addresses like
// Vercel's are answered with HTTP 402 nearly every time. That is why the copy
// into our own storage kept failing, and why Instagram, left to fetch the
// original, rejected posts with "bad status code: 402".
//
// With POSTLY_POLLINATIONS_KEY set (a free secret key from
// enter.pollinations.ai), the server asks the keyed API for the same picture
// recipe instead. Without one, or if the keyed request fails, it falls back
// to the public URL exactly as before — so the key is an upgrade, never a new
// way to break.

const KEYED_HOST = 'https://gen.pollinations.ai/image/';
const CARRIED = ['width', 'height', 'seed', 'model', 'nologo'];

function pollinationsKey() {
  return process.env.POSTLY_POLLINATIONS_KEY || process.env.POLLINATIONS_API_KEY || null;
}

// The keyed twin of a public pollinations URL, or null when there is no key
// or the URL is not one of theirs.
function keyedRequest(url) {
  const key = pollinationsKey();
  if (!key) return null;
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.hostname !== 'image.pollinations.ai' || !u.pathname.startsWith('/prompt/')) return null;
  const keyed = new URL(KEYED_HOST + u.pathname.slice('/prompt/'.length));
  for (const k of CARRIED) {
    if (u.searchParams.has(k)) keyed.searchParams.set(k, u.searchParams.get(k));
  }
  return { url: keyed.toString(), headers: { Authorization: `Bearer ${key}` } };
}

// fetch() for a generated image: the keyed API first when there is a key,
// the public URL otherwise or if that fails.
export async function fetchGeneratedImage(url, { timeoutMs = 45000 } = {}) {
  const keyed = keyedRequest(url);
  if (keyed) {
    try {
      const res = await fetch(keyed.url, {
        headers: keyed.headers,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) return res;
      // 401 is a bad key and 402 an exhausted allowance: either way the
      // public URL is still worth a try rather than losing the picture.
      console.error(`keyed image request answered HTTP ${res.status}; trying the public URL`);
    } catch (e) {
      console.error(`keyed image request failed (${e.message}); trying the public URL`);
    }
  }
  return fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
}

export function hasImageKey() {
  return Boolean(pollinationsKey());
}
