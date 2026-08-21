// Who may see the operator's view of the whole instance.
//
// Read from an env var rather than a column: an admin flag in the database can
// be granted by anything that can write to the database, and the blast radius
// of this page is every user's account. Changing who is an operator should
// require deployment access, which is the same bar as reading the database
// directly — nothing here grants power somebody with the env vars lacks.
//
// Fails CLOSED. An unset ADMIN_EMAILS means nobody is an admin, not everybody,
// and not "whoever signed up first". A self-hosted copy that never sets it is
// simply a product without an admin page, which is the safe way to be wrong.

import { query } from './db.js';

function adminEmails() {
  return String(process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email) {
  const allowed = adminEmails();
  if (allowed.length === 0) return false;
  return allowed.includes(String(email || '').trim().toLowerCase());
}

// The session's email is not carried in the JWT for every provider, so the
// address is read back from the row the id points at. That also means removing
// a user immediately removes their admin access.
export async function isAdminUser(userId) {
  if (!userId) return false;
  const { rows } = await query('SELECT email FROM users WHERE id = $1', [userId]);
  return isAdminEmail(rows[0]?.email);
}

export function adminConfigured() {
  return adminEmails().length > 0;
}
