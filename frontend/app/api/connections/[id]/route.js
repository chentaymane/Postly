import { NextResponse } from 'next/server';
import { query } from '../../../../lib/db';
import { currentUserId } from '../../../../lib/auth';

export const runtime = 'nodejs';

export async function DELETE(request, { params }) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'not authenticated' }, { status: 401 });

  // user_id in the predicate prevents deleting another user's connection.
  const res = await query(
    `DELETE FROM social_connections WHERE id = $1 AND user_id = $2
     RETURNING provider,
               extra->>'socialapi_account_id' AS sapi_id,
               extra->>'zernio_account_id' AS zernio_id`,
    [params.id, userId]
  );
  if (res.rowCount === 0) {
    return NextResponse.json({ error: 'connection not found' }, { status: 404 });
  }

  // Aggregator connections: also revoke upstream so the account slot frees up.
  const row = res.rows[0];
  try {
    if (row.provider === 'socialapi' && row.sapi_id) {
      const { disconnectAccount } = await import('../../../../lib/socialapi');
      await disconnectAccount(row.sapi_id);
    } else if (row.provider === 'zernio' && row.zernio_id) {
      const { disconnectAccount } = await import('../../../../lib/zernio');
      await disconnectAccount(row.zernio_id);
    }
  } catch { /* local removal already done; aggregator cleanup is best-effort */ }

  return NextResponse.json({ ok: true });
}

// Update per-connection settings, e.g. which Pinterest board to pin to.
export async function PATCH(request, { params }) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'not authenticated' }, { status: 401 });

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const boardId = body.board_id;
  if (!boardId) {
    return NextResponse.json({ error: 'board_id is required' }, { status: 400 });
  }

  const { rows } = await query(
    'SELECT extra FROM social_connections WHERE id = $1 AND user_id = $2',
    [params.id, userId]
  );
  if (rows.length === 0) {
    return NextResponse.json({ error: 'connection not found' }, { status: 404 });
  }

  // Only accept a board the account actually has, so a crafted request can't
  // point the connection at an arbitrary board id.
  const boards = rows[0].extra?.boards || [];
  const match = boards.find((b) => String(b.id) === String(boardId));
  if (!match) {
    return NextResponse.json({ error: 'unknown board for this account' }, { status: 400 });
  }

  await query(
    `UPDATE social_connections
        SET extra = jsonb_set(
                      jsonb_set(extra, '{board_id}', to_jsonb($3::text), true),
                      '{board_name}', to_jsonb($4::text), true),
            updated_at = now()
      WHERE id = $1 AND user_id = $2`,
    [params.id, userId, String(boardId), match.name || null]
  );

  return NextResponse.json({ ok: true, board_id: boardId, board_name: match.name || null });
}
