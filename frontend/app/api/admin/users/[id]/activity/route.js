import { NextResponse } from 'next/server';
import { query } from '../../../../../../lib/db';
import { currentUserId } from '../../../../../../lib/auth';
import { isAdminUser } from '../../../../../../lib/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// One user's actual history, rather than the counts on the list.
//
// Counts say a user has four failed posts; they do not say the four are the
// same Pinterest link rejection on repeat, which is the difference between
// "this person is struggling" and "this person hit one bug".
export async function GET(request, { params }) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'not authenticated' }, { status: 401 });
  if (!(await isAdminUser(userId))) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const targetId = Number(params.id);
  if (!Number.isInteger(targetId)) {
    return NextResponse.json({ error: 'invalid user id' }, { status: 400 });
  }

  const [user, posts, runs, connections, automations, brand] = await Promise.all([
    query(
      `SELECT id, email, name, created_at, last_login_at, onboarded_at FROM users WHERE id = $1`,
      [targetId]
    ),
    query(
      `SELECT id, platform, status, format, theme, pin_title, image_url,
              platform_post_url, error_message, failure_kind, attempts,
              scheduled_at, created_at, updated_at
         FROM queued_posts
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 40`,
      [targetId]
    ),
    query(
      `SELECT r.id, r.trigger, r.status, r.generated, r.failed, r.detail, r.started_at,
              a.name AS automation
         FROM automation_runs r
         LEFT JOIN automations a ON a.id = r.automation_id
        WHERE r.user_id = $1
        ORDER BY r.started_at DESC
        LIMIT 20`,
      [targetId]
    ),
    query(
      `SELECT platform, account_name, provider, status, last_error, created_at,
              extra->>'board_name' AS board
         FROM social_connections WHERE user_id = $1 ORDER BY created_at DESC`,
      [targetId]
    ),
    query(
      `SELECT id, name, enabled, format, platforms, times, timezone, approval,
              run_count, last_run_at, last_run_status, left(last_run_detail, 200) AS detail
         FROM automations WHERE user_id = $1 ORDER BY id`,
      [targetId]
    ),
    query(
      `SELECT store_name, store_url, niche, language,
              (custom_prompt IS NOT NULL) AS has_rules
         FROM brand_profiles WHERE user_id = $1`,
      [targetId]
    ),
  ]);

  if (user.rows.length === 0) {
    return NextResponse.json({ error: 'user not found' }, { status: 404 });
  }

  return NextResponse.json({
    user: user.rows[0],
    posts: posts.rows,
    runs: runs.rows,
    connections: connections.rows,
    automations: automations.rows,
    brand: brand.rows[0] || null,
  });
}
