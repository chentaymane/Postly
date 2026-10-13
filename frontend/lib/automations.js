// Automation execution. Shared by the scheduler tick and the "Run now" button
// so a manual test behaves exactly like a scheduled run.
//
// The unit of work is a *slot*: one automation, one local date, one wall-clock
// time, one platform. Every slot has a stable key, and the database refuses a
// second post for a key it has already seen — which is what makes a retried
// tick, an overlapping "Run now" and a duplicated cron delivery all safe.

import { query } from './db.js';
import { generateContent } from './pipeline.js';
import { withUserKeys } from './keycontext.js';
import { platformSupportsFormat, formatMismatchReason } from './platforms.js';
import { dueSlots, nextRunAt as slotNextRunAt, safeTimezone, normaliseTimes, slotFor } from './schedule.js';
import { requestRender } from './renderdispatch.js';
import { pickProduct, markProductUsed } from './products.js';
import { pickRecipe } from './recipes.js';

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

// Re-exported so callers keep importing scheduling from one place.
export { dueSlots, safeTimezone, normaliseTimes };
export const nextRunAt = slotNextRunAt;

// Generating copy and artwork takes tens of seconds, so a run stops before the
// serverless function is killed rather than being cut off mid-insert.
const SLOT_BUDGET_MS = 55000;

function slotKey(slot, platform) {
  return `${slot.key}|${platform}`;
}

// The connected account for one platform, or null.
async function connectionFor(userId, platform) {
  const { rows } = await query(
    `SELECT * FROM social_connections
      WHERE user_id = $1 AND platform = $2 AND status = 'connected'
      ORDER BY updated_at DESC LIMIT 1`,
    [userId, platform]
  );
  return rows[0] || null;
}

// Builds the generation input for one slot. Exported for regenerating a single
// post, which must be written to the same brief as the rest of its automation.
export function inputFor(automation, brand, { index, rotation, product }) {
  const postType =
    automation.post_type === 'mixed'
      ? TYPE_ROTATION[(index + rotation) % TYPE_ROTATION.length]
      : automation.post_type;

  // With a product in hand the angle is all the theme needs to supply; the
  // product's own name and details arrive separately and would only be
  // duplicated here.
  const angle = ANGLES[(index + rotation) % ANGLES.length];
  const theme = automation.theme?.trim()
    || (product ? angle
      : `${brand?.products || brand?.store_name || 'our products'} — ${angle}`);

  // Brand rules apply to every post; the automation's are added on top rather
  // than replacing them. Overriding silently would make a brand-wide rule
  // ("never mention discounts") look ignored on one stream and honoured on
  // another, with nothing in the UI to explain the difference.
  const customPrompt = [brand?.custom_prompt, automation.custom_prompt]
    .map((t) => String(t || '').trim())
    .filter(Boolean)
    .join('\n\n');

  return {
    theme,
    postType,
    format: automation.format,
    productName: brand?.store_name || '',
    description: brand?.benefits || '',
    tone: automation.tone || brand?.default_tone || 'friendly and engaging',
    // The link lands on the item the post is about, not the shop's front
    // door. A reader who wants the thing in the picture should not have to
    // go and find it.
    destinationUrl: product?.url || brand?.store_url || '',
    customPrompt,
  };
}

// Removes upcoming posts an automation no longer wants.
//
// Posts are written a day ahead, so a schedule change leaves posts behind that
// were written for the old one — a time that was removed, a platform that was
// dropped, a timezone that moved every slot. Left alone they would still go
// out at the old times. They have never left this database, so removing them
// is safe; the scheduler then writes the new schedule's slots on its next tick.
//
// With `rewrite` set, every upcoming post that is not already out goes, so new
// content settings apply from the very next slot rather than a day later.
// Skips the user made are kept either way: "not this one" still stands.
export async function dropUpcomingPosts(automation, { rewrite = false } = {}) {
  const { rows } = await query(
    `SELECT id, slot_key, platform, scheduled_at FROM queued_posts
      WHERE automation_id = $1 AND published_post_id IS NULL
        AND status IN ('draft','scheduled','failed')
        AND scheduled_at > now()
        AND slot_key IS NOT NULL AND slot_key NOT LIKE 'manual-%'`,
    [automation.id]
  );
  const platforms = new Set((automation.platforms || []).filter(Boolean));
  const doomed = rows.filter((r) => {
    if (rewrite) return true;
    const [key, platform] = String(r.slot_key).split('|');
    const slot = slotFor(automation, key);
    return !slot
      || !platforms.has(platform || r.platform)
      || Math.abs(slot.at.getTime() - new Date(r.scheduled_at).getTime()) > 60000;
  });
  if (doomed.length === 0) return 0;
  const { rowCount } = await query(
    `DELETE FROM queued_posts
      WHERE id = ANY($1::bigint[]) AND published_post_id IS NULL
        AND status IN ('draft','scheduled','failed')`,
    [doomed.map((r) => r.id)]
  );
  return rowCount || 0;
}

