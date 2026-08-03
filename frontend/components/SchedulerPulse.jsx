'use client';

import { useEffect } from 'react';

// Keeps the scheduler running while somebody has the app open.
//
// Vercel's Hobby plan triggers a cron once a day whatever the expression says,
// so on that plan the cron alone cannot deliver a post at 10:00. This pings the
// scheduler on load and every few minutes afterwards; the endpoint itself
// refuses to do anything if a tick already ran recently, so an open tab is a
// safety net rather than a second scheduler.
//
// It is a fallback, not the design: /automations shows how long ago the last
// tick was and tells the user to point a real scheduler at the cron URL if the
// gap is growing.
const INTERVAL_MS = 4 * 60000;

export default function SchedulerPulse() {
  useEffect(() => {
    let stopped = false;

    const ping = () => {
      // Nothing to catch up on while the tab is in the background, and a
      // hidden tab firing work the user cannot see is wasted quota.
      if (document.visibilityState !== 'visible') return;
      fetch('/api/scheduler', { method: 'POST', cache: 'no-store' }).catch(() => {});
    };

    const t = setTimeout(() => { if (!stopped) ping(); }, 2500);
    const i = setInterval(ping, INTERVAL_MS);
    document.addEventListener('visibilitychange', ping);

    return () => {
      stopped = true;
      clearTimeout(t);
      clearInterval(i);
      document.removeEventListener('visibilitychange', ping);
    };
  }, []);

  return null;
}
