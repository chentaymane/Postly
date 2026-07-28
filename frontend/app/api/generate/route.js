import { NextResponse } from 'next/server';
import { query } from '../../../lib/db';
import { generateContent } from '../../../lib/pipeline';
import { PLATFORMS } from '../../../lib/platforms';
import { currentUserId } from '../../../lib/auth';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Generates drafts (copy + image) for each selected platform and stores them
// in the review queue. Nothing is published here.
export async function POST(request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'not authenticated' }, { status: 401 });

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const theme = String(body.theme || '').trim();
  const platforms = Array.isArray(body.platforms) ? body.platforms.filter((p) => PLATFORMS[p]) : [];
  if (!theme) return NextResponse.json({ error: 'theme is required' }, { status: 400 });
  if (platforms.length === 0) {
    return NextResponse.json({ error: 'select at least one platform' }, { status: 400 });
  }

  // Brand context makes the copy sell THIS store, not a generic product.
  const { rows: brandRows } = await query('SELECT * FROM brand_profiles WHERE user_id = $1', [userId]);
  const brand = brandRows[0] || null;

  const postType = ['promo', 'tips', 'engage'].includes(body.postType) ? body.postType : 'promo';
  const format = ['carousel', 'video'].includes(body.format) ? body.format : 'single';
  const input = {
    theme,
    postType,
    format,
    productName: String(body.productName || '').trim(),
    description: String(body.description || '').trim(),
    tone: String(body.tone || brand?.default_tone || 'friendly and engaging').trim(),
    destinationUrl: String(body.destinationUrl || brand?.store_url || '').trim(),
  };

  const drafts = await Promise.all(
    platforms.map(async (platform) => {
      try {
        const c = await generateContent({ platform, input, brand });
        // A video draft is only publishable once the render worker returns the
        // MP4, so it starts life waiting for that. If the model gave us no
        // usable script, generateContent fell back to a single image — store it
        // as one, rather than as a video that can never render.
        const isVideo = format === 'video' && Array.isArray(c.scenes) && c.scenes.length > 0;
        const storedFormat = isVideo ? 'video' : format === 'video' ? 'single' : format;
        const { rows } = await query(
          `INSERT INTO queued_posts
             (user_id, platform, status, theme, tone, caption, hashtags, cta,
              pin_title, pin_description, image_url, image_urls, destination_url,
              format, script, video_status)
           VALUES ($1,$2,'draft',$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14::jsonb,$15)
           RETURNING *`,
          [
            userId, platform, input.theme, input.tone, c.caption, c.hashtags, c.cta,
            isVideo ? c.videoTitle || c.pinTitle : c.pinTitle,
            c.pinDescription, c.imageUrl,
            JSON.stringify(c.imageUrls || [c.imageUrl]),
            input.destinationUrl || null,
            storedFormat,
            isVideo ? JSON.stringify(c.scenes) : null,
            isVideo ? 'pending' : null,
          ]
        );
        return { ok: true, draft: rows[0] };
      } catch (e) {
        return { ok: false, platform, error: e.message };
      }
    })
  );

  return NextResponse.json({ drafts });
}
