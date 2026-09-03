import { NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
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

  const url = new URL(request.url);
  const ua = request.headers.get('user-agent') || '';
  const source =
    url.searchParams.get('source')
    || (ua.includes('vercel-cron') ? 'vercel-cron'
      : /cron-job\.org/i.test(ua) ? 'cron-job.org'
        : ua.includes('curl') ? 'external-cron'
          : 'external');

  // A dry run answers "is this wired up correctly" without generating a word
  // or publishing anything — the only safe way to test against live accounts.
  const dryRun = url.searchParams.get('dry') === '1';

  // A full tick takes a minute or two: generating a post costs 40-60s and a
  // tick does several. Most external schedulers cap a request far below that —
  // cron-job.org's free tier aborts at 30 seconds — and then record the
  // timeout as a failure, disabling the job after enough of them. The work
  // itself was completing fine; only the answer arrived too late.
  //
  // So the caller may ask to be released as soon as the work is safely under
  // way. Vercel keeps the function alive through waitUntil, so the tick still
  // runs to completion; the scheduler just is not made to wait for it. What it
  // did is recorded in the heartbeat and on /admin either way.
  const detach = url.searchParams.get('wait') === '0';

  try {
    if (detach && !dryRun) {
      waitUntil(
        runSchedulerTick({ budgetMs: 240000, source }).catch((e) => {
          console.error('detached scheduler tick failed:', e.message);
        })
      );
      return NextResponse.json({ ok: true, started: true, source, detached: true });
    }

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
