// Shared auth for the local render worker (worker/render_worker.py).
//
// Rendering needs Piper and FFmpeg, which cannot run on a serverless function,
// so the worker runs on a machine that has them and talks to /api/render/*.
// It is not a user: it authenticates with a shared token, not a session.
export function workerAuthorized(request) {
  const secret = process.env.RENDER_WORKER_TOKEN;
  if (!secret) return false;
  return (request.headers.get('authorization') || '') === `Bearer ${secret}`;
}
