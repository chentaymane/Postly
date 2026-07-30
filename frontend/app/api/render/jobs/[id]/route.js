import { NextResponse } from 'next/server';
import { query } from '../../../../../lib/db';
import { workerAuthorized } from '../../../../../lib/renderworker';

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
    const message = String(body.error || 'rendering failed').slice(0, 500);
    const { rowCount } = await query(
      `UPDATE queued_posts SET video_status = 'failed', video_error = $2, updated_at = now()
        WHERE id = $1 AND format = 'video'`,
      [params.id, message]
    );
    if (!rowCount) return NextResponse.json({ error: 'job not found' }, { status: 404 });
    return NextResponse.json({ ok: true, video_status: 'failed' });
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
  // render. Now that the MP4 exists it goes out immediately — otherwise these
  // drafts would pile up forever with nobody to approve them.
  if (post.automation_id && post.status === 'draft') {
    const { rows: autoRows } = await query(
      'SELECT approval FROM automations WHERE id = $1',
      [post.automation_id]
    );
    if (autoRows[0]?.approval === 'auto') {
      const { publishQueuedPost } = await import('../../../../../lib/publishqueued');
      const result = await publishQueuedPost(post);
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
