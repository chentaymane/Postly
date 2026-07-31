import { NextResponse } from 'next/server';
import { query } from '../../../lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public click tracker. Every published post links here instead of straight to
// the store, so a visit is attributed to the exact post and platform that
// earned it. The click is recorded, then the visitor is sent on to the store
// with UTM tags so the store's own analytics agrees with ours.
//
// Deliberately forgiving: a tracking failure must never cost a customer, so any
// error still redirects, and a bad id falls back to the user's store URL.
export async function GET(request, { params }) {
  const id = Number(params.id);
  let destination = null;

  try {
    const { rows } = await query(
      `SELECT q.id, q.user_id, q.platform, q.destination_url,
              b.store_url
         FROM queued_posts q
         LEFT JOIN brand_profiles b ON b.user_id = q.user_id
        WHERE q.id = $1`,
      [Number.isFinite(id) ? id : -1]
    );
    const post = rows[0];
    destination = post?.destination_url || post?.store_url || null;

    if (post) {
      const h = request.headers;
      // Record before redirecting; the insert is cheap and indexed.
      await query(
        `INSERT INTO link_clicks (post_id, user_id, platform, referrer, user_agent, country)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          post.id,
          post.user_id,
          post.platform,
          (h.get('referer') || '').slice(0, 500) || null,
          (h.get('user-agent') || '').slice(0, 500) || null,
          // Vercel supplies the visitor's country on its edge headers.
          h.get('x-vercel-ip-country') || null,
        ]
      );
    }
  } catch {
    // Swallow: never block the visitor on our own bookkeeping.
  }

  if (!destination) {
    return NextResponse.json({ error: 'unknown link' }, { status: 404 });
  }

  // Tag the outbound URL so the store's analytics attributes it too.
  let url;
  try {
    url = new URL(destination);
  } catch {
    return NextResponse.json({ error: 'invalid destination' }, { status: 500 });
  }
  if (!url.searchParams.has('utm_source')) {
    url.searchParams.set('utm_source', 'postly');
    url.searchParams.set('utm_medium', 'social');
    if (Number.isFinite(id)) url.searchParams.set('utm_content', `post-${id}`);
  }

  return NextResponse.redirect(url.toString(), 302);
}
