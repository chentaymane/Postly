import { NextResponse } from 'next/server';
import { query } from '../../../lib/db';
import { publicCatalog, appBaseUrl } from '../../../lib/platforms';
import { availableConnectors } from '../../../lib/credentials';
import { currentUserId } from '../../../lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const userId = await currentUserId();
  if (!userId) {
    return NextResponse.json({ error: 'not authenticated' }, { status: 401 });
  }

  // Which connectors this user personally holds keys for.
  const platforms = publicCatalog(await availableConnectors(userId));
  const baseUrl = appBaseUrl();

  let connections = [];
  try {
    const { rows } = await query(
      // Disconnected rows are included deliberately. A connection the connector
      // has dropped used to vanish from this list, so the account simply stopped
      // posting with nothing on screen to explain why.
      `SELECT id, platform, account_name, account_id, status, last_error, checked_at,
              extra->>'board_id' AS board_id, extra->>'board_name' AS board_name,
              COALESCE(extra->'boards', '[]'::jsonb) AS boards,
              extra->>'page_name' AS page_name, extra->>'ig_username' AS ig_username,
              updated_at
         FROM social_connections
        WHERE status IN ('connected', 'disconnected') AND user_id = $1
        ORDER BY (status = 'connected') DESC, updated_at DESC`,
      [userId]
    );
    connections = rows;
  } catch {
    // Table missing / DB unreachable — render an empty dashboard rather than 500.
    connections = [];
  }

  return NextResponse.json({ platforms, connections, baseUrl });
}
