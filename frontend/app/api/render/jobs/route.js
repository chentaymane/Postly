import { NextResponse } from 'next/server';
import { query } from '../../../../lib/db';
import {
  workerAuthorized, recordWorkerHeartbeat,
  MAX_RENDER_ATTEMPTS, CLAIM_TIMEOUT_MINUTES,
} from '../../../../lib/renderworker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Job queue for the render worker: hands out video drafts that still need an
// MP4. Claims are atomic, so two workers never render the same draft, and a
// claim that goes stale (runner killed, machine slept) is handed out again.
export async function GET(request) {
  if (!workerAuthorized(request)) {
    // Distinguish "you sent the wrong token" from "this deployment has no
    // token at all". Both used to be the same silent 401, and the second is a
    // very common reason nothing ever renders.
    const configured = Boolean(process.env.RENDER_WORKER_TOKEN);
    return NextResponse.json(
      {
        error: configured
          ? 'unauthorized: token does not match the app\'s RENDER_WORKER_TOKEN'
          : 'RENDER_WORKER_TOKEN is not set on the app — rendering cannot be authorised',
      },
      { status: 401 }
    );
  }
  const params = new URL(request.url).searchParams;
  const limit = Math.min(Number(params.get('limit')) || 1, 5);

  // Checking in counts as a sign of life whether or not there was work, so a
  // renderer that keeps finding an empty queue never looks offline.
  await recordWorkerHeartbeat({ source: request.headers.get('x-worker-source') || 'unknown' });

  // A peek claims nothing. The scheduled workflow uses it to decide whether to
  // spend minutes installing FFmpeg and a voice model at all.
  if (params.get('peek') === '1') {
    const { rows } = await query(
      `SELECT count(*)::int AS waiting FROM queued_posts
        WHERE format = 'video' AND video_url IS NULL
          AND status IN ('draft','failed')
          AND render_attempts < $1
          AND (video_status = 'pending'
               OR (video_status = 'rendering'
                   AND render_claimed_at < now() - ($2 || ' minutes')::interval))`,
      [MAX_RENDER_ATTEMPTS, String(CLAIM_TIMEOUT_MINUTES)]
    );
    return NextResponse.json({ waiting: rows[0].waiting });
  }

  // Retire drafts that have used up their attempts: each was picked up
  // MAX_RENDER_ATTEMPTS times and never reported back, so handing it out again
  // only keeps it saying "Rendering" forever.
  await query(
    `UPDATE queued_posts
        SET video_status = 'failed',
            video_error  = COALESCE(video_error,
                             'Rendering was started ' || render_attempts ||
                             ' times and never finished — the renderer probably ran out of '
                             || 'time or was stopped mid-job. Check the render workflow log.'),
            updated_at   = now()
      WHERE format = 'video'
        AND video_url IS NULL
        AND video_status = 'rendering'
        AND render_attempts >= $1
        AND render_claimed_at < now() - ($2 || ' minutes')::interval`,
    [MAX_RENDER_ATTEMPTS, String(CLAIM_TIMEOUT_MINUTES)]
  );

  const { rows } = await query(
    `UPDATE queued_posts
        SET video_status = 'rendering',
            render_claimed_at = now(),
            render_attempts = render_attempts + 1,
            updated_at = now()
      WHERE id IN (
        SELECT id FROM queued_posts
         WHERE format = 'video'
           AND video_url IS NULL
           AND status IN ('draft','failed')
           AND render_attempts < $2
           AND (video_status = 'pending'
                OR (video_status = 'rendering'
                    AND render_claimed_at < now() - ($3 || ' minutes')::interval))
         ORDER BY id
         FOR UPDATE SKIP LOCKED
         LIMIT $1
      )
      RETURNING id, platform, theme, tone, pin_title, caption, cta, hashtags, script,
                render_attempts`,
    [limit, MAX_RENDER_ATTEMPTS, String(CLAIM_TIMEOUT_MINUTES)]
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
      attempt: r.render_attempts,
      scenes: Array.isArray(r.script) ? r.script : [],
    })),
  });
}
