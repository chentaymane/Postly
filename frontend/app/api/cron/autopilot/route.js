import { NextResponse } from 'next/server';
import { runSchedulerTick } from '../../../../lib/scheduler';

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

// The scheduler tick. Runs every few minutes and does whatever is due:
// generates posts for slots that have arrived (catching up ones that were
// missed), publishes posts held here for a specific minute, retries transient
// failures, and reads back what the platforms actually did.
//
// It is deliberately idempotent — every unit of work is guarded by a slot key
// or a status transition — so running it twice, or late, or by hand, is safe.

// Vercel's cron sends the secret as a bearer token. An external scheduler
// (cron-job.org, GitHub Actions, a home server) usually cannot set headers on a
// simple GET, so a header or a query parameter is accepted too — Postly must
// not depend on one hosting provider's cron to post on time.
function authorized(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get('authorization') || '';
  if (auth === `Bearer ${secret}`) return true;
  if (request.headers.get('x-cron-secret') === secret) return true;
  return new URL(request.url).searchParams.get('key') === secret;
}

async function tick(request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  // Which driver this was. Vercel labels its own cron requests; GitHub's runner
  // and a hand-run curl are told apart by user agent. Recorded so the app can
  // say whether a real scheduler is driving this or only an open browser tab.
  const url = new URL(request.url);
  const ua = request.headers.get('user-agent') || '';
  const source =
    url.searchParams.get('source')
    || (ua.includes('vercel-cron') ? 'vercel-cron'
      : ua.includes('curl') ? 'external-cron'
        : 'external');

  // A dry run answers "is this wired up correctly" without generating a word
  // or publishing anything — the only safe way to test against live accounts.
  const dryRun = url.searchParams.get('dry') === '1';

  try {
    // Comfortably inside maxDuration, so the tick reports what it did rather
    // than being killed with the work half done and no record of it.
    const result = await runSchedulerTick({ budgetMs: 240000, dryRun, source });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

export const GET = tick;
export const POST = tick;
