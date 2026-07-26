import { NextResponse } from 'next/server';
import { query } from '../../../../lib/db';

export const runtime = 'nodejs';

export async function DELETE(request, { params }) {
  await query('DELETE FROM social_connections WHERE id = $1', [params.id]);
  return NextResponse.json({ ok: true });
}

// Update per-connection settings, e.g. which Pinterest board to pin to.
export async function PATCH(request, { params }) {
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

  // Resolve the board's name from the stored board list so the UI stays in sync.
  const { rows } = await query('SELECT extra FROM social_connections WHERE id = $1', [params.id]);
  if (rows.length === 0) {
    return NextResponse.json({ error: 'connection not found' }, { status: 404 });
  }
  const boards = rows[0].extra?.boards || [];
  const match = boards.find((b) => String(b.id) === String(boardId));

  await query(
    `UPDATE social_connections
        SET extra = jsonb_set(
                      jsonb_set(extra, '{board_id}', to_jsonb($2::text), true),
                      '{board_name}', to_jsonb($3::text), true),
            updated_at = now()
      WHERE id = $1`,
    [params.id, String(boardId), match?.name || null]
  );

  return NextResponse.json({ ok: true, board_id: boardId, board_name: match?.name || null });
}
