// Encryption for user-supplied API keys.
//
// These are other people's credentials: a database leak must not hand an
// attacker working keys. Secrets are sealed with AES-256-GCM, which also
// authenticates the ciphertext, so tampering fails loudly instead of
// decrypting to garbage.
//
// The key comes from CREDENTIALS_KEY, falling back to AUTH_SECRET so an
// existing deployment keeps working. Rotating either one makes stored secrets
// undecryptable — users would have to re-enter their keys.

import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;   // 96-bit nonce, the size GCM is defined for
const TAG_BYTES = 16;

let cachedKey = null;

function encryptionKey() {
  if (cachedKey) return cachedKey;
  const material = process.env.CREDENTIALS_KEY || process.env.AUTH_SECRET;
  if (!material) {
    throw new Error(
      'CREDENTIALS_KEY (or AUTH_SECRET) must be set before API keys can be stored'
    );
  }
  // Hashing accepts a secret of any length and yields the 32 bytes AES-256 needs.
  cachedKey = crypto.createHash('sha256').update(material).digest();
  return cachedKey;
}

// Returns "v1.<iv>.<tag>.<ciphertext>", all base64url.
export function seal(plaintext) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, encryptionKey(), iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join('.');
}

export function open(sealed) {
  if (typeof sealed !== 'string') return null;
  const parts = sealed.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') return null;
  try {
    const iv = Buffer.from(parts[1], 'base64url');
    const tag = Buffer.from(parts[2], 'base64url');
    const ct = Buffer.from(parts[3], 'base64url');
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) return null;
    const decipher = crypto.createDecipheriv(ALGORITHM, encryptionKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch {
    // Wrong key or tampered payload — treat as unusable rather than throwing
    // a stack trace that might leak context.
    return null;
  }
}

// A safe-to-display fingerprint: enough to recognise a key, useless to steal.
export function maskSecret(secret) {
  const s = String(secret || '');
  if (s.length <= 12) return '•'.repeat(Math.max(s.length, 4));
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}
