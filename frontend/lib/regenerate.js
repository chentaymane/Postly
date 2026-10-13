// Re-writing one post that already exists, from the Schedule page.
//
// Posts are written a day ahead so they can be corrected before they go out.
// Editing the words covers most of that; this covers the rest — a caption that
// missed, a picture that came out wrong, or a different book for that slot.

import { query } from './db.js';
import { generateContent, buildPrompts, generateCopy } from './pipeline.js';
import { withUserKeys } from './keycontext.js';
import { inputFor } from './automations.js';
import { canDesign } from './designer.js';
import { pickRecipe } from './recipes.js';

// A post can be re-written while it is still ours to change: a draft, a
// failure, or a post held here for its minute. Once an aggregator holds it, or
// a tick has claimed it for sending, it is out of our hands.
export const REWRITABLE_SQL = `(status IN ('draft','failed')
   OR (status = 'scheduled' AND delivery = 'postly' AND published_post_id IS NULL))`;

async function loadContext(post, productId) {
  const [autoRes, brandRes] = await Promise.all([
    post.automation_id
      ? query('SELECT * FROM automations WHERE id = $1', [post.automation_id])
      : Promise.resolve({ rows: [] }),
    query('SELECT * FROM brand_profiles WHERE user_id = $1', [post.user_id]),
  ]);

  const id = productId === undefined ? post.product_id : productId;
  let product = null;
  if (id) {
    const { rows } = await query('SELECT * FROM products WHERE id = $1 AND user_id = $2', [
      id, post.user_id,
    ]);
    product = rows[0] || null;
  }
  return { automation: autoRes.rows[0] || null, brand: brandRes.rows[0] || null, product };
}

// The brief the post was written to, rebuilt. An automation post is written to
// its automation's brief with a fresh angle — a re-roll that came back with the
// same angle would read the same. A post made by hand has no automation, so it
// keeps its own topic and tone.
function briefFor(post, { automation, brand, product }) {
  const index = Math.floor(Math.random() * 1000);
  if (automation) {
    const input = inputFor(automation, brand, { index, rotation: 0, product });
    // The stored format wins: a video whose script came back unusable was kept
    // as a single image, and re-rolling it must not turn it back into a video
    // with nothing to render it.
    return { ...input, format: post.format || input.format };
  }
  return {
    theme: post.theme || brand?.products || brand?.store_name || 'our products',
    postType: 'promo',
    format: post.format || 'single',
    productName: brand?.store_name || '',
    description: brand?.benefits || '',
    tone: post.tone || brand?.default_tone || 'friendly and engaging',
    destinationUrl: product?.url || post.destination_url || brand?.store_url || '',
    customPrompt: String(brand?.custom_prompt || '').trim(),
  };
}

// mode 'text' re-writes the words and keeps the picture; 'all' re-makes both.
// A new product always re-makes both, because a caption about one book under a
// picture of another is worse than either.
//
// Videos only ever get new words: new pictures would need a new render, and the
// renderer runs every few hours — re-rolling a video close to its slot would
// make it miss the slot entirely.
export async function regeneratePost(post, { mode = 'text', productId } = {}) {
  const context = await loadContext(post, productId);
  const productChanged = productId !== undefined && Number(productId || 0) !== Number(post.product_id || 0);
  const isVideo = post.format === 'video';

  // A post designed from the product's own pictures carries its words on the
  // images, so new words always mean new slides — and drawing them is quick.
  // "New angle" moves it to a different creative recipe; "rewrite" keeps it.
  const designed = !isVideo && canDesign(context.product);
  const remakeImages = designed || (!isVideo && (mode === 'all' || productChanged));

  const input = briefFor(post, context);
  if (designed) {
    input.recipe = mode === 'all' || productChanged || !post.recipe
      ? pickRecipe(context.product, {
          postType: context.automation?.post_type || 'mixed',
          seed: Math.floor(Math.random() * 1000),
          brand: context.brand,
          avoid: post.recipe,
        }).key
      : post.recipe;
  }
  const forPinterest = post.platform === 'pinterest';

  const content = await withUserKeys(post.user_id, async () => {
    if (remakeImages) {
      return generateContent({
        platform: post.platform, input, brand: context.brand, product: context.product,
      });
    }
    const prompts = buildPrompts({
      ...input, forPinterest, platform: post.platform,
      brand: context.brand, product: context.product,
    });
    return generateCopy(prompts, prompts.subject);
  });

  const imageUrls = remakeImages
    ? (content.imageUrls || [content.imageUrl]).filter(Boolean)
    : null;

  const { rows } = await query(
    `UPDATE queued_posts SET
        caption = $2, hashtags = $3, cta = $4,
        pin_title = $5, pin_description = $6,
        image_url = COALESCE($7, image_url),
        image_urls = COALESCE($8::jsonb, image_urls),
        destination_url = COALESCE($9, destination_url),
        product_id = $10, theme = $11, recipe = COALESCE($12, recipe),
        error_message = CASE WHEN status = 'failed' THEN error_message ELSE NULL END,
        updated_at = now()
      WHERE id = $1 AND ${REWRITABLE_SQL}
      RETURNING *`,
    [
      post.id,
      content.caption, content.hashtags, content.cta,
      isVideo ? content.videoTitle || content.pinTitle : content.pinTitle,
      content.pinDescription,
      remakeImages ? content.imageUrl : null,
      imageUrls ? JSON.stringify(imageUrls) : null,
      input.destinationUrl || null,
      context.product?.id || null,
      input.theme,
      content.recipe || null,
    ]
  );
  if (rows.length === 0) {
    const e = new Error('it is being published right now, so it can no longer be changed');
    e.status = 409;
    throw e;
  }
  return { post: rows[0], remadeImages: remakeImages };
}
