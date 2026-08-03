import { NextResponse } from 'next/server';
import { query } from '../../../../../lib/db';
import { workerAuthorized, MAX_RENDER_ATTEMPTS } from '../../../../../lib/renderworker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The render worker reports back here: { video_url } when the MP4 is hosted
// and ready to publish, or { error } when rendering failed. The draft then
// shows up on the Review page as a playable video ready for approval.
export async function POST(request, { params }) {
  if (!workerAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const videoUrl = String(body.video_url || '').trim();
  if (!videoUrl) {
    // A render failure is usually bad luck rather than a bad job — an image
    // host answering 502, a runner evicted mid-encode. Put the draft back in
    // the queue while it still has attempts left, and only call it failed once
    // they run out, so one flaky minute does not cost the whole video.
    const message = String(body.error || 'rendering failed').slice(0, 500);
    const { rows } = await query(
      `UPDATE queued_posts
          SET video_status = CASE WHEN render_attempts < $3 THEN 'pending' ELSE 'failed' END,
              video_error  = $2,
              render_claimed_at = NULL,
              updated_at   = now()
        WHERE id = $1 AND format = 'video'
        RETURNING video_status, render_attempts`,
      [params.id, message, MAX_RENDER_ATTEMPTS]
    );
    if (!rows[0]) return NextResponse.json({ error: 'job not found' }, { status: 404 });
    return NextResponse.json({
      ok: true,
      video_status: rows[0].video_status,
      attempts: rows[0].render_attempts,
      willRetry: rows[0].video_status === 'pending',
    });
  }

  // Platforms fetch the file themselves, so it has to be publicly reachable
  // over HTTPS — a localhost path would fail much later, at publish time.
  if (!/^https:\/\//i.test(videoUrl)) {
    return NextResponse.json(
      { error: 'video_url must be a public https:// URL the platforms can fetch' },
      { status: 400 }
    );
  }

  const { rows } = await query(
    `UPDATE queued_posts SET video_url = $2, video_status = 'ready', video_error = NULL,
            duration_seconds = $3, updated_at = now()
      WHERE id = $1 AND format = 'video'
      RETURNING *`,
    [params.id, videoUrl, Number(body.duration_seconds) || null]
  );
  const post = rows[0];
  if (!post) return NextResponse.json({ error: 'job not found' }, { status: 404 });

  // A video from an auto-approval automation has been waiting only on the
  // render. Now that the MP4 exists it can go out — otherwise these drafts
  // would pile up forever with nobody to approve them.
  //
  // It goes out *at its slot*, not the moment the render happens to finish:
  // rendering takes minutes and runs on a machine whose availability has
  // nothing to do with the posting schedule, so publishing on completion put
  // videos out at whatever time the worker got round to them.
  if (post.automation_id && post.status === 'draft') {
    const { rows: autoRows } = await query(
      'SELECT approval FROM automations WHERE id = $1',
      [post.automation_id]
    );
    if (autoRows[0]?.approval === 'auto') {
      const slotAt = post.scheduled_at ? new Date(post.scheduled_at) : null;
      const stillAhead = slotAt && slotAt.getTime() > Date.now() + 60000;

      const { publishQueuedPost } = await import('../../../../../lib/publishqueued');
      const result = await publishQueuedPost(post, {
        scheduledAt: stillAhead ? slotAt.toISOString() : null,
      });
      return NextResponse.json({
        ok: true,
        video_status: 'ready',
        published: result.ok,
        post_status: result.status,
        ...(result.error ? { publish_error: result.error } : {}),
      });
    }
  }

  return NextResponse.json({ ok: true, video_status: 'ready' });
}
