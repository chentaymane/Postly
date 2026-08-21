import { NextResponse } from 'next/server';
import { query } from '../../../lib/db';
import { currentUserId } from '../../../lib/auth';
import { isAdminUser, adminConfigured } from '../../../lib/admin';
import { readHeartbeat } from '../../../lib/scheduler';
import { readWorkerHeartbeat } from '../../../lib/renderworker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The operator's view of the whole instance.
//
// Everything here was previously only answerable by opening the database and
// writing SQL, which is fine for two users and untenable at fifty — and it
// meant an account whose automations had been failing for a week looked
// exactly like an account that was simply quiet.
export async function GET() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'not authenticated' }, { status: 401 });
  if (!(await isAdminUser(userId))) {
    // Deliberately the same shape as any other refusal: an admin page that
    // says "you are not an admin" confirms the page exists and is worth
    // attacking. 404 tells a stranger nothing.
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const [users, signups, totals, failing, beat, renderBeat, activity] = await Promise.all([
    query(
      `SELECT u.id, u.email, u.name, u.created_at, u.last_login_at, u.onboarded_at,
              (SELECT count(*)::int FROM social_connections s
                WHERE s.user_id = u.id AND s.status = 'connected')             AS connections,
              (SELECT count(*)::int FROM automations a
                WHERE a.user_id = u.id)                                        AS automations,
              (SELECT count(*)::int FROM automations a
                WHERE a.user_id = u.id AND a.enabled)                          AS automations_on,
              (SELECT count(*)::int FROM user_credentials c
                WHERE c.user_id = u.id AND c.status <> 'invalid')              AS keys,
              (SELECT count(*)::int FROM queued_posts q
                WHERE q.user_id = u.id AND q.status = 'published')             AS published,
              (SELECT count(*)::int FROM queued_posts q
                WHERE q.user_id = u.id AND q.status = 'failed')                AS failed,
              (SELECT count(*)::int FROM queued_posts q
                WHERE q.user_id = u.id AND q.status IN ('draft','unconfirmed')) AS pending,
              (SELECT max(q.created_at) FROM queued_posts q WHERE q.user_id = u.id) AS last_post_at
         FROM users u
        ORDER BY u.created_at DESC
        LIMIT 200`
    ),
    query(
      `SELECT to_char(d, 'YYYY-MM-DD') AS day,
              (SELECT count(*)::int FROM users u WHERE u.created_at::date = d) AS n
         FROM generate_series(
                (now() AT TIME ZONE 'UTC')::date - interval '29 days',
                (now() AT TIME ZONE 'UTC')::date, interval '1 day') d
        ORDER BY d`
    ),
    query(
      `SELECT
         (SELECT count(*)::int FROM users)                                        AS users,
         (SELECT count(*)::int FROM users WHERE created_at > now() - interval '7 days')  AS users_7d,
         (SELECT count(*)::int FROM queued_posts WHERE status = 'published')      AS published,
         (SELECT count(*)::int FROM queued_posts
           WHERE status = 'published' AND created_at > now() - interval '7 days') AS published_7d,
         (SELECT count(*)::int FROM queued_posts WHERE status = 'failed')         AS failed,
         (SELECT count(*)::int FROM social_connections WHERE status = 'connected') AS connections,
         (SELECT count(*)::int FROM automations WHERE enabled)                    AS automations_on,
         (SELECT count(*)::int FROM link_clicks)                                  AS clicks`
    ),
    // Accounts that look active but are not working: an enabled automation
    // whose last run failed. This is the row the operator actually needs.
    query(
      `SELECT a.id, a.name, a.user_id, u.email, a.last_run_status, a.last_run_at,
              left(a.last_run_detail, 240) AS detail
         FROM automations a
         JOIN users u ON u.id = a.user_id
        WHERE a.enabled
          AND a.last_run_status IN ('failed', 'partial')
        ORDER BY a.last_run_at DESC NULLS LAST
        LIMIT 25`
    ),
    readHeartbeat().catch(() => null),
    readWorkerHeartbeat().catch(() => null),
    // What has actually happened lately, across everyone. The per-user counts
    // answer "how much"; this answers "what, and is it going wrong right now".
    query(
      `SELECT q.id, q.user_id, u.email, q.platform, q.status, q.format,
              q.pin_title, q.theme, q.error_message, q.platform_post_url,
              q.created_at, q.updated_at
         FROM queued_posts q
         JOIN users u ON u.id = q.user_id
        WHERE q.status <> 'generating'
        ORDER BY q.updated_at DESC
        LIMIT 40`
    ),
  ]);

  const age = (at) => (at ? Date.now() - new Date(at).getTime() : null);

  return NextResponse.json({
    configured: adminConfigured(),
    totals: totals.rows[0],
    users: users.rows,
    signups: signups.rows,
    failing: failing.rows,
    activity: activity.rows,
    scheduler: beat
      ? { ...beat, ageMs: age(beat.at), healthy: age(beat.at) < 25 * 60000 }
      : null,
    renderWorker: renderBeat
      ? { ...renderBeat, ageMs: age(renderBeat.at), healthy: age(renderBeat.at) < 45 * 60000 }
      : null,
  });
}
