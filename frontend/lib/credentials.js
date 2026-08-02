// Per-user provider credentials.
//
// Postly is multi-tenant: each user brings their own API keys, so nothing here
// reads a global key except as a last-resort fallback for the deployment owner
// (which keeps the original single-user setup working).
//
// Aggregator free tiers cap CONNECTED ACCOUNTS per key, not posts. Holding
// several keys of one kind therefore raises the ceiling, so
// `credentialForNewConnection` hands out the least-loaded key.

import { query } from './db.js';
import { open, seal, maskSecret } from './secretbox.js';

export const CREDENTIAL_KINDS = {
  zernio: {
    label: 'Zernio',
    purpose: 'connect',
    blurb: 'Connects Pinterest, Instagram, TikTok, Facebook, LinkedIn, Threads and YouTube.',
    signupUrl: 'https://zernio.com',
    // Free tier allows two connected accounts per key.
    accountsPerKey: 2,
    placeholder: 'sk_...',
  },
  socialapi: {
    label: 'SocialAPI',
    purpose: 'connect',
    blurb: 'Alternative connector; the only one that supports X (Twitter).',
    signupUrl: 'https://social-api.ai',
    accountsPerKey: 2,
    placeholder: 'sapi_key_...',
  },
  groq: {
    label: 'Groq',
    purpose: 'generate',
    blurb: 'Free and very fast. The recommended starting point.',
    signupUrl: 'https://console.groq.com/keys',
    placeholder: 'gsk_...',
    defaultModel: 'llama-3.3-70b-versatile',
  },
  openai: {
    label: 'OpenAI (ChatGPT)',
    purpose: 'generate',
    blurb: 'Use your own ChatGPT API key — GPT models write the captions.',
    signupUrl: 'https://platform.openai.com/api-keys',
    placeholder: 'sk-...',
    defaultModel: 'gpt-4o-mini',
  },
  gemini: {
    label: 'Google Gemini',
    purpose: 'generate',
    blurb: 'Google\'s models, with a free tier of their own.',
    signupUrl: 'https://aistudio.google.com/apikey',
    placeholder: 'AIza...',
    defaultModel: 'gemini-2.0-flash',
  },
  anthropic: {
    label: 'Anthropic (Claude)',
    purpose: 'generate',
    blurb: 'Claude models, strong at natural-sounding copy.',
    signupUrl: 'https://console.anthropic.com/settings/keys',
    placeholder: 'sk-ant-...',
    defaultModel: 'claude-sonnet-4-5',
  },
};

// Generation providers, in the order they are tried. The first one the user
// holds a key for writes the copy; the rest are fallbacks.
export const WRITER_KINDS = ['groq', 'openai', 'gemini', 'anthropic'];

// Env fallback per kind, so the deployment owner needs no setup.
const ENV_FALLBACK = {
  zernio: 'ZERNIO_API_KEY',
  socialapi: 'SOCIALAPI_KEY',
  groq: 'GROQ_API_KEY',
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
};

function envKey(kind) {
  const name = ENV_FALLBACK[kind];
  return name ? process.env[name] || null : null;
}

// Every stored credential of one kind, newest last, decrypted.
export async function listSecrets(userId, kind) {
  const { rows } = await query(
    `SELECT id, secret, status FROM user_credentials
      WHERE user_id = $1 AND kind = $2 AND status <> 'invalid'
      ORDER BY id`,
    [userId, kind]
  );
  return rows
    .map((r) => ({ id: r.id, secret: open(r.secret), status: r.status }))
    .filter((r) => r.secret);
}

// The key to use for a given kind: the user's own first, then the env
// fallback. Returns { secret, credentialId } or null.
export async function resolveSecret(userId, kind) {
  const mine = await listSecrets(userId, kind);
  if (mine.length > 0) return { secret: mine[0].secret, credentialId: mine[0].id };
  const fallback = envKey(kind);
  return fallback ? { secret: fallback, credentialId: null } : null;
}

// The secret behind a specific credential row (used when publishing through
// the exact key a connection was created with).
export async function secretForCredential(credentialId, kind, userId) {
  if (credentialId) {
    const { rows } = await query(
      `SELECT secret FROM user_credentials WHERE id = $1 AND user_id = $2 AND kind = $3`,
      [credentialId, userId, kind]
    );
    const secret = rows[0] ? open(rows[0].secret) : null;
    if (secret) return secret;
  }
  const resolved = await resolveSecret(userId, kind);
  return resolved?.secret || null;
}

