import { NextResponse } from 'next/server';
import { query } from '../../../../lib/db';
import { currentUserId } from '../../../../lib/auth';

export const runtime = 'nodejs';

export async function DELETE(request, { params }) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'not authenticated' }, { status: 401 });
  const res = await query('DELETE FROM post_templates WHERE id = $1 AND user_id = $2', [params.id, userId]);
  if (res.rowCount === 0) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
