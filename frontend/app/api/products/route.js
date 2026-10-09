import { NextResponse } from 'next/server';
import { query } from '../../../lib/db';
import { currentUserId } from '../../../lib/auth';
import { importFromUrl } from '../../../lib/products';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'not authenticated' }, { status: 401 });

  const { rows } = await query(
    `SELECT p.*,
            (SELECT count(*)::int FROM queued_posts q
              WHERE q.product_id = p.id AND q.status = 'published') AS posts,
            (SELECT count(*)::int FROM link_clicks c
               JOIN queued_posts q ON q.id = c.post_id
              WHERE q.product_id = p.id)                            AS clicks
       FROM products p
      WHERE p.user_id = $1
      ORDER BY p.enabled DESC, p.times_used ASC, p.id`,
    [userId]
  );
  return NextResponse.json({ products: rows });
}

function clean(b) {
  const text = (v, max) => {
    const s = String(v ?? '').trim();
    return s ? s.slice(0, max) : null;
  };
  return {
    name: text(b.name, 200) || 'Untitled product',
    description: text(b.description, 1000),
    benefits: text(b.benefits, 1000),
    url: text(b.url, 1000),
    image_url: text(b.image_url, 1000),
    price: text(b.price, 60),
    tags: text(b.tags, 300),
    enabled: b.enabled !== false,
  };
}

export async function POST(request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'not authenticated' }, { status: 401 });

  let b;
  try {
    b = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  // Reading a product page fills the form so a catalogue can be built by
  // pasting links rather than retyping every listing — an empty catalogue is
  // the reason posts were generic in the first place.
  if (b.import_url) {
    try {
      return NextResponse.json({ draft: await importFromUrl(b.import_url) });
    } catch (e) {
      return NextResponse.json({ error: e.message }, { status: 422 });
    }
  }

  const p = clean(b);
  const { rows } = await query(
    `INSERT INTO products (user_id, name, description, benefits, url, image_url, price, tags, enabled)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [userId, p.name, p.description, p.benefits, p.url, p.image_url, p.price, p.tags, p.enabled]
  );
  return NextResponse.json({ product: { ...rows[0], posts: 0, clicks: 0 } });
}
