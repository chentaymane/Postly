// Automation execution. Shared by the daily cron and the "Run now" button so
// a manual test behaves exactly like the scheduled run.

import { query } from './db.js';
import { generateContent, publishContent, logPost } from './pipeline.js';

export const POST_TYPES = ['promo', 'tips', 'engage', 'mixed'];
export const FORMATS = ['single', 'carousel', 'video'];
export const APPROVALS = ['review', 'auto'];

// Rotating angles keep a daily automation from writing the same post forever.
const ANGLES = [
  'a specific benefit for the buyer',
  'a common problem the product solves',
  'a gift idea framing',
  'a quick tip involving the product',
  'why now is a great moment to try it',
];
const TYPE_ROTATION = ['promo', 'tips', 'engage'];

function nextOccurrence(hhmm) {
  const [hh, mm] = String(hhmm || '10:00').split(':').map(Number);
  const at = new Date();
  at.setUTCHours(hh || 0, mm || 0, 0, 0);
  // Anything within the next 5 minutes belongs to tomorrow's slot.
  if (at.getTime() < Date.now() + 5 * 60000) at.setUTCDate(at.getUTCDate() + 1);
  return at;
}

// The soonest upcoming slot for an automation, or null when it has no times.
export function nextRunAt(automation) {
  const times = Array.isArray(automation.times) ? automation.times : [];
  if (times.length === 0) return null;
  return times
    .map((t) => nextOccurrence(t))
    .sort((a, b) => a - b)[0]
    .toISOString();
}

// Runs one automation: one post per time slot per platform.
// `limit` caps generations so a serverless request cannot run out of time.
export async function runAutomation(automation, { limit = 6 } = {}) {
  const results = [];
  const platforms = (Array.isArray(automation.platforms) ? automation.platforms : []).filter(Boolean);
  const times = (Array.isArray(automation.times) ? automation.times : ['10:00']).slice(0, 5);

  if (platforms.length === 0) {
    return { results: [{ ok: false, error: 'no platforms selected' }] };
  }

  const { rows: brandRows } = await query('SELECT * FROM brand_profiles WHERE user_id = $1', [
    automation.user_id,
  ]);
  const brand = brandRows[0] || null;

  let made = 0;
  const dayOffset = new Date().getUTCDate();

  for (const [i, time] of times.entries()) {
    if (made >= limit) break;
    const at = nextOccurrence(time);
    const scheduledAt = at.toISOString();

    for (const platform of platforms) {
      if (made >= limit) break;
      made++;

      const { rows: connRows } = await query(
        `SELECT * FROM social_connections
          WHERE user_id = $1 AND platform = $2 AND status = 'connected'
          ORDER BY updated_at DESC LIMIT 1`,
        [automation.user_id, platform]
      );
      const conn = connRows[0];
      if (!conn) {
        results.push({ platform, ok: false, error: 'account not connected' });
        continue;
      }

      // 'mixed' rotates promo/tips/engage so the feed stays varied.
      const postType =
        automation.post_type === 'mixed'
          ? TYPE_ROTATION[(i + dayOffset) % TYPE_ROTATION.length]
          : automation.post_type;

      const theme =
        automation.theme?.trim() ||
        `${brand?.products || brand?.store_name || 'our products'} — ${ANGLES[(i + dayOffset) % ANGLES.length]}`;

      const input = {
        theme,
        postType,
        format: automation.format,
        productName: brand?.store_name || '',
        description: brand?.benefits || '',
        tone: automation.tone || brand?.default_tone || 'friendly and engaging',
        destinationUrl: brand?.store_url || '',
      };

      try {
        const c = await generateContent({ platform, input, brand });

        // Video drafts must wait for the render worker, and anything on a
        // "review" automation waits for the user — neither can publish here.
        const mustWait = automation.format === 'video' || automation.approval === 'review';

        let publishedId = null;
        let status = 'draft';
        if (!mustWait) {
          const pub = await publishContent({
            conn,
            platform,
            content: { ...c, destinationUrl: input.destinationUrl },
            scheduledAt,
          });
          publishedId = pub.post_id;
          status = 'scheduled';
          await logPost({
            run_id: null, user_id: automation.user_id, platform, status: 'scheduled',
            post_id: pub.post_id, error_message: null, theme: input.theme,
            product_name: null, tone: input.tone, caption: c.caption,
            hashtags: c.hashtags, cta: c.cta, image_url: c.imageUrl,
            destination_url: input.destinationUrl || null,
            raw_request: { automation_id: automation.id, scheduled_at: scheduledAt },
            raw_response: pub.raw,
          });
        }

        await query(
          `INSERT INTO queued_posts
             (user_id, automation_id, platform, status, format, theme, tone, caption,
              hashtags, cta, pin_title, pin_description, image_url, image_urls,
              script, video_status, destination_url, scheduled_at, published_post_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16,$17,$18,$19)`,
          [
            automation.user_id, automation.id, platform, status, automation.format,
            input.theme, input.tone, c.caption, c.hashtags, c.cta,
            c.pinTitle, c.pinDescription, c.imageUrl,
            c.imageUrls ? JSON.stringify(c.imageUrls) : null,
            c.script ? JSON.stringify(c.script) : null,
            automation.format === 'video' ? 'pending' : null,
            input.destinationUrl || null,
            mustWait ? null : scheduledAt,
            publishedId,
          ]
        );

        results.push({ platform, ok: true, status, at: mustWait ? null : scheduledAt });
      } catch (e) {
        results.push({ platform, ok: false, error: e.message });
      }
    }
  }

  const okCount = results.filter((r) => r.ok).length;
  const runStatus = okCount === 0 ? 'failed' : okCount === results.length ? 'ok' : 'partial';
  const detail = results
    .map((r) => `${r.platform}: ${r.ok ? r.status || 'ok' : r.error}`)
    .join(' · ')
    .slice(0, 500);

  await query(
    `UPDATE automations
        SET last_run_at = now(), last_run_status = $2, last_run_detail = $3,
            run_count = run_count + 1, updated_at = now()
      WHERE id = $1`,
    [automation.id, runStatus, detail]
  );

  return { results, runStatus, detail };
}
