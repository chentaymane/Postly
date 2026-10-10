import { NextResponse } from 'next/server';
import { query } from '../../../lib/db';
import { currentUserId } from '../../../lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Posts as lists, for the Schedule page's tabs.
//
//   (default)        — what needs the user: drafts, failures, unconfirmed
//                      publishes, plus everything scheduled
//   ?view=published  — what has gone out, newest first, with its clicks
export async function GET(request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'not authenticated' }, { status: 401 });

  const view = new URL(request.url).searchParams.get('view');

  if (view === 'published') {
    const { rows } = await query(
      `SELECT q.*, p.name AS product_name, a.name AS automation_name,
              COALESCE(q.last_attempt_at, q.updated_at) AS at,
              (SELECT count(*)::int FROM link_clicks c WHERE c.post_id = q.id) AS clicks
         FROM queued_posts q
         LEFT JOIN products p ON p.id = q.product_id
         LEFT JOIN automations a ON a.id = q.automation_id
        WHERE q.user_id = $1 AND q.status = 'published'
        ORDER BY at DESC
        LIMIT 60`,
      [userId]
    );
    return NextResponse.json({ posts: rows });
  }

  const { rows } = await query(
    `SELECT q.*, p.name AS product_name, a.name AS automation_name,
            COALESCE(a.enabled = false, false) AS automation_paused,
            q.scheduled_at AS at
       FROM queued_posts q
       LEFT JOIN products p ON p.id = q.product_id
       LEFT JOIN automations a ON a.id = q.automation_id
      WHERE q.user_id = $1 AND q.status IN ('draft','scheduled','failed','unconfirmed')
      ORDER BY q.id DESC LIMIT 100`,
    [userId]
  );
  return NextResponse.json({ posts: rows });
}
