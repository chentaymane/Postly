// The Schedule page's data: every post coming up, in order, whether it has
// been written yet or not.
//
// Two kinds of entry. A *post* is a row that exists — written, held for its
// minute, waiting for approval, failed, skipped or already out today. A
// *planned* slot is a moment an automation will fill but has not written yet,
// because posts are only written a day ahead. Showing both is what makes the
// schedule readable as a week rather than as whatever happens to exist.

import { query } from './db.js';
import { slotsBetween, timezoneLabel } from './schedule.js';
import { PLAN_AHEAD_MS, schedulerStatus } from './scheduler.js';
import { platformSupportsFormat } from './platforms.js';

// Everything that can sit on the timeline. 'publishing' and 'retrying' are the
// brief states a tick holds a post in while it sends it.
const ON_TIMELINE = [
  'generating', 'draft', 'scheduled', 'publishing', 'retrying',
  'failed', 'unconfirmed', 'skipped',
];

export { slotFor } from './schedule.js';

export const NEEDS_YOU_SQL = `status IN ('draft','failed','unconfirmed')`;

export async function buildSchedule(userId, { days = 7, now = new Date() } = {}) {
  const until = new Date(now.getTime() + days * 86400000);
  // Far enough back to cover "earlier today" in any timezone.
  const since = new Date(now.getTime() - 36 * 3600000);

  const [autoRes, postRes, productRes, needsRes, status, connRes] = await Promise.all([
    query(
      `SELECT id, name, enabled, approval, format, platforms, times, timezone, product_id
         FROM automations WHERE user_id = $1 ORDER BY id`,
      [userId]
    ),
    query(
      `SELECT q.id, q.automation_id, q.platform, q.status, q.format, q.scheduled_at, q.delivery,
              q.caption, q.hashtags, q.cta, q.pin_title, q.pin_description,
              q.image_url, q.image_urls, q.video_url, q.video_status, q.video_error,
              q.error_message, q.failure_kind, q.next_attempt_at, q.attempts,
              q.published_post_id, q.platform_post_url, q.remote_status, q.slot_key,
              q.product_id, q.theme, q.destination_url, q.duration_seconds, q.updated_at,
              p.name AS product_name, p.image_url AS product_image,
              -- A published post is placed at the moment it went out; anything
              -- else at the moment it is for.
              CASE WHEN q.status = 'published'
                   THEN COALESCE(q.last_attempt_at, q.updated_at)
                   ELSE q.scheduled_at END AS at
         FROM queued_posts q
         LEFT JOIN products p ON p.id = q.product_id
        WHERE q.user_id = $1
          AND ((q.status = ANY($2) AND q.scheduled_at BETWEEN $3 AND $4)
               OR (q.status = 'published' AND COALESCE(q.last_attempt_at, q.updated_at) >= $3))
        ORDER BY at, q.id
        LIMIT 400`,
      [userId, ON_TIMELINE, since.toISOString(), until.toISOString()]
    ),
    query(
      `SELECT id, name, image_url, price, enabled FROM products
        WHERE user_id = $1 ORDER BY enabled DESC, name`,
      [userId]
    ),
    query(`SELECT count(*)::int AS n FROM queued_posts WHERE user_id = $1 AND ${NEEDS_YOU_SQL}`, [userId]),
    schedulerStatus(now),
    query(
      `SELECT DISTINCT platform FROM social_connections WHERE user_id = $1 AND status = 'connected'`,
      [userId]
    ),
  ]);
  const connected = new Set(connRes.rows.map((r) => r.platform));

  const automations = autoRes.rows;
  const byId = new Map(automations.map((a) => [String(a.id), a]));

  // Which slots already have a row, whatever its state — published posts lose
  // their scheduled time, so the key is the only reliable way to tell.
  const taken = new Set();
  const enabledIds = automations.filter((a) => a.enabled).map((a) => a.id);
  if (enabledIds.length > 0) {
    const { rows } = await query(
      `SELECT automation_id, slot_key FROM queued_posts
        WHERE automation_id = ANY($1::bigint[]) AND slot_key >= $2`,
      [enabledIds, new Date(since.getTime() - 86400000).toISOString().slice(0, 10)]
    );
    for (const r of rows) taken.add(`${r.automation_id}|${r.slot_key}`);
  }

  const posts = postRes.rows.map((p) => {
    const automation = p.automation_id ? byId.get(String(p.automation_id)) : null;
    return {
      kind: 'post',
      ...p,
      at: p.at ? new Date(p.at).toISOString() : null,
      automation_name: automation?.name || null,
      automation_paused: automation ? !automation.enabled : false,
      // Still ours to change: a held post, a draft, a failure. A post an
      // aggregator holds can only be cancelled; one being sent cannot be
      // touched at all.
      editable: p.status === 'draft' || p.status === 'failed'
        || (p.status === 'scheduled' && p.delivery === 'postly' && !p.published_post_id),
    };
  });

  const planned = [];
  for (const a of automations) {
    if (!a.enabled) continue;
    const platforms = (Array.isArray(a.platforms) ? a.platforms : []).filter(Boolean);
    if (platforms.length === 0) continue;
    for (const slot of slotsBetween(a, now, until)) {
      const missing = platforms.filter((pf) => !taken.has(`${a.id}|${slot.key}|${pf}`));
      if (missing.length === 0) continue;
      // A slot on a platform that is not connected, or cannot take the
      // format, is never written. Saying so beats a slot that sits at
      // "writing soon" forever.
      const blocked = missing
        .filter((pf) => !connected.has(pf) || !platformSupportsFormat(pf, a.format))
        .map((pf) => ({
          platform: pf,
          reason: connected.has(pf) ? `does not take ${a.format} posts` : 'is not connected',
        }));
      planned.push({
        kind: 'planned',
        blocked,
        automation_id: a.id,
        automation_name: a.name,
        approval: a.approval,
        format: a.format,
        at: slot.at.toISOString(),
        slot: slot.key,
        platforms: missing,
        // When the scheduler gets to it. A time already past means it is due
        // on the next tick.
        writes_at: new Date(slot.at.getTime() - PLAN_AHEAD_MS).toISOString(),
      });
    }
  }

  const items = [...posts, ...planned].sort((x, y) => {
    const tx = x.at ? new Date(x.at).getTime() : 0;
    const ty = y.at ? new Date(y.at).getTime() : 0;
    return tx - ty || String(x.platform || '').localeCompare(String(y.platform || ''));
  });

  return {
    now: now.toISOString(),
    days,
    planAheadHours: Math.round(PLAN_AHEAD_MS / 360000) / 10,
    automations: automations.map((a) => ({
      id: a.id, name: a.name, enabled: a.enabled, approval: a.approval,
      format: a.format, platforms: a.platforms, times: a.times,
      timezone: a.timezone, tz_label: timezoneLabel(a.timezone),
    })),
    items,
    products: productRes.rows,
    needsYou: needsRes.rows[0]?.n || 0,
    scheduler: {
      lastTickAt: status.lastTickAt,
      healthy: status.healthy,
      neverRan: status.neverRan,
      missedAt: status.missedAt,
    },
  };
}
