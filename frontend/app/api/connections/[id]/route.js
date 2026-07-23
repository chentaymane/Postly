import { NextResponse } from 'next/server';
import { query } from '../../../../lib/db';

export const runtime = 'nodejs';

export async function DELETE(request, { params }) {
  const id = params.id;
  await query('DELETE FROM social_connections WHERE id = $1', [id]);
  return NextResponse.json({ ok: true });
}
