// Postly content pipeline: prompt building -> copy generation -> image
// generation -> platform publishing -> logging.
//
// This replaces the former n8n workflow so the whole app can run serverless
// (Vercel) with no Docker. Legacy workflow JSON is kept in ../../n8n/workflows
// for reference.

// Extension is explicit so plain `node` scripts can import this module too.
import { query } from './db.js';
import { uploadMediaFromUrl, createPost, toSocialApiPlatform } from './socialapi.js';
import { createPinPost } from './zernio.js';

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

// Conversion-focused prompt builder. `brand` (optional) is the user's stored
// store profile — injecting it is what turns generic captions into copy that
// sells THEIR product to THEIR audience.
export function buildPrompts({ theme, productName, description, tone, forPinterest, platform, brand }) {
  const subject = productName ? `${productName} — ${theme}` : theme;

  const pinterestKeys = forPinterest
    ? ' Also include: "pin_title" (string, max 90 chars: a keyword-rich, search-optimised title buyers would type into Pinterest search), "pin_description" (string, max 480 chars: natural keyword-rich description ending with a reason to click through).'
    : '';

  const systemPrompt =
    'You are a direct-response social media copywriter who sells products for small online stores. ' +
    'Your copy converts followers into buyers. Rules you always follow:\n' +
    '1. HOOK FIRST — the opening line must stop the scroll: a sharp question, a surprising fact, or the buyer\'s pain/desire in their own words. Never start with the product name.\n' +
    '2. SELL THE OUTCOME, not the item — what the buyer\'s life looks like after purchase (calm kids, proud gift-giver, cozy evening). Be specific and sensory, never generic.\n' +
    '3. ONE clear benefit per post. Do not list features.\n' +
    '4. CTA drives the purchase with gentle urgency and points at the link (e.g. "Grab yours — link in bio", "Download it today"). No fake scarcity.\n' +
    '5. Hashtags: 6-10, mix of buyer-intent (what a purchaser searches) and niche community tags. No giant generic tags like #love.\n' +
    '6. Sound like a real person recommending to a friend — zero corporate phrases ("elevate", "unleash", "discover the magic").\n' +
    'Respond ONLY with a valid JSON object with exactly these keys: "caption" (string: hook line, blank line, then 1-3 short lines of body copy), ' +
    '"hashtags" (array of 6-10 strings, no # symbol), "cta" (string, one short line).' +
    pinterestKeys +
    ' No markdown, no code fences, no extra keys.';

  const brandLines = brand
    ? [
        brand.store_name ? `Store: ${brand.store_name}.` : '',
        brand.products ? `We sell: ${brand.products}.` : '',
        brand.audience ? `Target buyer: ${brand.audience}.` : '',
        brand.benefits ? `Why customers buy: ${brand.benefits}.` : '',
        brand.store_url ? `Store link (mention "link" in CTA, do not paste the URL): ${brand.store_url}.` : '',
      ].filter(Boolean).join(' ')
    : '';

  const userPrompt =
    (brandLines ? brandLines + '\n' : '') +
    `Post subject: ${subject}.` +
    (description ? ` Details: ${description}.` : '') +
    ` Tone: ${tone}.` +
    ` Platform: ${platform || 'social media'}.` +
    ' Write a post that makes the target buyer want to purchase now' +
    (forPinterest ? ', plus the Pinterest search-optimised title and description.' : '.');

  // Image: sell the feeling of using the product. A human element converts
  // far better than a sterile product shot, and "no text" avoids the garbled
  // letters image models produce.
  const productForImage = brand?.products || subject;
  const imagePrompt =
    `${subject}, ${productForImage} being enjoyed in real life, happy person using the product, ` +
    `authentic lifestyle marketing photography, warm inviting ${tone} atmosphere, natural light, ` +
    'shallow depth of field, rich colors, aspirational but believable scene, ' +
    'absolutely no text, no words, no letters, no watermark';

  return { subject, systemPrompt, userPrompt, imagePrompt };
}

// ---------------------------------------------------------------------------
// Copy generation: Groq primary, OpenRouter fallback
// ---------------------------------------------------------------------------

async function callGroq({ systemPrompt, userPrompt }) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('GROQ_API_KEY is not set');
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
      temperature: 0.8,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
    signal: AbortSignal.timeout(30000),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || `Groq HTTP ${res.status}`);
  return json.choices?.[0]?.message?.content || '';
}

async function callOpenRouter({ systemPrompt, userPrompt }) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OPENROUTER_API_KEY is not set');
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free',
      temperature: 0.8,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
    signal: AbortSignal.timeout(40000),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || `OpenRouter HTTP ${res.status}`);
  return json.choices?.[0]?.message?.content || '';
}

