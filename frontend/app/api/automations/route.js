import { NextResponse } from 'next/server';
import { query } from '../../../lib/db';
import { currentUserId } from '../../../lib/auth';
import { POST_TYPES, FORMATS, APPROVALS, nextRunAt } from '../../../lib/automations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Validates and normalises an automation payload from the client.
function clean(b) {
  const times = (Array.isArray(b.times) ? b.times : [])
    .filter((t) => /^\d{1,2}:\d{2}$/.test(t))
    .map((t) => {
      const [h, m] = t.split(':');
      return `${String(Number(h)).padStart(2, '0')}:${m}`;
    })
    .slice(0, 5);

  return {
    name: String(b.name || '').trim().slice(0, 80) || 'Untitled automation',
    enabled: b.enabled !== false,
    post_type: POST_TYPES.includes(b.post_type) ? b.post_type : 'mixed',
    format: FORMATS.includes(b.format) ? b.format : 'single',
    platforms: (Array.isArray(b.platforms) ? b.platforms : []).slice(0, 6),
    times: times.length ? times : ['10:00'],
    theme: String(b.theme || '').trim().slice(0, 500) || null,
    tone: String(b.tone || '').trim().slice(0, 100) || null,
    approval: APPROVALS.includes(b.approval) ? b.approval : 'review',
  };
}

export async function GET() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'not authenticated' }, { status: 401 });

  const { rows } = await query(
    `SELECT a.*,
            (SELECT count(*) FROM queued_posts q WHERE q.automation_id = a.id) AS posts_made
       FROM automations a
      WHERE a.user_id = $1
      ORDER BY a.id`,
    [userId]
  );

  const automations = rows.map((a) => ({
    ...a,
    posts_made: Number(a.posts_made),
    next_run_at: a.enabled ? nextRunAt(a) : null,
  }));
  return NextResponse.json({ automations });
}

export async function POST(request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'not authenticated' }, { status: 401 });

  let b;
  try {
    b = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const a = clean(b);

  const { rows } = await query(
    `INSERT INTO automations
       (user_id, name, enabled, post_type, format, platforms, times, theme, tone, approval)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10)
     RETURNING *`,
    [
      userId, a.name, a.enabled, a.post_type, a.format,
      JSON.stringify(a.platforms), JSON.stringify(a.times), a.theme, a.tone, a.approval,
    ]
  );
  return NextResponse.json({ automation: { ...rows[0], posts_made: 0, next_run_at: nextRunAt(rows[0]) } });
}