// Picks the key with spare capacity when connecting a NEW account. Returns
// null when every key is full, so the UI can tell the user to add another.
export async function credentialForNewConnection(userId, kind) {
  const meta = CREDENTIAL_KINDS[kind];
  const perKey = meta?.accountsPerKey || Infinity;

  const { rows } = await query(
    `SELECT c.id, c.secret,
            (SELECT count(*) FROM social_connections s
              WHERE s.credential_id = c.id AND s.status = 'connected') AS used
       FROM user_credentials c
      WHERE c.user_id = $1 AND c.kind = $2 AND c.status <> 'invalid'
      ORDER BY used ASC, c.id ASC`,
    [userId, kind]
  );

  for (const row of rows) {
    if (Number(row.used) < perKey) {
      const secret = open(row.secret);
      if (secret) return { secret, credentialId: row.id, full: false };
    }
  }

  if (rows.length > 0) {
    // Every key is at capacity — surface that rather than failing obscurely.
    return { secret: null, credentialId: null, full: true };
  }

  const fallback = envKey(kind);
  return fallback ? { secret: fallback, credentialId: null, full: false } : null;
}

// Which connector kinds this user can actually use right now.
export async function availableConnectors(userId) {
  const out = {};
  for (const kind of Object.keys(CREDENTIAL_KINDS)) {
    if (CREDENTIAL_KINDS[kind].purpose !== 'connect') continue;
    const mine = await listSecrets(userId, kind);
    out[kind] = mine.length > 0 || Boolean(envKey(kind));
  }
  return out;
}

// Adds a key. Returns the stored row (never the secret itself).
export async function addCredential(userId, { kind, secret, label }) {
  if (!CREDENTIAL_KINDS[kind]) throw new Error(`unknown credential kind: ${kind}`);
  const clean = String(secret || '').trim();
  if (clean.length < 8) throw new Error('that does not look like an API key');

  const { rows } = await query(
    `INSERT INTO user_credentials (user_id, kind, label, secret, hint)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING id, kind, label, hint, status, created_at`,
    [
      userId,
      kind,
      String(label || CREDENTIAL_KINDS[kind].label).slice(0, 60),
      seal(clean),
      maskSecret(clean),
    ]
  );
  return rows[0];
}

// Public view for the UI: metadata plus usage, never the secret.
export async function listCredentials(userId) {
  const { rows } = await query(
    `SELECT c.id, c.kind, c.label, c.hint, c.status, c.last_error,
            c.verified_at, c.created_at,
            (SELECT count(*) FROM social_connections s
              WHERE s.credential_id = c.id AND s.status = 'connected') AS accounts
       FROM user_credentials c
      WHERE c.user_id = $1
      ORDER BY c.kind, c.id`,
    [userId]
  );
  return rows.map((r) => ({
    ...r,
    accounts: Number(r.accounts),
    capacity: CREDENTIAL_KINDS[r.kind]?.accountsPerKey || null,
  }));
}

export async function markCredential(id, userId, { status, error = null }) {
  await query(
    `UPDATE user_credentials
        SET status = $3, last_error = $4,
            verified_at = CASE WHEN $3 = 'ok' THEN now() ELSE verified_at END,
            updated_at = now()
      WHERE id = $1 AND user_id = $2`,
    [id, userId, status, error ? String(error).slice(0, 300) : null]
  );
}

// Live check that a key works, so a typo is caught at entry rather than at
// publish time. Returns { ok, error }.
export async function verifySecret(kind, secret) {
  const timeout = AbortSignal.timeout(20000);
  try {
    if (kind === 'zernio') {
      const r = await fetch('https://api.zernio.com/v1/profiles', {
        headers: { Authorization: `Bearer ${secret}` }, signal: timeout,
      });
      if (!r.ok) return { ok: false, error: `Zernio rejected the key (HTTP ${r.status})` };
      return { ok: true };
    }
    if (kind === 'socialapi') {
      const r = await fetch('https://api.social-api.ai/v1/accounts', {
        headers: { Authorization: `Bearer ${secret}` }, signal: timeout,
      });
      if (!r.ok) return { ok: false, error: `SocialAPI rejected the key (HTTP ${r.status})` };
      return { ok: true };
    }
    if (kind === 'groq') {
      const r = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { Authorization: `Bearer ${secret}` }, signal: timeout,
      });
      if (!r.ok) return { ok: false, error: `Groq rejected the key (HTTP ${r.status})` };
      return { ok: true };
    }
    if (kind === 'openai') {
      const r = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${secret}` }, signal: timeout,
      });
      if (!r.ok) return { ok: false, error: `OpenAI rejected the key (HTTP ${r.status})` };
      return { ok: true };
    }
    if (kind === 'gemini') {
      // Gemini authenticates with a query parameter rather than a header.
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(secret)}`,
        { signal: timeout }
      );
      if (!r.ok) return { ok: false, error: `Gemini rejected the key (HTTP ${r.status})` };
      return { ok: true };
    }
    if (kind === 'anthropic') {
      const r = await fetch('https://api.anthropic.com/v1/models', {
        headers: { 'x-api-key': secret, 'anthropic-version': '2023-06-01' },
        signal: timeout,
      });
      if (!r.ok) return { ok: false, error: `Anthropic rejected the key (HTTP ${r.status})` };
      return { ok: true };
    }
    return { ok: false, error: `unknown credential kind: ${kind}` };
  } catch (e) {
    return { ok: false, error: e.name === 'TimeoutError' ? 'the provider did not respond' : e.message };
  }
}