function parseCopy(raw, fallbackSubject) {
  let text = String(raw || '').trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();

  let parsed = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    // Model ignored the JSON instruction — salvage the prose as the caption.
    parsed = { caption: text };
  }

  let tags = parsed.hashtags;
  if (!Array.isArray(tags)) tags = String(tags || '').split(/[\s,]+/).filter(Boolean);
  const hashtags = tags
    .map((h) => '#' + String(h).replace(/^#/, '').replace(/\s+/g, ''))
    .filter((h) => h.length > 1)
    .join(' ');

  const caption = String(parsed.caption || '').trim();
  const cta = String(parsed.cta || '').trim();

  return {
    caption,
    hashtags,
    cta,
    pinTitle: String(parsed.pin_title || fallbackSubject || '').trim().slice(0, 100),
    pinDescription: String(parsed.pin_description || caption).trim().slice(0, 800),
    fullMessage: [caption, cta, hashtags].filter(Boolean).join('\n\n'),
  };
}

export async function generateCopy(prompts, subject) {
  const errors = [];
  for (const [name, fn] of [['groq', callGroq], ['openrouter', callOpenRouter]]) {
    try {
      const raw = await fn(prompts);
      const copy = parseCopy(raw, subject);
      if (!copy.caption) throw new Error('empty caption returned');
      return { ...copy, provider: name };
    } catch (e) {
      errors.push(`${name}: ${e.message}`);
    }
  }
  throw new Error(`copy generation failed (${errors.join(' | ')})`);
}

// ---------------------------------------------------------------------------
// Image generation (Pollinations). Platforms fetch the image by URL, so we
// "warm" it first: Pollinations renders on first request and caches after,
// which keeps the platform's own fetch fast enough to succeed.
// ---------------------------------------------------------------------------

export function buildImageUrl(imagePrompt, { width = 1024, height = 1024, model = 'flux', seed } = {}) {
  const s = seed ?? Math.floor(Math.random() * 1000000);
  const params = new URLSearchParams({
    width: String(width),
    height: String(height),
    nologo: 'true',
    model,
    seed: String(s),
  });
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(imagePrompt)}?${params}`;
}

export async function warmImage(url, timeoutMs = 45000) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const buf = await res.arrayBuffer();
    return { ok: true, bytes: buf.byteLength };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Generates an image URL, warming it. Falls back to the faster 'turbo' model
// (still a URL, which platforms require) if flux is slow or failing.
export async function generateImage(imagePrompt, dims) {
  const attempts = [
    { model: 'flux' },
    { model: 'turbo' },
  ];
  let lastError = null;
  for (const a of attempts) {
    const url = buildImageUrl(imagePrompt, { ...dims, ...a });
    const warm = await warmImage(url);
    if (warm.ok) return { imageUrl: url, model: a.model, bytes: warm.bytes };
    lastError = warm.error;
  }
  // Warming failed on all models; still return a URL so the platform can try.
  return {
    imageUrl: buildImageUrl(imagePrompt, dims),
    model: 'flux',
    bytes: null,
    warmError: lastError,
  };
}

// ---------------------------------------------------------------------------
// Publishers — one per platform. Each returns { post_id, raw }.
// ---------------------------------------------------------------------------

export const publishers = {
  async pinterest(conn, content) {
    const boardId = conn.extra?.board_id;
    if (!boardId) throw new Error('no Pinterest board selected for this account');

    const body = {
      board_id: boardId,
      title: content.pinTitle,
      description: content.pinDescription,
      media_source: { source_type: 'image_url', url: content.imageUrl },
    };
    if (content.destinationUrl) body.link = content.destinationUrl;

    const res = await fetch('https://api.pinterest.com/v5/pins', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${conn.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(json.message || json.error_description || `Pinterest HTTP ${res.status}`);
    }
    return { post_id: json.id || null, raw: json };
  },

  // Instagram is a two-step publish: create a media container from a public
  // image URL, then publish the container once processing completes.
  async instagram(conn, content) {
    const igUserId = conn.extra?.ig_user_id || conn.account_id;
    if (!igUserId) throw new Error('no Instagram Business account on this connection');

    // Instagram Login tokens work against graph.instagram.com; connections made
    // through a Facebook Page use a Page token on graph.facebook.com.
    const graph =
      conn.extra?.api === 'instagram_login'
        ? 'https://graph.instagram.com/v21.0'
        : 'https://graph.facebook.com/v21.0';
    const caption = [content.caption, content.cta, content.hashtags]
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 2200); // Instagram caption limit

    // 1. create the container
    const createRes = await fetch(`${graph}/${igUserId}/media`, {
      method: 'POST',
      body: new URLSearchParams({
        image_url: content.imageUrl,
        caption,
        access_token: conn.access_token,
      }),
      signal: AbortSignal.timeout(60000),
    });
    const created = await createRes.json().catch(() => ({}));
    if (!createRes.ok || !created.id) {
      throw new Error(created?.error?.message || `Instagram container HTTP ${createRes.status}`);
    }

    // 2. publish, retrying briefly while the container finishes processing
    let lastError = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      const pubRes = await fetch(`${graph}/${igUserId}/media_publish`, {
        method: 'POST',
        body: new URLSearchParams({
          creation_id: created.id,
          access_token: conn.access_token,
        }),
        signal: AbortSignal.timeout(60000),
      });
      const published = await pubRes.json().catch(() => ({}));
      if (pubRes.ok && published.id) {
        return { post_id: published.id, raw: { container: created.id, ...published } };
      }
      lastError = published?.error?.message || `Instagram publish HTTP ${pubRes.status}`;
      // Only a not-ready container is worth retrying.
      if (!/not ready|still processing|media.*process/i.test(lastError)) break;
      await new Promise((r) => setTimeout(r, 3000));
    }
    throw new Error(lastError || 'Instagram publish failed');
  },

  async facebook(conn, content) {
    const pageId = conn.extra?.page_id || conn.account_id;
    if (!pageId) throw new Error('no Facebook Page selected for this account');

    const params = new URLSearchParams({
      url: content.imageUrl,
      caption: content.fullMessage,
      access_token: conn.access_token,
    });
    const res = await fetch(`https://graph.facebook.com/v21.0/${pageId}/photos`, {
      method: 'POST',
      body: params,
      signal: AbortSignal.timeout(60000),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error?.message || `Facebook HTTP ${res.status}`);
    return { post_id: json.post_id || json.id || null, raw: json };
  },
};

