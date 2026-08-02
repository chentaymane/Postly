import { NextResponse } from 'next/server';
import { query } from '../../../../lib/db';
import { currentUserId } from '../../../../lib/auth';
import { open } from '../../../../lib/secretbox';
import { verifySecret, markCredential } from '../../../../lib/credentials';

export const runtime = 'nodejs';

// Re-checks a stored key against the provider.
export async function POST(request, { params }) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'not authenticated' }, { status: 401 });

  const { rows } = await query(
    'SELECT id, kind, secret FROM user_credentials WHERE id = $1 AND user_id = $2',
    [params.id, userId]
  );
  const row = rows[0];
  if (!row) return NextResponse.json({ error: 'key not found' }, { status: 404 });

  const secret = open(row.secret);
  if (!secret) {
    await markCredential(row.id, userId, { status: 'invalid', error: 'could not decrypt' });
    return NextResponse.json({ ok: false, error: 'this key could not be decrypted — re-add it' });
  }

  const check = await verifySecret(row.kind, secret);
  await markCredential(row.id, userId, {
    status: check.ok ? 'ok' : 'invalid',
    error: check.ok ? null : check.error,
  });
  return NextResponse.json({ ok: check.ok, error: check.error || null });
}

export async function DELETE(request, { params }) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'not authenticated' }, { status: 401 });

  // Warn rather than silently orphan: connections made with this key stop
  // working, because publishing must go through the key that created them.
  const { rows: using } = await query(
    `SELECT count(*)::int AS n FROM social_connections
      WHERE credential_id = $1 AND user_id = $2 AND status = 'connected'`,
    [params.id, userId]
  );
  const res = await query(
    'DELETE FROM user_credentials WHERE id = $1 AND user_id = $2',
    [params.id, userId]
  );
  if (res.rowCount === 0) return NextResponse.json({ error: 'key not found' }, { status: 404 });

  return NextResponse.json({ ok: true, connectionsAffected: using[0]?.n || 0 });
}
