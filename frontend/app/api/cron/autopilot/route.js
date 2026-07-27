import { NextResponse } from 'next/server';
import { query } from '../../../../lib/db';
import { generateContent, publishContent, logPost } from '../../../../lib/pipeline';

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

// Daily autopilot (Vercel Cron). For every user with automation enabled:
// generate fresh posts from their brand profile and schedule them at their
// chosen times — the aggregators handle the timed delivery.
export async function GET(request) {
  // Vercel Cron sends Authorization: Bearer ${CRON_SECRET}.
  const auth = request.headers.get('authorization') || '';
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { rows: brands } = await query(
    `SELECT * FROM brand_profiles WHERE auto_enabled = true LIMIT 20`
  );

  const results = [];
  let generations = 0;
  const MAX_GENERATIONS = 8; // keep well within the function time budget

  for (const brand of brands) {
    const platforms = Array.isArray(brand.auto_platforms) ? brand.auto_platforms : [];
    const times = (Array.isArray(brand.auto_times) ? brand.auto_times : ['10:00'])
      .slice(0, Math.max(1, Math.min(brand.auto_posts_per_day || 1, 5)));
    if (platforms.length === 0) continue;

    // Angle + post-type rotation so daily posts don't repeat themselves and
    // the feed mixes selling with genuinely useful/relatable content.
    const angles = [
      'a specific benefit for the buyer',
      'a common problem the product solves',
      'a gift idea framing',
      'a quick tip involving the product',
      'why now is a great moment to try it',
    ];
    const postTypes = ['promo', 'tips', 'engage'];

    for (const [i, time] of times.entries()) {
      if (generations >= MAX_GENERATIONS) break;

      // Schedule for today at HH:MM UTC, or tomorrow if already past.
      const [hh, mm] = time.split(':').map(Number);
      const at = new Date();
      at.setUTCHours(hh, mm, 0, 0);
      if (at.getTime() < Date.now() + 5 * 60000) at.setUTCDate(at.getUTCDate() + 1);
      const scheduledAt = at.toISOString();

      for (const platform of platforms) {
        if (generations >= MAX_GENERATIONS) break;
        generations++;

        const { rows: connRows } = await query(
          `SELECT * FROM social_connections
            WHERE user_id = $1 AND platform = $2 AND status = 'connected'
            ORDER BY updated_at DESC LIMIT 1`,
          [brand.user_id, platform]
        );
        const conn = connRows[0];
        if (!conn) {
          results.push({ user: brand.user_id, platform, ok: false, error: 'not connected' });
          continue;
        }

        try {
          const input = {
            theme: `${brand.products || brand.store_name || 'our products'} — ${angles[(i + at.getUTCDate()) % angles.length]}`,
            postType: postTypes[(i + at.getUTCDate()) % postTypes.length],
            productName: brand.store_name || '',
            description: brand.benefits || '',
            tone: brand.default_tone || 'friendly and engaging',
            destinationUrl: brand.store_url || '',
          };
          const c = await generateContent({ platform, input, brand });
          const content = { ...c, destinationUrl: input.destinationUrl };
          const pub = await publishContent({ conn, platform, content, scheduledAt });

          await query(
            `INSERT INTO queued_posts
               (user_id, platform, status, theme, tone, caption, hashtags, cta,
                pin_title, pin_description, image_url, destination_url,
                scheduled_at, published_post_id)
             VALUES ($1,$2,'scheduled',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
            [
              brand.user_id, platform, input.theme, input.tone, c.caption, c.hashtags,
              c.cta, c.pinTitle, c.pinDescription, c.imageUrl,
              input.destinationUrl || null, scheduledAt, pub.post_id,
            ]
          );
          await logPost({
            run_id: null, user_id: brand.user_id, platform, status: 'scheduled',
            post_id: pub.post_id, error_message: null, theme: input.theme,
            product_name: null, tone: input.tone, caption: c.caption,
            hashtags: c.hashtags, cta: c.cta, image_url: c.imageUrl,
            destination_url: input.destinationUrl || null,
            raw_request: { autopilot: true, scheduled_at: scheduledAt },
            raw_response: pub.raw,
          });
          results.push({ user: brand.user_id, platform, ok: true, at: scheduledAt });
        } catch (e) {
          results.push({ user: brand.user_id, platform, ok: false, error: e.message });
        }
      }
    }
  }

  return NextResponse.json({ ran: true, results });
}
