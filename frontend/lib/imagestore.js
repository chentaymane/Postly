// Giving the generated artwork a permanent home.
//
// Images used to be handed to the platforms as pollinations.ai URLs, which the
// aggregator then fetched itself. Two things are wrong with that.
//
// The first broke Instagram outright: the image host rate-limits per IP, and an
// aggregator downloading every slide of a carousel at once gets HTTP 402 on all
// of them. Every carousel run failed with "Failed to validate Instagram image:
// bad status code: 402" while Pinterest, which fetches differently, went
// through — so it read as an Instagram problem rather than an image-host one.
//
// The second is quieter and worse: that host *generates on request*. A URL is a
// recipe, not a picture. The image a user approved in Review is not necessarily
// the image the platform later fetched, and nothing anywhere would say so.
//
// Copying each image into blob storage once, at generation time, fixes both.
// The platform fetches a static file that cannot be rate-limited and cannot
// change after approval.

import { put } from '@vercel/blob';
import { fetchGeneratedImage } from './imagehost.js';

// Vercel names a store's token after the store. The public store is the one
// platforms can actually read from; the private one would 403 them, which is a
// failure that only shows up at publish time.
function blobToken() {
  return (
    process.env.PUBLIC_BLOB_READ_WRITE_TOKEN_READ_WRITE_TOKEN
    || process.env.POSTLY_BLOB_READ_WRITE_TOKEN
    || process.env.BLOB_READ_WRITE_TOKEN
    || null
  );
}

export function imageStoreEnabled() {
  return Boolean(blobToken());
}

// The generator rate-limits concurrent requests from one address, so a caller
// that asks for four slides at once gets four refusals. Everything here is
// deliberately sequential, with a pause between attempts.
const GAP_MS = 900;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchWithRetry(url, { attempts = 3, timeoutMs = 60000 } = {}) {
  let lastError = null;
  for (let n = 0; n < attempts; n++) {
    if (n > 0) await sleep(GAP_MS * (n + 1));
    try {
      const res = await fetchGeneratedImage(url, { timeoutMs });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 1000) return buf;
        lastError = `returned only ${buf.length} bytes`;
        continue;
      }
      // 402 and 429 are the rate limit; waiting is the whole remedy.
      lastError = `HTTP ${res.status}`;
    } catch (e) {
      lastError = e.message;
    }
  }
  throw new Error(`could not download the generated image (${lastError})`);
}

// Copies one generated image into blob storage and returns its public URL.
// Returns the original URL unchanged when no store is configured, so a
// self-hosted copy without blob storage still works exactly as before.
export async function persistImage(url, { key, buffer = null, attempts = 3, timeoutMs = 60000 }) {
  if (!url || !imageStoreEnabled()) return url;
  // Already ours: re-uploading would just pay for the same bytes twice.
  if (/\.public\.blob\.vercel-storage\.com/i.test(url)) return url;

  try {
    // Generation already downloaded this to check its dimensions. Reusing those
    // bytes halves how often the rate-limited host is asked for the same image.
    const bytes = buffer || await fetchWithRetry(url, { attempts, timeoutMs });
    const { url: hosted } = await put(`postly/${key}.jpg`, bytes, {
      access: 'public',
      token: blobToken(),
      contentType: 'image/jpeg',
      // The key already carries a random seed, and overwriting a key we just
      // minted is never what we want.
      addRandomSuffix: true,
      cacheControlMaxAge: 31536000,
    });
    return hosted;
  } catch (e) {
    // A post with a working recipe URL beats no post at all: fall back to the
    // original and let the platform try. The failure is logged by the caller.
    console.error(`persistImage failed for ${key}:`, e.message);
    return url;
  }
}

// Several images, one after another. Sequential on purpose — see GAP_MS.
export async function persistImages(urls, { prefix, buffers = [] }) {
  const out = [];
  for (const [i, url] of (urls || []).entries()) {
    // No pause needed when the bytes are already in hand.
    if (i > 0 && !buffers[i]) await sleep(GAP_MS);
    out.push(await persistImage(url, { key: `${prefix}-${i + 1}`, buffer: buffers[i] || null }));
  }
  return out;
}
