import { NextResponse } from 'next/server';
import { query } from '../../../lib/db';
import { currentUserId } from '../../../lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Review queue: drafts and scheduled posts, newest first.
export async function GET() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'not authenticated' }, { status: 401 });
  const { rows } = await query(
    `SELECT * FROM queued_posts
      WHERE user_id = $1 AND status IN ('draft','scheduled','failed','unconfirmed')
      ORDER BY id DESC LIMIT 100`,
    [userId]
  );
  return NextResponse.json({ posts: rows });
}
