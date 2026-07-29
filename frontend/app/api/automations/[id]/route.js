import { NextResponse } from 'next/server';
import { query } from '../../../../lib/db';
import { currentUserId } from '../../../../lib/auth';
import { POST_TYPES, FORMATS, APPROVALS, nextRunAt } from '../../../../lib/automations';

export const runtime = 'nodejs';

// Partial update: only the fields present in the body change.
export async function PATCH(request, { params }) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'not authenticated' }, { status: 401 });

  let b;
  try {
    b = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const times = Array.isArray(b.times)
    ? b.times
        .filter((t) => /^\d{1,2}:\d{2}$/.test(t))
        .map((t) => {
          const [h, m] = t.split(':');
          return `${String(Number(h)).padStart(2, '0')}:${m}`;
        })
        .slice(0, 5)
    : null;

  const { rows } = await query(
    `UPDATE automations SET
       name      = COALESCE($3, name),
       enabled   = COALESCE($4, enabled),
       post_type = COALESCE($5, post_type),
       format    = COALESCE($6, format),
       platforms = COALESCE($7::jsonb, platforms),
       times     = COALESCE($8::jsonb, times),
       theme     = CASE WHEN $9::boolean THEN $10 ELSE theme END,
       tone      = CASE WHEN $11::boolean THEN $12 ELSE tone END,
       approval  = COALESCE($13, approval),
       updated_at = now()
     WHERE id = $1 AND user_id = $2
     RETURNING *`,
    [
      params.id, userId,
      b.name !== undefined ? String(b.name).trim().slice(0, 80) || 'Untitled automation' : null,
      typeof b.enabled === 'boolean' ? b.enabled : null,
      POST_TYPES.includes(b.post_type) ? b.post_type : null,
      FORMATS.includes(b.format) ? b.format : null,
      Array.isArray(b.platforms) ? JSON.stringify(b.platforms.slice(0, 6)) : null,
      times && times.length ? JSON.stringify(times) : null,
      b.theme !== undefined, b.theme !== undefined ? String(b.theme).trim().slice(0, 500) || null : null,
      b.tone !== undefined, b.tone !== undefined ? String(b.tone).trim().slice(0, 100) || null : null,
      APPROVALS.includes(b.approval) ? b.approval : null,
    ]
  );
  if (rows.length === 0) return NextResponse.json({ error: 'automation not found' }, { status: 404 });

  const a = rows[0];
  return NextResponse.json({ automation: { ...a, next_run_at: a.enabled ? nextRunAt(a) : null } });
}

export async function DELETE(request, { params }) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'not authenticated' }, { status: 401 });
  const res = await query('DELETE FROM automations WHERE id = $1 AND user_id = $2', [params.id, userId]);
  if (res.rowCount === 0) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
