import { NextResponse } from 'next/server';
import { query } from '../../../../../lib/db';
import { currentUserId } from '../../../../../lib/auth';
import { refreshProduct } from '../../../../../lib/products';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Re-reads one product's own page: its pictures, full description, facts and
// price. Posts are designed from these, so a new cover in the shop reaches
// the next post without retyping anything.
export async function POST(request, { params }) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'not authenticated' }, { status: 401 });

  const { rows } = await query('SELECT * FROM products WHERE id = $1 AND user_id = $2', [params.id, userId]);
  if (!rows[0]) return NextResponse.json({ error: 'product not found' }, { status: 404 });
  try {
    return NextResponse.json({ product: await refreshProduct(rows[0]) });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 422 });
  }
}