// Publishes through the SocialAPI.ai aggregator: upload the generated image,
// then create the post against the connected account. Works for any platform
// the aggregator supports, including ones we have no direct integration for.
async function publishViaAggregator(conn, content, platform, scheduledAt) {
  const accountId = conn.extra?.socialapi_account_id || conn.account_id;
  if (!accountId) throw new Error('aggregator connection is missing its account id');

  const mediaId = await uploadMediaFromUrl(content.imageUrl);

  let text = content.fullMessage;
  let platformData;
  if (platform === 'pinterest') {
    text = content.pinDescription;
    platformData = {
      [toSocialApiPlatform(platform)]: {
        ...(conn.extra?.board_id ? { board_id: conn.extra.board_id } : {}),
        title: content.pinTitle,
        ...(content.destinationUrl ? { link: content.destinationUrl } : {}),
      },
    };
  }

  const post = await createPost({ accountId, text, mediaIds: [mediaId], platformData, scheduledAt });
  const target = Array.isArray(post.targets) ? post.targets[0] : null;
  if (post.status === 'failed' || target?.status === 'failed') {
    throw new Error(target?.error || post.error || 'aggregator publish failed');
  }
  // Accepted with status "publishing"; delivery completes in the background.
  return { post_id: post.id || null, raw: post };
}

// Publishes through Zernio (Pinterest). Media is attached by URL directly.
async function publishViaZernio(conn, content, platform, scheduledAt) {
  if (platform !== 'pinterest') {
    throw new Error(`Zernio publishing is only wired for Pinterest, got ${platform}`);
  }
  const accountId = conn.extra?.zernio_account_id || conn.account_id;
  if (!accountId) throw new Error('Zernio connection is missing its account id');
  return createPinPost({
    accountId,
    boardId: conn.extra?.board_id || undefined,
    title: content.pinTitle,
    description: content.pinDescription,
    link: content.destinationUrl || undefined,
    imageUrl: content.imageUrl,
    scheduledFor: scheduledAt || undefined,
  });
}

// ---------------------------------------------------------------------------
// Draft-based flow (review queue + scheduling).
// ---------------------------------------------------------------------------

// Generates copy + image for one platform WITHOUT publishing.
export async function generateContent({ platform, input, brand }) {
  const forPinterest = platform === 'pinterest';
  const prompts = buildPrompts({ ...input, forPinterest, platform, brand });
  const copy = await generateCopy(prompts, prompts.subject);
  const img = await generateImage(prompts.imagePrompt, IMAGE_DIMS[platform]);
  return { ...copy, imageUrl: img.imageUrl, subject: prompts.subject };
}