// Claims a slot by inserting its (empty) row first.
//
// The claim happens *before* generation, not after: generating takes the better
// part of a minute, and two overlapping ticks would otherwise both generate and
// only collide at the end — paying twice for the copy and artwork of a post one
// of them must then throw away. Returns null when another run owns the slot.
async function claimSlot(automation, platform, slot) {
  const { rows } = await query(
    `INSERT INTO queued_posts
       (user_id, automation_id, platform, status, format, slot_key, scheduled_at, theme)
     VALUES ($1,$2,$3,'generating',$4,$5,$6,$7)
     ON CONFLICT (automation_id, slot_key) WHERE automation_id IS NOT NULL AND slot_key IS NOT NULL
     DO NOTHING
     RETURNING *`,
    [
      automation.user_id, automation.id, platform, automation.format,
      slotKey(slot, platform), slot.at.toISOString(),
      automation.theme?.trim() || null,
    ]
  );
  return rows[0] || null;
}

// A claim that could not be filled must not leave a husk behind: the row is
// removed so the slot can be attempted again on the next tick.
async function releaseSlot(postId) {
  await query(`DELETE FROM queued_posts WHERE id = $1 AND status = 'generating'`, [postId]);
}

// Generates one post for one slot and puts it wherever it belongs: a draft for
// review, a post held here until its minute, or published immediately when
// its slot has already passed.
async function runSlot(automation, { platform, slot, brand, index, rotation, product, recipe = null }) {
  // A platform that cannot take this format is checked before anything is
  // generated. TikTok takes video only, so an image automation with TikTok
  // selected used to write and pay for a post the platform then rejected —
  // the run went "partial", Instagram published, TikTok silently did not, and
  // the reason was buried in one long detail string.
  if (!platformSupportsFormat(platform, automation.format)) {
    // Not a failure of the run — a standing mismatch in the configuration. It
    // was counted as one, so an automation posting happily to two platforms
    // reported "failed" every time because a third could not take the format,
    // and a real fault became impossible to spot among the noise.
    return {
      platform, slot: slot.key, ok: false, misconfigured: true,
      error: formatMismatchReason(platform, automation.format),
    };
  }

  const conn = await connectionFor(automation.user_id, platform);
  if (!conn) {
    return { platform, slot: slot.key, ok: false, error: `${platform} is not connected` };
  }

  const claimed = await claimSlot(automation, platform, slot);
  if (!claimed) {
    return { platform, slot: slot.key, ok: true, status: 'already made', skipped: true };
  }

  const input = { ...inputFor(automation, brand, { index, rotation, product }), recipe };

  let content;
  try {
    content = await withUserKeys(automation.user_id, () =>
      generateContent({ platform, input, brand, product })
    );
  } catch (e) {
    await releaseSlot(claimed.id);
    return { platform, slot: slot.key, ok: false, error: e.message };
  }

  // Mirror the manual path: a "video" whose script came back unusable was
  // rendered as a single image, so store it as one rather than as a video the
  // worker can never render.
  const isVideo =
    automation.format === 'video' && Array.isArray(content.scenes) && content.scenes.length > 0;
  const storedFormat = isVideo
    ? 'video'
    : automation.format === 'video'
      ? 'single'
      : automation.format;

  // That downgrade is a fallback, not a licence: on a video-only platform a
  // single image is not publishable, so the slot is released for another run
  // rather than filled with something that can only fail at publish time.
  if (!platformSupportsFormat(platform, storedFormat)) {
    await releaseSlot(claimed.id);
    return {
      platform, slot: slot.key, ok: false,
      error: `the video script came back empty — ${formatMismatchReason(platform, storedFormat)}`,
    };
  }

  // Videos wait for the render worker; "review" automations wait for the user.
  const mustWait = isVideo || automation.approval === 'review';

  const { rows: filled } = await query(
    `UPDATE queued_posts SET
        status = 'draft', format = $2, theme = $3, tone = $4, caption = $5,
        hashtags = $6, cta = $7, pin_title = $8, pin_description = $9,
        image_url = $10, image_urls = $11::jsonb, script = $12::jsonb,
        video_status = $13, destination_url = $14, delivery = $15,
        product_id = $16, recipe = $17,
        error_message = NULL, updated_at = now()
      WHERE id = $1
      RETURNING *`,
    [
      claimed.id, storedFormat, input.theme, input.tone, content.caption,
      content.hashtags, content.cta,
      isVideo ? content.videoTitle || content.pinTitle : content.pinTitle,
      content.pinDescription, content.imageUrl,
      JSON.stringify(content.imageUrls || [content.imageUrl].filter(Boolean)),
      isVideo ? JSON.stringify(content.scenes) : null,
      isVideo ? 'pending' : null,
      input.destinationUrl || null,
      mustWait ? null : 'postly',
      product?.id || null,
      content.recipe || null,
    ]
  );
  const post = filled[0];

  if (mustWait) {
    // Start rendering straight away rather than on the renderer's own timer:
    // a video for a caught-up slot has no time to spare, and one for tomorrow
    // is ready all the sooner for being looked at.
    if (isVideo) await requestRender();
    return {
      platform, slot: slot.key, ok: true,
      status: isVideo && automation.approval === 'auto' ? 'rendering' : 'draft',
    };
  }

  const { publishQueuedPost, holdForDelivery } = await import('./publishqueued.js');

  // A future slot is held here, whatever the connection: the post waits with
  // its time and stays editable, and the tick that runs at that minute sends
  // it. Handing it to an aggregator with a time would make it uneditable a day
  // before it goes out.
  if (!slot.late) {
    const at = slot.at.toISOString();
    await holdForDelivery(post.id, at);
    return { platform, slot: slot.key, ok: true, status: 'scheduled', at };
  }

  // A slot that has already passed (a missed tick being caught up) goes out
  // now: the delay is already spent.
  const published = await publishQueuedPost(post, { scheduledAt: null });
  return {
    platform, slot: slot.key,
    ok: published.ok,
    status: published.status,
    ...(published.ok ? {} : { error: published.error }),
  };
}

