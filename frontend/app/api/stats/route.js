import { NextResponse } from 'next/server';
import { query } from '../../../lib/db';
import { currentUserId } from '../../../lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Everything the dashboard shows, in one round trip.
export async function GET() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'not authenticated' }, { status: 401 });

  const [totals, byPlatform, daily, clicksByPlatform, topPosts, autos, upcoming, recent] =
    await Promise.all([
      query(
        `SELECT
           count(*) FILTER (WHERE status = 'published')   AS published,
           count(*) FILTER (WHERE status = 'scheduled')   AS scheduled,
           count(*) FILTER (WHERE status = 'draft')       AS drafts,
           count(*) FILTER (WHERE status = 'failed')      AS failed,
           count(*) FILTER (WHERE status = 'unconfirmed') AS unconfirmed,
           count(*)                                       AS total
         FROM queued_posts WHERE user_id = $1`,
        [userId]
      ),
      query(
        `SELECT platform,
                count(*) FILTER (WHERE status IN ('published','scheduled')) AS live,
                count(*) AS total
           FROM queued_posts WHERE user_id = $1
          GROUP BY platform ORDER BY live DESC`,
        [userId]
      ),
      // 14-day series, gap-filled so the chart has no holes.
      query(
        `WITH days AS (
           SELECT generate_series(
             (now() AT TIME ZONE 'UTC')::date - interval '13 days',
             (now() AT TIME ZONE 'UTC')::date, interval '1 day')::date AS d
         )
         SELECT days.d::text AS day,
                count(q.id) FILTER (WHERE q.status IN ('published','scheduled')) AS posts,
                (SELECT count(*) FROM link_clicks c
                  WHERE c.user_id = $1 AND c.clicked_at::date = days.d) AS clicks
           FROM days
           LEFT JOIN queued_posts q
             ON q.user_id = $1 AND q.created_at::date = days.d
          GROUP BY days.d ORDER BY days.d`,
        [userId]
      ),
      query(
        `SELECT platform, count(*) AS clicks FROM link_clicks
          WHERE user_id = $1 GROUP BY platform ORDER BY clicks DESC`,
        [userId]
      ),
      query(
        `SELECT q.id, q.platform, q.theme, q.pin_title, q.image_url, q.status,
                count(c.id) AS clicks
           FROM queued_posts q
           LEFT JOIN link_clicks c ON c.post_id = q.id
          WHERE q.user_id = $1
          GROUP BY q.id
         HAVING count(c.id) > 0
          ORDER BY clicks DESC LIMIT 5`,
        [userId]
      ),
      query(
        `SELECT id, name, enabled, post_type, format, platforms, times,
                run_count, last_run_at, last_run_status, approval
           FROM automations WHERE user_id = $1 ORDER BY id`,
        [userId]
      ),
      query(
        `SELECT id, platform, scheduled_at, pin_title, theme, image_url
           FROM queued_posts
          WHERE user_id = $1 AND status = 'scheduled' AND scheduled_at > now()
          ORDER BY scheduled_at LIMIT 5`,
        [userId]
      ),
      query(
        `SELECT id, platform, status, theme, pin_title, image_url, format, updated_at
           FROM queued_posts WHERE user_id = $1
          ORDER BY updated_at DESC LIMIT 6`,
        [userId]
      ),
    ]);

  const num = (v) => Number(v || 0);
  const t = totals.rows[0] || {};

  return NextResponse.json({
    totals: {
      published: num(t.published),
      scheduled: num(t.scheduled),
      drafts: num(t.drafts),
      failed: num(t.failed),
      unconfirmed: num(t.unconfirmed),
      total: num(t.total),
      clicks: clicksByPlatform.rows.reduce((s, r) => s + num(r.clicks), 0),
    },
    byPlatform: byPlatform.rows.map((r) => ({
      platform: r.platform, live: num(r.live), total: num(r.total),
    })),
    daily: daily.rows.map((r) => ({ day: r.day, posts: num(r.posts), clicks: num(r.clicks) })),
    clicksByPlatform: clicksByPlatform.rows.map((r) => ({
      platform: r.platform, clicks: num(r.clicks),
    })),
    topPosts: topPosts.rows.map((r) => ({ ...r, clicks: num(r.clicks) })),
    automations: autos.rows,
    upcoming: upcoming.rows,
    recent: recent.rows,
  });
}
