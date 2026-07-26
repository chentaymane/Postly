import { NextResponse } from 'next/server';
import { query } from '../../../lib/db';
import { publicCatalog, appBaseUrl } from '../../../lib/platforms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const platforms = publicCatalog();
  const baseUrl = appBaseUrl();
  let connections = [];
  try {
    const { rows } = await query(
      `SELECT id, platform, account_name, account_id, status,
              extra->>'board_id' AS board_id, extra->>'board_name' AS board_name,
              COALESCE(extra->'boards', '[]'::jsonb) AS boards,
              updated_at
         FROM social_connections
        WHERE status = 'connected'
        ORDER BY updated_at DESC`
    );
    connections = rows;
  } catch (e) {
    // Table may not exist yet — surface empty list rather than crashing the UI.
    connections = [];
  }
  return NextResponse.json({ platforms, connections, baseUrl });
}
