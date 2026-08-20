import { NextResponse } from 'next/server';
import { query } from '../../../lib/db';
import { currentUserId } from '../../../lib/auth';
import { nicheCatalogue, nicheDefaults, NICHE_IDS } from '../../../lib/niches';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'not authenticated' }, { status: 401 });
  const { rows } = await query('SELECT * FROM brand_profiles WHERE user_id = $1', [userId]);
  // The catalogue rides along so the form can offer presets without a second
  // round trip, and without shipping the prompt text itself to the browser.
  return NextResponse.json({ brand: rows[0] || null, niches: nicheCatalogue() });
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

  // Applying a preset fills only the fields the user left empty. Overwriting
  // what somebody already typed because they got curious about a dropdown is
  // the kind of "helpful" that loses work.
  const niche = NICHE_IDS.includes(b.niche) ? b.niche : null;
  const preset = b.apply_preset && niche ? nicheDefaults(niche) : {};
  const pick = (key, max) => {
    const typed = String(b[key] ?? '').trim();
    const value = typed || String(preset[key] ?? '').trim();
    return value ? value.slice(0, max) : null;
  };

  const postsPerDay = Math.min(Math.max(Number(b.auto_posts_per_day) || 1, 1), 5);
  const times = Array.isArray(b.auto_times)
    ? b.auto_times.filter((t) => /^\d{2}:\d{2}$/.test(t)).slice(0, 5)
    : ['10:00'];
  const platforms = Array.isArray(b.auto_platforms) ? b.auto_platforms.slice(0, 6) : [];

  const { rows } = await query(
    `INSERT INTO brand_profiles
       (user_id, store_name, store_url, products, audience, benefits, default_tone,
        niche, custom_prompt, banned_words, language,
        auto_enabled, auto_posts_per_day, auto_times, auto_platforms, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,now())
     ON CONFLICT (user_id) DO UPDATE SET
       store_name = EXCLUDED.store_name,
       store_url = EXCLUDED.store_url,
       products = EXCLUDED.products,
       audience = EXCLUDED.audience,
       benefits = EXCLUDED.benefits,
       default_tone = EXCLUDED.default_tone,
       niche = EXCLUDED.niche,
       custom_prompt = EXCLUDED.custom_prompt,
       banned_words = EXCLUDED.banned_words,
       language = EXCLUDED.language,
       auto_enabled = EXCLUDED.auto_enabled,
       auto_posts_per_day = EXCLUDED.auto_posts_per_day,
       auto_times = EXCLUDED.auto_times,
       auto_platforms = EXCLUDED.auto_platforms,
       updated_at = now()
     RETURNING *`,
    [
      userId,
      pick('store_name', 200),
      pick('store_url', 500),
      pick('products', 1000),
      pick('audience', 1000),
      pick('benefits', 1000),
      pick('default_tone', 100),
      niche,
      pick('custom_prompt', 4000),
      String(b.banned_words || '').trim().slice(0, 500) || null,
      String(b.language || '').trim().slice(0, 40) || 'English',
      Boolean(b.auto_enabled),
      postsPerDay,
      JSON.stringify(times.length ? times : ['10:00']),
      JSON.stringify(platforms),
    ]
  );
  return NextResponse.json({ brand: rows[0] });
}
