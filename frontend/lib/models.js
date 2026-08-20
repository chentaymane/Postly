// Which model each provider should actually be asked for.
//
// Postly hardcoded `llama-3.3-70b-versatile` for Groq. Providers retire models
// on their own schedule, and when that one went the app did not degrade — every
// single generation failed with "the model does not exist", on every platform,
// for as long as nobody looked. A pinned model is a scheduled outage.
//
// So the model is resolved at call time: ask the provider what it currently
// serves, keep the best match from a preference list, and remember it. An
// explicit env override still wins, for a deployment that wants to pin.

import { keyFor } from './keycontext.js';

// Preference order per provider, best first. These are matched as prefixes
// against whatever the provider reports, so a dated variant
// (`gpt-4o-mini-2024-07-18`) still matches `gpt-4o-mini`.
const PREFERRED = {
  groq: [
    'openai/gpt-oss-120b',
    'qwen/qwen3',
    'openai/gpt-oss-20b',
    'llama-3.3-70b',
    'groq/compound',
    'llama-3.1-8b',
  ],
  openai: ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4.1'],
  gemini: ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-flash'],
  anthropic: ['claude-sonnet-4-5', 'claude-3-5-sonnet', 'claude-3-5-haiku'],
};

// Used when discovery is impossible (no listing endpoint, or the call fails).
// Never the only line of defence — the caller retries on a model error.
const FALLBACK = {
  groq: 'openai/gpt-oss-120b',
  openai: 'gpt-4o-mini',
  gemini: 'gemini-2.0-flash',
  anthropic: 'claude-sonnet-4-5',
};

const ENV_OVERRIDE = {
  groq: 'GROQ_MODEL',
  openai: 'OPENAI_MODEL',
  gemini: 'GEMINI_MODEL',
  anthropic: 'ANTHROPIC_MODEL',
};

// Providers that expose an OpenAI-style /models listing.
const LIST_URL = {
  groq: 'https://api.groq.com/openai/v1/models',
  openai: 'https://api.openai.com/v1/models',
};

// Models that exist but cannot write a caption: speech, moderation, embeddings.
const NOT_A_WRITER = /whisper|tts|guard|embed|moderation|vision-only|orpheus|distil/i;

// Resolved model per provider, cached for the life of the lambda. Discovery is
// one extra request; doing it on every post would be wasteful, and doing it
// once per cold start is not.
const cache = new Map();

// Providers whose env override has already been rejected by the API. An
// override is a preference, not a promise: GROQ_MODEL outlived the model it
// named, and honouring it forever turned a one-line env var into a total
// outage. Once the provider says the pinned model is gone, we stop asking.
const rejectedOverride = new Set();

async function listModels(kind) {
  const url = LIST_URL[kind];
  if (!url) return null;
  const key = await keyFor(kind);
  if (!key) return null;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const ids = (json.data || []).map((m) => m.id).filter((id) => id && !NOT_A_WRITER.test(id));
    return ids.length ? ids : null;
  } catch {
    return null;
  }
}

// The best available model for a provider.
export async function modelFor(kind) {
  const override = process.env[ENV_OVERRIDE[kind]];
  if (override && !rejectedOverride.has(kind)) return override;
  if (cache.has(kind)) return cache.get(kind);

  const available = await listModels(kind);
  let chosen = FALLBACK[kind];

  if (available) {
    const preferred = PREFERRED[kind] || [];
    const hit =
      preferred.map((p) => available.find((id) => id.startsWith(p))).find(Boolean) ||
      // Nothing preferred is served any more: rather than fail, take whatever
      // the provider does offer. A working unfamiliar model beats no post.
      available[0];
    if (hit) chosen = hit;
  }

  cache.set(kind, chosen);
  return chosen;
}

// Called when a provider rejects the model we asked for. Drops the cached
// choice so the next attempt rediscovers, and reports what else is on offer.
export async function forgetModel(kind) {
  cache.delete(kind);
  // If a pinned model is what just failed, stop trusting the pin.
  if (process.env[ENV_OVERRIDE[kind]]) rejectedOverride.add(kind);
  const available = await listModels(kind);
  return available || [];
}

// What the deployment pinned, and whether the provider still serves it. Used by
// the settings page to say "GROQ_MODEL names a model that no longer exists"
// rather than leaving the operator to infer it from a failed post.
export function pinnedModel(kind) {
  const value = process.env[ENV_OVERRIDE[kind]] || null;
  return value ? { envVar: ENV_OVERRIDE[kind], value, rejected: rejectedOverride.has(kind) } : null;
}

// True when this error means "that model is gone", as opposed to a bad key,
// a rate limit, or a network problem — the only case worth rediscovering for.
export function isModelError(message) {
  return /does not exist|do not have access|model_not_found|unknown model|deprecated|decommission|invalid model/i
    .test(String(message || ''));
}

export { PREFERRED as MODEL_PREFERENCES };
