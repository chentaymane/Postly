// Request-scoped API keys.
//
// Every provider client needs "the key belonging to whoever is making this
// request". Passing that down through generation, publishing and each client
// would mean an extra argument on a few dozen functions, and one missed call
// site would silently fall back to the operator's key — billing the wrong
// person. AsyncLocalStorage carries it implicitly instead: set once at the API
// boundary, visible everywhere below it, and impossible to leak between
// concurrent requests.

import { AsyncLocalStorage } from 'node:async_hooks';
import { resolveSecret } from './credentials.js';

const storage = new AsyncLocalStorage();

// Used when there is no user in scope (a cron tick, a script). With a user,
// resolution goes through credentials.js, which knows the same names.
const ENV_FALLBACK = {
  zernio: 'ZERNIO_API_KEY',
  socialapi: 'SOCIALAPI_KEY',
  groq: 'GROQ_API_KEY',
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
};

// Runs `fn` with this user's keys in scope. `overrides` pins a specific secret
// (used when publishing must go through the exact key that made a connection).
export function withUserKeys(userId, fn, overrides = {}) {
  return storage.run({ userId, overrides, cache: new Map() }, fn);
}

export function currentUserIdFromContext() {
  return storage.getStore()?.userId ?? null;
}

// The key for a provider: pinned override, then the user's own, then the
// deployment's env var (which keeps the single-user setup working).
export async function keyFor(kind) {
  const store = storage.getStore();

  if (store?.overrides?.[kind]) return store.overrides[kind];

  if (store?.userId) {
    if (store.cache.has(kind)) return store.cache.get(kind);
    let secret = null;
    try {
      const resolved = await resolveSecret(store.userId, kind);
      secret = resolved?.secret || null;
    } catch {
      secret = null;
    }
    if (!secret) secret = process.env[ENV_FALLBACK[kind]] || null;
    store.cache.set(kind, secret);
    return secret;
  }

  return process.env[ENV_FALLBACK[kind]] || null;
}

// Cheap check used by the platform catalogue.
export async function hasKey(kind) {
  return Boolean(await keyFor(kind));
}
