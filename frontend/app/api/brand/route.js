import { NextResponse } from 'next/server';
import { query } from '../../../lib/db';
import { currentUserId } from '../../../lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'not authenticated' }, { status: 401 });
  const { rows } = await query('SELECT * FROM brand_profiles WHERE user_id = $1', [userId]);
  return NextResponse.json({ brand: rows[0] || null });
}

export async function PUT(request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'not authenticated' }, { status: 401 });

  let b;
  try {
    b = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const postsPerDay = Math.min(Math.max(Number(b.auto_posts_per_day) || 1, 1), 5);
  const times = Array.isArray(b.auto_times)
    ? b.auto_times.filter((t) => /^\d{2}:\d{2}$/.test(t)).slice(0, 5)
    : ['10:00'];
  const platforms = Array.isArray(b.auto_platforms) ? b.auto_platforms.slice(0, 6) : [];

  const { rows } = await query(
    `INSERT INTO brand_profiles
       (user_id, store_name, store_url, products, audience, benefits, default_tone,
        auto_enabled, auto_posts_per_day, auto_times, auto_platforms, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,now())
     ON CONFLICT (user_id) DO UPDATE SET
       store_name = EXCLUDED.store_name,
       store_url = EXCLUDED.store_url,
       products = EXCLUDED.products,
       audience = EXCLUDED.audience,
       benefits = EXCLUDED.benefits,
       default_tone = EXCLUDED.default_tone,
       auto_enabled = EXCLUDED.auto_enabled,
       auto_posts_per_day = EXCLUDED.auto_posts_per_day,
       auto_times = EXCLUDED.auto_times,
       auto_platforms = EXCLUDED.auto_platforms,
       updated_at = now()
     RETURNING *`,
    [
      userId,
      String(b.store_name || '').slice(0, 200) || null,
      String(b.store_url || '').slice(0, 500) || null,
      String(b.products || '').slice(0, 1000) || null,
      String(b.audience || '').slice(0, 1000) || null,
      String(b.benefits || '').slice(0, 1000) || null,
      String(b.default_tone || '').slice(0, 100) || null,
      Boolean(b.auto_enabled),
      postsPerDay,
      JSON.stringify(times.length ? times : ['10:00']),
      JSON.stringify(platforms),
    ]
  );
  return NextResponse.json({ brand: rows[0] });
}
