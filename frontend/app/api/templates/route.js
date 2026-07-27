import { NextResponse } from 'next/server';
import { query } from '../../../lib/db';
import { currentUserId } from '../../../lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'not authenticated' }, { status: 401 });
  const { rows } = await query(
    'SELECT * FROM post_templates WHERE user_id = $1 ORDER BY id DESC LIMIT 50',
    [userId]
  );
  return NextResponse.json({ templates: rows });
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

  const name = String(b.name || '').trim().slice(0, 80);
  if (!name) return NextResponse.json({ error: 'template name is required' }, { status: 400 });

  const { rows } = await query(
    `INSERT INTO post_templates
       (user_id, name, theme, product_name, description, tone, destination_url, platforms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
     RETURNING *`,
    [
      userId, name,
      String(b.theme || '').slice(0, 500) || null,
      String(b.productName || '').slice(0, 200) || null,
      String(b.description || '').slice(0, 1000) || null,
      String(b.tone || '').slice(0, 100) || null,
      String(b.destinationUrl || '').slice(0, 500) || null,
      JSON.stringify(Array.isArray(b.platforms) ? b.platforms.slice(0, 6) : []),
    ]
  );
  return NextResponse.json({ template: rows[0] });
}
