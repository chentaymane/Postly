import { NextResponse } from 'next/server';
import { currentUserId } from '../../../lib/auth';
import {
  CREDENTIAL_KINDS, listCredentials, addCredential, verifySecret, markCredential,
} from '../../../lib/credentials';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The catalogue of key types plus what this user has stored. Secrets are never
// returned — only a masked hint.
export async function GET() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'not authenticated' }, { status: 401 });

  const kinds = Object.entries(CREDENTIAL_KINDS).map(([kind, meta]) => ({ kind, ...meta }));
  return NextResponse.json({ kinds, credentials: await listCredentials(userId) });
}

// Adds a key. It is verified live first so a typo is caught here rather than
// silently failing at publish time hours later.
export async function POST(request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'not authenticated' }, { status: 401 });

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const kind = String(body.kind || '');
  const secret = String(body.secret || '').trim();
  if (!CREDENTIAL_KINDS[kind]) {
    return NextResponse.json({ error: 'unknown key type' }, { status: 400 });
  }
  if (!secret) {
    return NextResponse.json({ error: 'paste the API key' }, { status: 400 });
  }

  const check = await verifySecret(kind, secret);
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: 400 });
  }

  try {
    const row = await addCredential(userId, { kind, secret, label: body.label });
    await markCredential(row.id, userId, { status: 'ok' });
    return NextResponse.json({ credential: { ...row, status: 'ok' } });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
