// Asks GitHub Actions to render the video drafts that are waiting.
//
// The render workflow is also on a timer, but that timer has to be slow: this
// repo is private, so every scheduled run spends free Actions minutes whether
// or not there is anything to do. Firing a run at the moment a video draft is
// created is what makes rendering prompt AND cheap — the timer is left as a
// safety net for drafts created while GitHub was refusing dispatches.
//
// Everything here is best-effort. A failed dispatch must never break the
// generation that triggered it: the scheduled run will collect the draft.
import { query } from './db.js';

const DISPATCH_KEY = 'render_dispatch_last';
// Renders are drained in one run, so a burst of drafts (one per platform, one
// per slot) needs one run between them, not one each.
const DEBOUNCE_MS = 3 * 60000;

function config() {
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  // Actions sets GITHUB_REPOSITORY itself; on Vercel it has to be given.
  const repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo) return null;
  return {
    token,
    repo,
    workflow: process.env.GITHUB_RENDER_WORKFLOW || 'render.yml',
    ref: process.env.GITHUB_RENDER_REF || 'main',
  };
}

// Rate limit in the database rather than in memory: serverless instances do
// not share memory, so an in-process guard would let every concurrent request
// through.
async function claimDispatch() {
  const { rowCount } = await query(
    `INSERT INTO system_state (key, value, updated_at)
     VALUES ($1, '{}'::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET updated_at = now()
       WHERE system_state.updated_at < now() - ($2 || ' milliseconds')::interval`,
    [DISPATCH_KEY, String(DEBOUNCE_MS)]
  );
  return rowCount > 0;
}

export async function requestRender({ force = false } = {}) {
  const cfg = config();
  if (!cfg) return { ok: false, skipped: 'not configured' };

  try {
    if (!force && !(await claimDispatch())) {
      return { ok: true, skipped: 'debounced' };
    }
    const res = await fetch(
      `https://api.github.com/repos/${cfg.repo}/actions/workflows/${cfg.workflow}/dispatches`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${cfg.token}`,
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ ref: cfg.ref }),
        signal: AbortSignal.timeout(10000),
      }
    );
    if (res.status === 204) return { ok: true, dispatched: true };
    const detail = (await res.text()).slice(0, 200);
    console.warn(`render dispatch failed: HTTP ${res.status} ${detail}`);
    return { ok: false, error: `HTTP ${res.status}` };
  } catch (e) {
    console.warn(`render dispatch failed: ${e.message}`);
    return { ok: false, error: e.message };
  }
}