// Publishes previously generated content now, or schedules it (ISO datetime,
// aggregator connections only — the aggregator does the timed delivery).
export async function publishContent({ conn, platform, content, scheduledAt }) {
  const provider = conn.provider || 'direct';
  if (provider === 'socialapi') {
    return publishViaAggregator(conn, content, platform, scheduledAt || undefined);
  }
  if (provider === 'zernio') {
    return publishViaZernio(conn, content, platform, scheduledAt || undefined);
  }
  if (scheduledAt) {
    throw new Error('scheduling is only supported for one-click (aggregator) connections');
  }
  const publish = publishers[platform];
  if (!publish) throw new Error(`publishing to ${platform} is not implemented yet`);
  return publish(conn, content);
}

// Per-platform image dimensions (Pinterest strongly prefers tall 2:3).
export const IMAGE_DIMS = {
  pinterest: { width: 1000, height: 1500 },
  facebook: { width: 1200, height: 1200 },
  instagram: { width: 1080, height: 1080 },
  x: { width: 1200, height: 675 },
  linkedin: { width: 1200, height: 627 },
};

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

export async function logPost(row) {
  try {
    const { rows } = await query(
      `INSERT INTO post_logs
         (user_id, run_id, platform, status, post_id, error_message, theme, product_name, tone,
          caption, hashtags, cta, image_url, destination_url, raw_request, raw_response)
       VALUES ($16,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb)
       RETURNING id`,
      [
        row.run_id, row.platform, row.status, row.post_id, row.error_message,
        row.theme, row.product_name, row.tone, row.caption, row.hashtags, row.cta,
        row.image_url, row.destination_url,
        JSON.stringify(row.raw_request || {}), JSON.stringify(row.raw_response || {}),
        row.user_id,
      ]
    );
    return rows[0]?.id || null;
  } catch (e) {
    // Never let a logging failure mask a successful publish.
    console.error('logPost failed:', e.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Orchestration: run the full pipeline for one platform.
// ---------------------------------------------------------------------------

export async function runForPlatform({ runId, userId, platform, conn, input }) {
  const forPinterest = platform === 'pinterest';
  const prompts = buildPrompts({ ...input, forPinterest });

  const base = {
    run_id: runId,
    user_id: userId,
    platform,
    theme: input.theme,
    product_name: input.productName || null,
    tone: input.tone || null,
    destination_url: input.destinationUrl || null,
    raw_request: {
      theme: input.theme,
      productName: input.productName,
      description: input.description,
      tone: input.tone,
      destinationUrl: input.destinationUrl,
    },
  };

  let copy;
  try {
    copy = await generateCopy(prompts, prompts.subject);
  } catch (e) {
    await logPost({ ...base, status: 'fail', post_id: null, error_message: e.message,
      caption: null, hashtags: null, cta: null, image_url: null, raw_response: {} });
    return { platform, ok: false, error: e.message, stage: 'copy' };
  }

  const img = await generateImage(prompts.imagePrompt, IMAGE_DIMS[platform]);

  const content = { ...copy, imageUrl: img.imageUrl, destinationUrl: input.destinationUrl || '' };
  const logCopy = {
    caption: forPinterest ? copy.pinDescription : copy.caption,
    hashtags: copy.hashtags,
    cta: copy.cta,
    image_url: img.imageUrl,
  };

  const provider = conn.provider || 'direct';
  const publish = publishers[platform];
  if (provider === 'direct' && !publish) {
    const msg = `publishing to ${platform} is not implemented yet`;
    await logPost({ ...base, ...logCopy, status: 'fail', post_id: null, error_message: msg, raw_response: {} });
    return { platform, ok: false, error: msg, stage: 'publish', preview: previewOf(content, copy) };
  }

  try {
    const result =
      provider === 'socialapi'
        ? await publishViaAggregator(conn, content, platform)
        : provider === 'zernio'
          ? await publishViaZernio(conn, content, platform)
          : await publish(conn, content);
    await logPost({ ...base, ...logCopy, status: 'success', post_id: result.post_id,
      error_message: null, raw_response: result.raw });
    return { platform, ok: true, post_id: result.post_id, preview: previewOf(content, copy) };
  } catch (e) {
    await logPost({ ...base, ...logCopy, status: 'fail', post_id: null,
      error_message: e.message, raw_response: { error: e.message } });
    return { platform, ok: false, error: e.message, stage: 'publish', preview: previewOf(content, copy) };
  }
}

function previewOf(content, copy) {
  return {
    caption: copy.caption,
    hashtags: copy.hashtags,
    cta: copy.cta,
    pinTitle: copy.pinTitle,
    imageUrl: content.imageUrl,
    provider: copy.provider,
  };
}
