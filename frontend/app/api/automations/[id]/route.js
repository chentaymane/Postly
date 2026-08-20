import { NextResponse } from 'next/server';
import { query } from '../../../../lib/db';
import { currentUserId } from '../../../../lib/auth';
import { POST_TYPES, FORMATS, APPROVALS } from '../../../../lib/automations';
import { nextRunAt, normaliseTimes, isValidTimezone, timezoneLabel } from '../../../../lib/schedule';

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

  const times = Array.isArray(b.times) ? normaliseTimes(b.times) : null;

  // Changing the schedule invalidates the watermark: it marks how far the
  // scheduler has read *the old times*, and leaving it in place would either
  // replay slots or skip the first day of the new ones. Resetting to now means
  // the new schedule starts cleanly from this moment.
  const scheduleChanged =
    (times && times.length > 0) || (b.timezone !== undefined) || (b.catch_up_hours !== undefined);

  const { rows } = await query(
    `UPDATE automations SET
       name        = COALESCE($3, name),
       enabled     = COALESCE($4, enabled),
       post_type   = COALESCE($5, post_type),
       format      = COALESCE($6, format),
       platforms   = COALESCE($7::jsonb, platforms),
       times       = COALESCE($8::jsonb, times),
       timezone    = COALESCE($9, timezone),
       theme       = CASE WHEN $10::boolean THEN $11 ELSE theme END,
       tone        = CASE WHEN $12::boolean THEN $13 ELSE tone END,
       approval    = COALESCE($14, approval),
       catch_up_hours   = COALESCE($15, catch_up_hours),
       custom_prompt    = CASE WHEN $17::boolean THEN $18 ELSE custom_prompt END,
       scheduled_through = CASE WHEN $16::boolean THEN now() ELSE scheduled_through END,
       updated_at  = now()
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
      isValidTimezone(b.timezone) ? b.timezone : null,
      b.theme !== undefined, b.theme !== undefined ? String(b.theme).trim().slice(0, 500) || null : null,
      b.tone !== undefined, b.tone !== undefined ? String(b.tone).trim().slice(0, 100) || null : null,
      APPROVALS.includes(b.approval) ? b.approval : null,
      b.catch_up_hours !== undefined ? Math.max(0, Math.min(48, Number(b.catch_up_hours) || 6)) : null,
      scheduleChanged,
      b.custom_prompt !== undefined,
      b.custom_prompt !== undefined
        ? String(b.custom_prompt).trim().slice(0, 4000) || null
        : null,
    ]
  );
  if (rows.length === 0) return NextResponse.json({ error: 'automation not found' }, { status: 404 });

  const a = rows[0];
  return NextResponse.json({
    automation: {
      ...a,
      next_run_at: a.enabled ? nextRunAt(a) : null,
      tz_label: timezoneLabel(a.timezone),
    },
  });
}

export async function DELETE(request, { params }) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'not authenticated' }, { status: 401 });
  const res = await query('DELETE FROM automations WHERE id = $1 AND user_id = $2', [params.id, userId]);
  if (res.rowCount === 0) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
