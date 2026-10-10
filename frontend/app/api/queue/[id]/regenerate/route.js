import { NextResponse } from 'next/server';
import { query } from '../../../../../lib/db';
import { currentUserId } from '../../../../../lib/auth';
import { regeneratePost, REWRITABLE_SQL } from '../../../../../lib/regenerate';

export const runtime = 'nodejs';
export const maxDuration = 300;

// Re-write one post: { mode: 'text' | 'all', product_id? }.
// See lib/regenerate.js for what each mode remakes.
export async function POST(request, { params }) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'not authenticated' }, { status: 401 });

  let b = {};
  try { b = await request.json(); } catch { /* defaults */ }

  const { rows } = await query(
    `SELECT * FROM queued_posts WHERE id = $1 AND user_id = $2 AND ${REWRITABLE_SQL}`,
    [params.id, userId]
  );
  const post = rows[0];
  if (!post) {
    return NextResponse.json({ error: 'this post can no longer be changed' }, { status: 404 });
  }

  let productId;
  if (b.product_id !== undefined) {
    productId = b.product_id ? Number(b.product_id) : null;
    if (productId) {
      const { rows: owned } = await query('SELECT 1 FROM products WHERE id = $1 AND user_id = $2', [
        productId, userId,
      ]);
      if (owned.length === 0) return NextResponse.json({ error: 'product not found' }, { status: 404 });
    }
  }

  try {
    const result = await regeneratePost(post, {
      mode: b.mode === 'all' ? 'all' : 'text',
      productId,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: e.status || 502 });
  }
}
