// Shared plumbing for the render worker (worker/render_worker.py), which runs
// either on GitHub Actions (.github/workflows/render.yml) or on a machine of
// your own.
//
// Rendering needs Piper and FFmpeg, which cannot run on a serverless function,
// so the worker runs somewhere that has them and talks to /api/render/*.
// It is not a user: it authenticates with a shared token, not a session.
import { timingSafeEqual } from 'node:crypto';
import { query } from './db.js';

// How many times a draft may be handed to a renderer before it is declared
// unrenderable. Two retries cover a flaky image host or a runner that died
// mid-job; a third failure is a real defect in the job, not bad luck.
export const MAX_RENDER_ATTEMPTS = 3;

// How long a claim is honoured before the job is offered to someone else. A
// GitHub runner that is killed mid-render never reports back, so this is the
// only thing that frees the draft.
export const CLAIM_TIMEOUT_MINUTES = 25;

const HEARTBEAT_KEY = 'render_worker_heartbeat';

export function workerAuthorized(request) {
  const secret = process.env.RENDER_WORKER_TOKEN;
  if (!secret) return false;
  const offered = (request.headers.get('authorization') || '').replace(/^Bearer /, '');
  const a = Buffer.from(offered);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Every poll is a sign of life. A renderer that has never checked in and one
// that is merely slow look identical from the Review page otherwise — and the
// first is by far the more common reason a video sits at "Rendering" forever.
export async function recordWorkerHeartbeat(detail = {}) {
  await query(
    `INSERT INTO system_state (key, value, updated_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = now()`,
    [HEARTBEAT_KEY, JSON.stringify(detail)]
  );
}

export async function readWorkerHeartbeat() {
  const { rows } = await query('SELECT value, updated_at FROM system_state WHERE key = $1', [
    HEARTBEAT_KEY,
  ]);
  if (rows.length === 0) return null;
  return { ...rows[0].value, at: rows[0].updated_at };
}
