import { NextResponse } from 'next/server';
import { query } from '../../../lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const limit = Math.min(Number(new URL(request.url).searchParams.get('limit')) || 50, 200);
  try {
    const { rows } = await query(
      `SELECT id, created_at, run_id, platform, status, post_id, error_message,
              theme, product_name, caption, hashtags, cta, image_url, destination_url
         FROM post_logs
        ORDER BY id DESC
        LIMIT $1`,
      [limit]
    );
    return NextResponse.json({ posts: rows });
  } catch (e) {
    return NextResponse.json({ posts: [], error: e.message });
  }
}
