import { NextResponse } from 'next/server';
import { query } from '../../../../lib/db';
import { currentUserId } from '../../../../lib/auth';

export const runtime = 'nodejs';

// Edit a post's words: a draft before approving it, or a post held here for
// its minute — which is every automation post until it goes out.
export async function PATCH(request, { params }) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'not authenticated' }, { status: 401 });

  let b;
  try {
    b = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const { rows } = await query(
    `UPDATE queued_posts SET
       caption = COALESCE($3, caption),
       hashtags = COALESCE($4, hashtags),
       cta = COALESCE($5, cta),
       pin_title = COALESCE($6, pin_title),
       pin_description = COALESCE($7, pin_description),
       destination_url = COALESCE($8, destination_url),
       updated_at = now()
     WHERE id = $1 AND user_id = $2
       AND (status IN ('draft','failed','unconfirmed')
            OR (status = 'scheduled' AND delivery = 'postly' AND published_post_id IS NULL))
     RETURNING *`,
    [
      params.id, userId,
      b.caption ?? null, b.hashtags ?? null, b.cta ?? null,
      b.pin_title ?? null, b.pin_description ?? null, b.destination_url ?? null,
    ]
  );
  if (rows.length === 0) {
    return NextResponse.json(
      { error: 'too late to edit — it is already going out (or has gone)' },
      { status: 409 }
    );
  }
  return NextResponse.json({ post: rows[0] });
}

export async function DELETE(request, { params }) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'not authenticated' }, { status: 401 });
  const res = await query('DELETE FROM queued_posts WHERE id = $1 AND user_id = $2', [params.id, userId]);
  if (res.rowCount === 0) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
