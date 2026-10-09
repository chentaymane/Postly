import { NextResponse } from 'next/server';
import { query } from '../../../../lib/db';
import { currentUserId } from '../../../../lib/auth';

export const runtime = 'nodejs';

// Partial update: only the fields present in the body change.
export async function PATCH(request, { params }) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'not authenticated' }, { status: 401 });

  let b;
  try {
    b = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const given = (key, max) =>
    b[key] === undefined ? null : (String(b[key]).trim().slice(0, max) || null);

  const { rows } = await query(
    `UPDATE products SET
       name        = COALESCE($3, name),
       description = CASE WHEN $4::boolean  THEN $5  ELSE description END,
       benefits    = CASE WHEN $6::boolean  THEN $7  ELSE benefits END,
       url         = CASE WHEN $8::boolean  THEN $9  ELSE url END,
       image_url   = CASE WHEN $10::boolean THEN $11 ELSE image_url END,
       price       = CASE WHEN $12::boolean THEN $13 ELSE price END,
       tags        = CASE WHEN $14::boolean THEN $15 ELSE tags END,
       enabled     = COALESCE($16, enabled),
       updated_at  = now()
     WHERE id = $1 AND user_id = $2
     RETURNING *`,
    [
      params.id, userId,
      given('name', 200),
      b.description !== undefined, given('description', 1000),
      b.benefits !== undefined, given('benefits', 1000),
      b.url !== undefined, given('url', 1000),
      b.image_url !== undefined, given('image_url', 1000),
      b.price !== undefined, given('price', 60),
      b.tags !== undefined, given('tags', 300),
      typeof b.enabled === 'boolean' ? b.enabled : null,
    ]
  );
  if (rows.length === 0) return NextResponse.json({ error: 'product not found' }, { status: 404 });
  return NextResponse.json({ product: rows[0] });
}

export async function DELETE(request, { params }) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'not authenticated' }, { status: 401 });
  // Posts already made about it keep their copy and their link; the reference
  // is nulled by the schema rather than the history being destroyed.
  const res = await query('DELETE FROM products WHERE id = $1 AND user_id = $2', [params.id, userId]);
  if (res.rowCount === 0) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