// Runs an automation for a given set of slots.
//
// `slots` comes from the scheduler (what is actually due) or from "Run now"
// (a single synthetic slot). Passing them in rather than deriving them here is
// what lets one code path serve both without the manual run inventing times
// that the schedule would never have produced.
export async function runAutomation(automation, {
  slots,
  trigger = 'cron',
  maxPosts = 12,
  deadline = Date.now() + SLOT_BUDGET_MS,
} = {}) {
  const platforms = (Array.isArray(automation.platforms) ? automation.platforms : []).filter(Boolean);

  const { rows: runRows } = await query(
    `INSERT INTO automation_runs (automation_id, user_id, trigger, status, slots)
     VALUES ($1,$2,$3,'running',$4) RETURNING id`,
    [automation.id, automation.user_id, trigger, slots.length]
  );
  const runId = runRows[0].id;

  const finish = async (status, detail, counts) => {
    await query(
      `UPDATE automation_runs
          SET status = $2, detail = $3, generated = $4, published = $5, failed = $6,
              finished_at = now()
        WHERE id = $1`,
      [runId, status, String(detail || '').slice(0, 600), counts.generated, counts.published, counts.failed]
    );
    await query(
      `UPDATE automations
          SET last_run_at = now(), last_run_status = $2, last_run_detail = $3,
              last_error = $4, run_count = run_count + 1, updated_at = now()
        WHERE id = $1`,
      [automation.id, status, String(detail || '').slice(0, 500), status === 'failed' ? String(detail || '').slice(0, 300) : null]
    );
  };

  if (platforms.length === 0) {
    const detail = 'no platforms selected';
    await finish('failed', detail, { generated: 0, published: 0, failed: 0 });
    return { runStatus: 'failed', detail, results: [{ ok: false, error: detail }] };
  }
  if (slots.length === 0) {
    await finish('skipped', 'nothing due', { generated: 0, published: 0, failed: 0 });
    return { runStatus: 'skipped', detail: 'nothing due', results: [] };
  }

  const { rows: brandRows } = await query('SELECT * FROM brand_profiles WHERE user_id = $1', [
    automation.user_id,
  ]);
  const brand = brandRows[0] || null;

  // Rotate by run as well as by date. Keying on the date alone meant two runs
  // on the same day produced byte-identical posts, which the platforms reject
  // as duplicates.
  const rotation = new Date().getUTCDate() + (automation.run_count || 0);

  const results = [];
  let made = 0;
  let ranOutOfTime = false;
  // The instant up to which this run is definitively done. Only slots whose
  // every platform was attempted count: advancing the watermark past a slot the
  // run never reached would drop it silently, which is exactly the class of bug
  // this rewrite exists to remove.
  let processedThrough = null;

  for (const [i, slot] of slots.entries()) {
    let complete = true;

    // One product per slot, shared by every platform in it: the same book on
    // Instagram and Pinterest at 09:00 is one campaign, whereas a different
    // book per platform would read as two unrelated posts.
    const product = await pickProduct(automation.user_id, {
      pinnedId: automation.product_id,
    });

    // One creative angle per slot too, for the same reason: Instagram and
    // Pinterest at 09:00 should tell the same story about the same book. The
    // seed moves with the slot and the run, so the angle changes from post to
    // post instead of every slot opening the same way.
    const recipe = product
      ? pickRecipe(product, { postType: automation.post_type, seed: i + rotation + (automation.run_count || 0), brand }).key
      : null;

    // Start each slot on a different platform.
    //
    // The list was walked in the order it was stored, so when a tick ran out of
    // time — which it did on every run — the same platform was served first
    // every time and the ones after it were never reached. Instagram published
    // daily while Pinterest, second in the array, went weeks without a post
    // that the run log still cheerfully recorded as "ok".
    const order = platforms.map(
      (_, n) => platforms[(n + i + rotation) % platforms.length]
    );

    let madeInSlot = 0;
    for (const platform of order) {
      // Stop cleanly rather than being killed halfway through an insert.
      if (made >= maxPosts || Date.now() > deadline) {
        ranOutOfTime = true;
        complete = false;
        break;
      }
      let result;
      try {
        result = await runSlot(automation, {
          platform, slot, brand, index: i, rotation, product, recipe,
        });
      } catch (e) {
        result = { platform, slot: slot.key, ok: false, error: e.message };
      }
      results.push(result);
      // A slot that was already written costs nothing, so it does not count
      // against the run's allowance. Posts are written a day ahead, and a
      // run that re-reads that day (after a settings change, say) would
      // otherwise spend its whole allowance on slots that are done.
      if (!result.skipped) made++;
      if (result.ok && !result.skipped && !result.misconfigured) madeInSlot++;
    }
    if (!complete) break;
    // Counted once per slot so the catalogue advances by one book a slot,
    // not by one per platform — and only when the slot was actually written
    // now, or re-reading a finished day would march the rotation on by a
    // book per slot without a single post being made about any of them.
    if (!automation.product_id && madeInSlot > 0) await markProductUsed(product?.id);
    processedThrough = slot.at;
  }

  const counts = {
    generated: results.filter((r) => r.ok && !r.skipped).length,
    published: results.filter((r) => r.ok && (r.status === 'published' || r.status === 'scheduled')).length,
    failed: results.filter((r) => !r.ok && !r.misconfigured).length,
  };

  // A slot already made, and a platform that can never take this format, are
  // both excluded from the verdict: neither says anything about whether this
  // run worked.
  const attempted = results.filter((r) => !r.skipped && !r.misconfigured);
  const okCount = attempted.filter((r) => r.ok).length;
  const misconfigured = results.filter((r) => r.misconfigured).length;
  const runStatus =
    attempted.length === 0
      ? (misconfigured ? 'misconfigured' : 'skipped')
      : okCount === 0 ? 'failed'
        : okCount === attempted.length ? 'ok' : 'partial';

  const detail = [
    ...results.map((r) => `${r.platform} ${r.slot?.slice(11) || ''} ${r.ok ? r.status || 'ok' : r.error}`.trim()),
    ranOutOfTime ? 'stopped early — out of time this tick, the rest resume next tick' : '',
  ].filter(Boolean).join(' · ').slice(0, 600);

  await finish(runStatus, detail, counts);
  return { runStatus, detail, results, ranOutOfTime, counts, processedThrough };
}
