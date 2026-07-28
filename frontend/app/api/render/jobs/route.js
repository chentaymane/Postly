import { NextResponse } from 'next/server';
import { query } from '../../../../lib/db';
import { workerAuthorized } from '../../../../lib/renderworker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Job queue for the local render worker: hands out video drafts that still
// need an MP4. Claims are atomic, so two workers never render the same draft,
// and a claim that goes stale (worker crashed, machine slept) is handed out
// again after 15 minutes.
export async function GET(request) {
  if (!workerAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const limit = Math.min(Number(new URL(request.url).searchParams.get('limit')) || 1, 5);

  const { rows } = await query(
    `UPDATE queued_posts SET video_status = 'rendering', render_claimed_at = now(), updated_at = now()
      WHERE id IN (
        SELECT id FROM queued_posts
         WHERE format = 'video'
           AND video_url IS NULL
           AND status IN ('draft','failed')
           AND (video_status = 'pending'
                OR (video_status = 'rendering' AND render_claimed_at < now() - interval '15 minutes'))
         ORDER BY id
         FOR UPDATE SKIP LOCKED
         LIMIT $1
      )
      RETURNING id, platform, theme, tone, pin_title, caption, cta, hashtags, script`,
    [limit]
  );

  return NextResponse.json({
    jobs: rows.map((r) => ({
      id: r.id,
      platform: r.platform,
      title: r.pin_title || r.theme,
      tone: r.tone,
      caption: r.caption,
      cta: r.cta,
      hashtags: r.hashtags,
      scenes: Array.isArray(r.script) ? r.script : [],
    })),
  });
}
