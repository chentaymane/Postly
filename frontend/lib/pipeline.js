// Postly content pipeline: prompt building -> copy generation -> artwork
// generation -> platform publishing -> logging.
//
// Everything here runs inside a serverless request, with one exception: video
// posts stop after the script and scene artwork, because Piper and FFmpeg
// cannot run on a Vercel function. The worker/ service picks those up.

// Extension is explicit so plain `node` scripts can import this module too.
import { query } from './db.js';
import { keyFor } from './keycontext.js';
import {
  uploadMediaFromUrl, createPost, toSocialApiPlatform,
  listRecentPosts as listRecentSocialApiPosts,
} from './socialapi.js';
import { createZernioPost, listRecentPosts as listRecentZernioPosts } from './zernio.js';

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

// Conversion-focused prompt builder. `brand` (optional) is the user's stored
// store profile — injecting it is what turns generic captions into copy that
// sells THEIR product to THEIR audience.
// postType: 'promo' (sell the product) | 'tips' (advice/value post that builds
// trust) | 'engage' (fun, relatable, conversation-starting).
export function buildPrompts({ theme, productName, description, tone, forPinterest, platform, brand, postType = 'promo', format = 'single' }) {
  const subject = productName ? `${productName} — ${theme}` : theme;

  const pinterestKeys = forPinterest
    ? ' Also include: "pin_title" (string, max 90 chars: a keyword-rich, search-optimised title buyers would type into Pinterest search), "pin_description" (string, max 480 chars: natural keyword-rich description ending with a reason to click through).'
    : '';

  const typeRules = {
    promo:
      '1. HOOK FIRST — the opening line must stop the scroll: a sharp question, a surprising fact, or the buyer\'s pain/desire in their own words. Never start with the product name.\n' +
      '2. SELL THE OUTCOME, not the item — what the buyer\'s life looks like after purchase (calm kids, proud gift-giver, cozy evening). Be specific and sensory, never generic.\n' +
      '3. ONE clear benefit per post. Do not list features.\n' +
      '4. CTA drives the purchase with gentle urgency and points at the link (e.g. "Grab yours — link in bio", "Download it today"). No fake scarcity.\n',
    tips:
      '1. This is a VALUE post, not an ad: give genuinely useful, specific advice the audience can use today (e.g. parenting tips, activity ideas, how-tos related to the niche).\n' +
      '2. HOOK FIRST — open with the problem or a surprising fact, then give 3-4 short, concrete, numbered tips. Each tip on its own line, specific enough to act on.\n' +
      '3. Mention the product at most once, softly, as one of the tips or in the CTA — the value must stand on its own.\n' +
      '4. CTA is soft: save this post, follow for more, or check the link for a helpful resource.\n',
    engage:
      '1. This is an ENGAGEMENT post: relatable, warm, lightly funny — a moment the audience recognises from their own life.\n' +
      '2. HOOK FIRST — a "tell me you\'re a [audience] without telling me" energy, a mini-story, or a this-or-that question.\n' +
      '3. End with a question that invites comments.\n' +
      '4. CTA invites interaction (comment/share/tag someone), not purchase.\n',
  };

  const systemPrompt =
    'You are a social media content strategist and copywriter for small online stores. Rules you always follow:\n' +
    (typeRules[postType] || typeRules.promo) +
    '5. Hashtags: 6-10, mix of intent-based and niche community tags. No giant generic tags like #love.\n' +
    '6. Sound like a real person talking to a friend — zero corporate phrases ("elevate", "unleash", "discover the magic").\n' +
    (format === 'video'
      ? '7. SCRIPT: write "scenes" — an array of exactly 5 or 6 objects, each { "narration": string, "image_prompt": string }, telling ONE continuous story in order. ' +
        '"narration" is the spoken voiceover for that scene: ONE sentence of 12-20 words, plain spoken English, no emojis, no hashtags, no stage directions, no "scene 1" labels — it is read aloud word for word. ' +
        'The first narration is the hook (a question or a surprising fact), the middle ones build the story or give the tips, the last one is the spoken call to action. ' +
        '"image_prompt" is a one-sentence photo scene illustrating what is being said, framed VERTICALLY (portrait). ' +
        'CRITICAL FOR CONSISTENCY: invent ONE main character and repeat the exact same physical description word-for-word in every image_prompt (e.g. "a 5-year-old girl with curly brown hair in a yellow sweater"), and keep the same setting. Never mention brands, logos, or any text appearing in the images.\n' +
        'Respond ONLY with a valid JSON object with exactly these keys: "caption" (string: hook line, blank line, then the body per the rules above), ' +
        '"hashtags" (array of 6-10 strings, no # symbol), "cta" (string, one short line), ' +
        '"title" (string, max 80 chars: a punchy title for the video), "scenes" (array of 5-6 objects).'
      : format === 'carousel'
      ? '7. IMAGES: write "image_prompts" — an array of exactly 3 or 4 one-sentence photo scene descriptions that tell ONE continuous story in order. ' +
        'For a promo post: first slide shows the relatable problem (e.g. a bored child slumped on the sofa staring at a phone), middle slide(s) show the turning point with the product (the same child colouring, absorbed and calm), last slide shows the proud payoff (the same child grinning and holding up a finished colourful page). ' +
        'For a tips post: one scene illustrating each tip, in the same order as the tips. ' +
        'CRITICAL FOR CONSISTENCY: invent ONE main character and repeat the exact same physical description word-for-word in every scene (e.g. "a 5-year-old girl with curly brown hair in a yellow sweater"), and keep the same home setting. Never mention brands, logos, or any text appearing in the images.\n' +
        'Respond ONLY with a valid JSON object with exactly these keys: "caption" (string: hook line, blank line, then the body per the rules above), ' +
        '"hashtags" (array of 6-10 strings, no # symbol), "cta" (string, one short line), "image_prompts" (array of 3-4 strings).'
      : '7. IMAGE: also write "image_prompt" — one vivid sentence describing a photograph that would stop the scroll for this exact post. Describe a REAL-LIFE SCENE with a person and emotion (e.g. "a smiling 5-year-old girl colouring a lion picture with crayons at a sunny kitchen table, cosy morning light"). Concrete subject + action + setting + light. Never mention brands, logos, text, or words appearing in the image.\n' +
        'Respond ONLY with a valid JSON object with exactly these keys: "caption" (string: hook line, blank line, then the body per the rules above), ' +
        '"hashtags" (array of 6-10 strings, no # symbol), "cta" (string, one short line), "image_prompt" (string, one sentence).') +
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

  const goal =
    format === 'video'
      ? {
          promo: 'Write a short vertical video that makes the target buyer want to purchase now',
          tips: 'Write a short vertical video giving genuinely helpful tips to this audience',
          engage: 'Write a short, relatable vertical video this audience will comment on',
        }[postType] || 'Write a short vertical video for this audience'
      : {
          promo: 'Write a post that makes the target buyer want to purchase now',
          tips: 'Write a genuinely helpful tips/advice post for this audience',
          engage: 'Write a relatable engagement post this audience will comment on',
        }[postType] || 'Write a post for this audience';

  const userPrompt =
    (brandLines ? brandLines + '\n' : '') +
    `Post subject: ${subject}.` +
    (description ? ` Details: ${description}.` : '') +
    ` Tone: ${tone}.` +
    ` Platform: ${platform || 'social media'}.` +
    ` ${goal}` +
    (forPinterest ? ', plus the Pinterest search-optimised title and description.' : '.');

  // Fallback scene if the model omits image_prompt — the real scene normally
  // comes from the model itself (see finishImagePrompt).
  const productForImage = brand?.products || subject;
  const imagePrompt = `happy person enjoying ${productForImage} in a cosy real-life moment, ${subject}`;

  return { subject, systemPrompt, userPrompt, imagePrompt };
}

// Wraps the model-written scene with a consistent photographic treatment.
// The style suffix is fixed so the feed looks coherent; the scene varies.
export function finishImagePrompt(scene, tone = 'warm') {
  return (
    `${scene}, authentic candid lifestyle photography, ${tone} mood, natural light, ` +
    'shallow depth of field, rich warm colors, shot on 50mm lens, aspirational but believable, ' +
    'absolutely no text, no words, no letters, no logos, no watermark'
  );
}

// ---------------------------------------------------------------------------
// Copy generation: Groq primary, OpenRouter fallback
// ---------------------------------------------------------------------------

async function callGroq({ systemPrompt, userPrompt }) {
  const key = await keyFor('groq');
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
  const key = await keyFor('openrouter');
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
    imageScene: String(parsed.image_prompt || '').trim().slice(0, 500) || null,
    imageScenes: Array.isArray(parsed.image_prompts)
      ? parsed.image_prompts.map((s) => String(s).trim().slice(0, 500)).filter(Boolean).slice(0, 4)
      : null,
    videoTitle: String(parsed.title || '').trim().slice(0, 100) || null,
    // Video script: one narration line + one scene per shot. Narration is read
    // aloud verbatim, so anything the voice cannot say is stripped here.
    scenes: Array.isArray(parsed.scenes)
      ? parsed.scenes
          .map((s) => ({
            narration: speakable(s?.narration).slice(0, 300),
            imagePrompt: String(s?.image_prompt || '').trim().slice(0, 500),
          }))
          .filter((s) => s.narration && s.imagePrompt)
          .slice(0, 6)
      : null,
    fullMessage: [caption, cta, hashtags].filter(Boolean).join('\n\n'),
  };
}

// Voiceover text: no hashtags, emoji, markdown or "Scene 3:" labels — the TTS
// engine would read every one of them out loud.
function speakable(text) {
  return String(text || '')
    .replace(/^\s*(scene|shot)\s*\d+\s*[:.\-–]\s*/i, '')
    .replace(/#[\p{L}\p{N}_]+/gu, '')
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}]/gu, '')
    .replace(/[*_`~<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
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

// Pixel dimensions straight out of the encoded bytes — the generator does not
// always honour the requested size exactly, and a carousel whose slides differ
// in size is rejected by Pinterest and cropped badly by Instagram, so every
// slide is measured rather than assumed.
export function readImageSize(buf) {
  const b = new Uint8Array(buf);
  const u16 = (i) => (b[i] << 8) | b[i + 1];
  const u32 = (i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;

  // PNG: IHDR is always the first chunk.
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50) {
    return { width: u32(16), height: u32(20) };
  }
  // JPEG: walk the segments to the start-of-frame marker.
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      // SOF0..SOF15, skipping the non-frame markers in that range.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: u16(i + 5), width: u16(i + 7) };
      }
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) { i += 2; continue; }
      i += 2 + u16(i + 2);
    }
  }
  // WebP: sizes sit at fixed offsets, in the chunk's own little-endian layout.
  if (b.length > 30 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    const fourcc = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (fourcc === 'VP8X') {
      return {
        width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)),
        height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)),
      };
    }
    if (fourcc === 'VP8 ') {
      return { width: (b[26] | (b[27] << 8)) & 0x3fff, height: (b[28] | (b[29] << 8)) & 0x3fff };
    }
  }
  return null;
}

export async function warmImage(url, timeoutMs = 45000) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const buf = await res.arrayBuffer();
    const size = readImageSize(buf);
    return { ok: true, bytes: buf.byteLength, width: size?.width || null, height: size?.height || null };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Generates an image URL, warming it. Falls back to the faster 'turbo' model
// (still a URL, which platforms require) if flux is slow or failing.
// `models` pins the attempt order — carousels pass a single model so every
// slide is rendered by the same one.
export async function generateImage(imagePrompt, dims, { models = ['flux', 'turbo'], seed } = {}) {
  let lastError = null;
  for (const model of models) {
    const url = buildImageUrl(imagePrompt, { ...dims, model, seed });
    const warm = await warmImage(url);
    if (warm.ok) {
      return { imageUrl: url, model, bytes: warm.bytes, width: warm.width, height: warm.height };
    }
    lastError = warm.error;
  }
  // Warming failed on every model; still return a URL so the platform can try.
  return {
    imageUrl: buildImageUrl(imagePrompt, { ...dims, model: models[0], seed }),
    model: models[0],
    bytes: null,
    width: null,
    height: null,
    warmError: lastError,
  };
}

// Generates one image per scene for a carousel or video, guaranteeing every
// slide comes back at the *same* pixel size.
//
// Two things break that guarantee if left alone: a per-slide model fallback
// (models round sizes differently) and the generator quietly resizing. So all
// slides share one model and one base seed — which also keeps the art style
// coherent across the story — and any slide that comes back a different size
// is re-rendered once with a fresh seed. Slides that still disagree are
// dropped rather than published as a mismatched set — except for video, where
// each frame is scaled to the canvas anyway and dropping one would leave a
// narration line with nothing on screen (`dropMismatched: false`).
export async function generateSlides(scenes, { tone, dims, model = 'flux', dropMismatched = true }) {
  const seedBase = Math.floor(Math.random() * 1000000);
  const render = (scene, i, attempt) =>
    generateImage(finishImagePrompt(scene, tone), dims, {
      models: [model],
      seed: seedBase + i * 101 + attempt * 7919,
    });

  let slides = await Promise.all(scenes.map((scene, i) => render(scene, i, 0)));

  const matches = (s) => !s.width || !s.height || (s.width === dims.width && s.height === dims.height);
  const retryIndexes = slides.map((s, i) => (matches(s) ? -1 : i)).filter((i) => i >= 0);
  if (retryIndexes.length) {
    const retries = await Promise.all(retryIndexes.map((i) => render(scenes[i], i, 1)));
    retryIndexes.forEach((i, n) => { slides[i] = retries[n]; });
  }

  if (!dropMismatched) return { slides, dropped: 0 };

  // A single slide has nothing to match against, so it is always publishable.
  const usable = slides.filter(matches);
  const kept = usable.length >= 2 ? usable : [usable[0] || slides[0]];
  return { slides: kept, dropped: slides.length - kept.length };
}

// ---------------------------------------------------------------------------
// Publishers — one per platform. Each returns { post_id, raw }.
// ---------------------------------------------------------------------------

// Each platform call has to finish inside the route's own 60s budget with room
// left over to verify afterwards — a request killed by the platform timeout is
// recoverable, one killed by the serverless timeout is not.
export const PUBLISH_TIMEOUT_MS = 40000;

// Every slide URL of a post, first one first, de-duplicated.
// Pre-fetches media so whoever downloads it next gets a cached copy. Failures
// are ignored: this is an optimisation, not a gate on publishing.
async function warmAll(urls) {
  if (!urls?.length) return;
  await Promise.all(
    urls.map((u) =>
      fetch(u, { signal: AbortSignal.timeout(45000) }).then(
        (r) => r.arrayBuffer().catch(() => null),
        () => null
      )
    )
  ).catch(() => {});
}

export function slideUrls(content) {
  const urls = content.imageUrls?.length ? content.imageUrls : [content.imageUrl];
  return Array.from(new Set(urls.filter(Boolean)));
}

// Pinterest media, chosen from what the post actually has. A carousel pin
// takes 2-5 images that must all share one aspect ratio — generateSlides is
// what guarantees that, so anything beyond 5 slides is simply trimmed here.
function pinterestMedia(content) {
  const urls = slideUrls(content);
  if (urls.length < 2) return { source_type: 'image_url', url: urls[0] };
  return {
    source_type: 'multiple_image_urls',
    items: urls.slice(0, 5).map((url) => ({
      url,
      title: content.pinTitle || undefined,
      description: content.pinDescription || undefined,
      ...(content.destinationUrl ? { link: content.destinationUrl } : {}),
    })),
    index: 0,
  };
}

export const publishers = {
  async pinterest(conn, content) {
    const boardId = conn.extra?.board_id;
    if (!boardId) throw new Error('no Pinterest board selected for this account');

    const body = {
      board_id: boardId,
      title: content.pinTitle,
      description: content.pinDescription,
      media_source: content.videoUrl
        ? await uploadPinterestVideo(conn, content)
        : pinterestMedia(content),
    };
    if (content.destinationUrl) body.link = content.destinationUrl;

    const res = await fetch('https://api.pinterest.com/v5/pins', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${conn.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      // Kept under the route's own time budget so a slow Pinterest fetch of the
      // image surfaces as a timeout we can verify, not as a killed function.
      signal: AbortSignal.timeout(PUBLISH_TIMEOUT_MS),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(json.message || json.error_description || `Pinterest HTTP ${res.status}`);
    }
    return { post_id: json.id || null, raw: json };
  },

  // Instagram is a two-step publish: create a media container, then publish it
  // once processing completes. Three shapes: a single image, a carousel of
  // per-slide child containers, or a Reel from the rendered MP4.
  async instagram(conn, content) {
    const igUserId = conn.extra?.ig_user_id || conn.account_id;
    if (!igUserId) throw new Error('no Instagram Business account on this connection');

    // Instagram Login tokens work against graph.instagram.com; connections made
    // through a Facebook Page use a Page token on graph.facebook.com.
    const graph =
      conn.extra?.api === 'instagram_login'
        ? 'https://graph.instagram.com/v21.0'
        : 'https://graph.facebook.com/v21.0';
    const token = conn.access_token;
    const caption = [content.caption, content.cta, content.hashtags]
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 2200); // Instagram caption limit

    const container = async (fields) => {
      const res = await fetch(`${graph}/${igUserId}/media`, {
        method: 'POST',
        body: new URLSearchParams({ ...fields, access_token: token }),
        signal: AbortSignal.timeout(PUBLISH_TIMEOUT_MS),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.id) {
        throw new Error(json?.error?.message || `Instagram container HTTP ${res.status}`);
      }
      return json.id;
    };

    // 1. build the container to publish
    let creationId;
    if (content.videoUrl) {
      creationId = await container({
        media_type: 'REELS',
        video_url: content.videoUrl,
        caption,
        ...(content.coverUrl ? { cover_url: content.coverUrl } : {}),
        share_to_feed: 'true',
      });
      // Reels are transcoded server-side; publishing before that finishes
      // fails, so wait for the container to report FINISHED.
      await waitForIgContainer(graph, creationId, token);
    } else {
      const urls = slideUrls(content);
      if (urls.length > 1) {
        const children = [];
        for (const url of urls.slice(0, 10)) {  // IG carousels take up to 10
          children.push(await container({ image_url: url, is_carousel_item: 'true' }));
        }
        creationId = await container({
          media_type: 'CAROUSEL',
          children: children.join(','),
          caption,
        });
      } else {
        creationId = await container({ image_url: urls[0], caption });
      }
    }

    // 2. publish, retrying briefly while the container finishes processing
    let lastError = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      const pubRes = await fetch(`${graph}/${igUserId}/media_publish`, {
        method: 'POST',
        body: new URLSearchParams({ creation_id: creationId, access_token: token }),
        signal: AbortSignal.timeout(PUBLISH_TIMEOUT_MS),
      });
      const published = await pubRes.json().catch(() => ({}));
      if (pubRes.ok && published.id) {
        return { post_id: published.id, raw: { container: creationId, ...published } };
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
    const token = conn.access_token;

    // Video posts go to /videos with the MP4 pulled from its public URL.
    if (content.videoUrl) {
      const res = await fetch(`https://graph.facebook.com/v21.0/${pageId}/videos`, {
        method: 'POST',
        body: new URLSearchParams({
          file_url: content.videoUrl,
          title: (content.videoTitle || content.pinTitle || '').slice(0, 255),
          description: content.fullMessage,
          access_token: token,
        }),
        signal: AbortSignal.timeout(PUBLISH_TIMEOUT_MS),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message || `Facebook video HTTP ${res.status}`);
      return { post_id: json.id || null, raw: json };
    }

    // Multi-image: upload each photo unpublished, then attach them all to one
    // Page post so the slides stay together instead of posting separately.
    const urls = slideUrls(content);
    if (urls.length > 1) {
      const mediaIds = [];
      for (const url of urls) {
        const upRes = await fetch(`https://graph.facebook.com/v21.0/${pageId}/photos`, {
          method: 'POST',
          body: new URLSearchParams({ url, published: 'false', access_token: token }),
          signal: AbortSignal.timeout(PUBLISH_TIMEOUT_MS),
        });
        const up = await upRes.json().catch(() => ({}));
        if (!upRes.ok || !up.id) {
          throw new Error(up?.error?.message || `Facebook photo upload HTTP ${upRes.status}`);
        }
        mediaIds.push(up.id);
      }
      const params = new URLSearchParams({ message: content.fullMessage, access_token: token });
      mediaIds.forEach((id, i) => params.set(`attached_media[${i}]`, JSON.stringify({ media_fbid: id })));
      const res = await fetch(`https://graph.facebook.com/v21.0/${pageId}/feed`, {
        method: 'POST',
        body: params,
        signal: AbortSignal.timeout(PUBLISH_TIMEOUT_MS),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message || `Facebook HTTP ${res.status}`);
      return { post_id: json.id || null, raw: json };
    }

    const params = new URLSearchParams({
      url: urls[0],
      caption: content.fullMessage,
      access_token: token,
    });
    const res = await fetch(`https://graph.facebook.com/v21.0/${pageId}/photos`, {
      method: 'POST',
      body: params,
      signal: AbortSignal.timeout(PUBLISH_TIMEOUT_MS),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error?.message || `Facebook HTTP ${res.status}`);
    return { post_id: json.post_id || json.id || null, raw: json };
  },

};

// Instagram reports Reel transcoding progress on the container itself.
async function waitForIgContainer(graph, containerId, token, budgetMs = 30000) {
  const deadline = Date.now() + budgetMs;
  let status = 'IN_PROGRESS';
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    const res = await fetch(
      `${graph}/${containerId}?fields=status_code,status&access_token=${encodeURIComponent(token)}`,
      { signal: AbortSignal.timeout(15000) }
    );
    const json = await res.json().catch(() => ({}));
    status = json.status_code || status;
    if (status === 'FINISHED') return;
    if (status === 'ERROR') throw new Error(json.status || 'Instagram could not process the video');
  }
  throw new Error('Instagram is still processing the video — try publishing again in a minute');
}

// Pinterest video pins: register the media, push the bytes to the S3 form
// Pinterest hands back, then wait for it to finish processing.
async function uploadPinterestVideo(conn, content) {
  const headers = { Authorization: `Bearer ${conn.access_token}` };

  const regRes = await fetch('https://api.pinterest.com/v5/media', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ media_type: 'video' }),
    signal: AbortSignal.timeout(20000),
  });
  const reg = await regRes.json().catch(() => ({}));
  if (!regRes.ok || !reg.media_id) {
    throw new Error(reg.message || `Pinterest media register HTTP ${regRes.status}`);
  }

  const videoRes = await fetch(content.videoUrl, { signal: AbortSignal.timeout(30000) });
  if (!videoRes.ok) throw new Error(`could not fetch the rendered video (HTTP ${videoRes.status})`);
  const bytes = await videoRes.arrayBuffer();

  // S3 presigned POST: every returned parameter first, the file last.
  const form = new FormData();
  for (const [k, v] of Object.entries(reg.upload_parameters || {})) form.append(k, String(v));
  form.append('file', new Blob([bytes], { type: 'video/mp4' }), 'postly.mp4');
  const upRes = await fetch(reg.upload_url, { method: 'POST', body: form, signal: AbortSignal.timeout(60000) });
  if (!upRes.ok) throw new Error(`Pinterest video upload HTTP ${upRes.status}`);

  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    const st = await fetch(`https://api.pinterest.com/v5/media/${reg.media_id}`, { headers })
      .then((r) => r.json())
      .catch(() => ({}));
    if (st.status === 'succeeded') {
      return {
        source_type: 'video_id',
        media_id: reg.media_id,
        cover_image_url: content.coverUrl || content.imageUrl,
      };
    }
    if (st.status === 'failed') throw new Error('Pinterest could not process the video');
  }
  throw new Error('Pinterest is still processing the video — try publishing again in a minute');
}

// Publishes through the SocialAPI.ai aggregator: upload the generated image,
// then create the post against the connected account. Works for any platform
// the aggregator supports, including ones we have no direct integration for.
async function publishViaAggregator(conn, content, platform, scheduledAt) {
  const accountId = conn.extra?.socialapi_account_id || conn.account_id;
  if (!accountId) throw new Error('aggregator connection is missing its account id');

  // Multi-image posts (story carousels) upload every slide; a video post
  // uploads the single rendered MP4.
  const urls = content.videoUrl ? [content.videoUrl] : slideUrls(content);
  const mediaIds = await Promise.all(urls.map((u) => uploadMediaFromUrl(u)));

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
  } else if (platform === 'instagram') {
    // Instagram requires an explicit content type.
    platformData = {
      instagram: {
        content_type: content.videoUrl ? 'reel' : mediaIds.length > 1 ? 'carousel' : 'feed',
      },
    };
  }

  const post = await createPost({ accountId, text, mediaIds, platformData, scheduledAt });
  const target = Array.isArray(post.targets) ? post.targets[0] : null;
  if (post.status === 'failed' || target?.status === 'failed') {
    throw new Error(target?.error || post.error || 'aggregator publish failed');
  }
  // Accepted with status "publishing"; delivery completes in the background.
  return { post_id: post.id || null, raw: post };
}

// Publishes through Zernio (Pinterest). Media is attached by URL directly.
async function publishViaZernio(conn, content, platform, scheduledAt) {
  const accountId = conn.extra?.zernio_account_id || conn.account_id;
  if (!accountId) throw new Error('Zernio connection is missing its account id');

  // TikTok takes video or photos, but never a text-only post, and it has no
  // link field — the destination lives in the caption/bio instead.
  if (platform === 'tiktok' && !content.videoUrl && slideUrls(content).length === 0) {
    throw new Error('TikTok posts need a video or at least one image');
  }

  // Pinterest is the only platform that carries a per-pin title and outbound
  // link; elsewhere the caption does the work.
  const isPinterest = platform === 'pinterest';

  // The aggregator downloads each image itself, and the image host renders on
  // first request. Warming the URLs here means it fetches from cache instead
  // of waiting on a cold render — the difference between a carousel publish
  // finishing in seconds and timing out.
  await warmAll(slideUrls(content));

  // A TikTok photo slideshow has no caption field — the content IS the title,
  // and TikTok caps that at 90 characters. Sending the full caption is a hard
  // rejection, so photo posts get the hook line alone.
  const isTikTokPhotos = platform === 'tiktok' && !content.videoUrl;
  const tiktokTitle = (content.caption || content.pinTitle || content.theme || '')
    .split('\n')[0]
    .trim()
    .slice(0, 90);

  return createZernioPost({
    platform,
    accountId,
    boardId: isPinterest ? conn.extra?.board_id || undefined : undefined,
    title: isPinterest ? content.pinTitle : content.videoTitle || content.pinTitle || undefined,
    description: isPinterest
      ? content.pinDescription
      : isTikTokPhotos
        ? tiktokTitle
        : content.fullMessage,
    link: isPinterest ? content.destinationUrl || undefined : undefined,
    imageUrls: slideUrls(content),
    videoUrl: content.videoUrl || undefined,
    coverUrl: content.coverUrl || content.imageUrl || undefined,
    scheduledFor: scheduledAt || undefined,
  });
}

// ---------------------------------------------------------------------------
// Draft-based flow (review queue + scheduling).
// ---------------------------------------------------------------------------

// Generates copy + image for one platform WITHOUT publishing. The image scene
// is written by the copy model for THIS post (a real moment with a person),
// then wrapped in a consistent photographic style.
export async function generateContent({ platform, input, brand }) {
  const forPinterest = platform === 'pinterest';
  const prompts = buildPrompts({ ...input, forPinterest, platform, brand });
  const copy = await generateCopy(prompts, prompts.subject);

  // Video: a narrated script plus one vertical frame per scene. Rendering
  // happens outside the request — the worker picks the draft up and returns an
  // MP4 — so this only prepares what the worker needs.
  if (input.format === 'video' && copy.scenes?.length >= 2) {
    const { slides } = await generateSlides(copy.scenes.map((s) => s.imagePrompt), {
      tone: input.tone,
      dims: VIDEO_DIMS,
      dropMismatched: false,
    });
    const scenes = copy.scenes.map((s, i) => ({
      narration: s.narration,
      image_prompt: s.imagePrompt,
      image_url: slides[i].imageUrl,
    }));
    const imageUrls = scenes.map((s) => s.image_url);
    return {
      ...copy,
      scenes,
      imageUrl: imageUrls[0],
      imageUrls,
      subject: prompts.subject,
    };
  }

  // Carousel: one image per story scene, all rendered at the same size so the
  // set is publishable as a real carousel everywhere (see generateSlides).
  if (input.format === 'carousel' && copy.imageScenes?.length >= 2) {
    const { slides } = await generateSlides(copy.imageScenes, {
      tone: input.tone,
      dims: imageDimsFor(platform, input.format),
    });
    const imageUrls = slides.map((s) => s.imageUrl);
    return { ...copy, imageUrl: imageUrls[0], imageUrls, subject: prompts.subject };
  }

  const scene = copy.imageScene || copy.imageScenes?.[0] || prompts.imagePrompt;
  const img = await generateImage(finishImagePrompt(scene, input.tone), imageDimsFor(platform, input.format));
  return { ...copy, imageUrl: img.imageUrl, imageUrls: [img.imageUrl], subject: prompts.subject };
}

// ---------------------------------------------------------------------------
// Publish verification
//
// A publish request can time out *after* the platform already accepted the
// post — Pinterest in particular takes its time fetching the image, and the
// pin appears on the board while we see an aborted request. Reporting that as
// "failed" is wrong and tempts the user into publishing a duplicate, so an
// ambiguous failure is checked against the account before we call it.
// ---------------------------------------------------------------------------

// Errors that leave the outcome genuinely unknown. A 4xx from the platform is
// a real, final failure; a timeout or a 5xx is not.
export function isAmbiguousError(e) {
  const m = String(e?.message || e);
  return /abort|timed? ?out|timeout|ETIMEDOUT|ECONNRESET|EPIPE|socket hang up|network|fetch failed|HTTP 5\d\d|\b50[0234]\b/i.test(m);
}

// Raised when the publish neither clearly succeeded nor clearly failed.
export class UnconfirmedPublishError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'UnconfirmedPublishError';
    this.unconfirmed = true;
    this.cause = cause;
  }
}

const RECENT_MS = 15 * 60 * 1000;
const isRecent = (t) => t && Date.now() - new Date(t).getTime() < RECENT_MS;
// Compare the first words only: platforms trim, re-wrap and strip text.
const sameText = (a, b) => {
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const x = norm(a), y = norm(b);
  return Boolean(x && y && (x.startsWith(y.slice(0, 40)) || y.startsWith(x.slice(0, 40))));
};

// Looks for the post on the account. Returns its id when found, null when it
// definitely is not there, and undefined when we could not tell.
export async function findPublishedPost({ conn, platform, content }) {
  const provider = conn.provider || 'direct';
  try {
    if (provider === 'zernio') {
      const posts = await listRecentZernioPosts(25);
      const hit = posts.find(
        (p) => isRecent(p.createdAt) && p.status !== 'failed' &&
          (sameText(p.title, content.pinTitle) || sameText(p.content, content.pinDescription))
      );
      return hit ? hit.url || hit.id : null;
    }
    if (provider === 'socialapi') {
      const posts = await listRecentSocialApiPosts(25);
      const hit = posts.find(
        (p) => isRecent(p.createdAt) && p.status !== 'failed' &&
          sameText(p.content, platform === 'pinterest' ? content.pinDescription : content.fullMessage)
      );
      return hit ? hit.id : null;
    }

    if (platform === 'pinterest') {
      const res = await fetch('https://api.pinterest.com/v5/pins?page_size=25', {
        headers: { Authorization: `Bearer ${conn.access_token}` },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return undefined;
      const json = await res.json();
      const hit = (json.items || []).find(
        (p) => isRecent(p.created_at) &&
          (sameText(p.title, content.pinTitle) || sameText(p.description, content.pinDescription))
      );
      return hit ? hit.id : null;
    }

    if (platform === 'instagram') {
      const igUserId = conn.extra?.ig_user_id || conn.account_id;
      const graph = conn.extra?.api === 'instagram_login'
        ? 'https://graph.instagram.com/v21.0'
        : 'https://graph.facebook.com/v21.0';
      const res = await fetch(
        `${graph}/${igUserId}/media?fields=id,caption,timestamp&limit=10&access_token=${encodeURIComponent(conn.access_token)}`,
        { signal: AbortSignal.timeout(15000) }
      );
      if (!res.ok) return undefined;
      const json = await res.json();
      const hit = (json.data || []).find((p) => isRecent(p.timestamp) && sameText(p.caption, content.caption));
      return hit ? hit.id : null;
    }

    if (platform === 'facebook') {
      const pageId = conn.extra?.page_id || conn.account_id;
      const res = await fetch(
        `https://graph.facebook.com/v21.0/${pageId}/feed?fields=id,message,created_time&limit=10&access_token=${encodeURIComponent(conn.access_token)}`,
        { signal: AbortSignal.timeout(15000) }
      );
      if (!res.ok) return undefined;
      const json = await res.json();
      const hit = (json.data || []).find(
        (p) => isRecent(p.created_time) && sameText(p.message, content.caption || content.fullMessage)
      );
      return hit ? hit.id : null;
    }
  } catch {
    return undefined; // the check itself failed — still unknown
  }
  return undefined;
}

// Publishes previously generated content now, or schedules it (ISO datetime,
// aggregator connections only — the aggregator does the timed delivery).
export async function publishContent({ conn, platform, content, scheduledAt }) {
  const provider = conn.provider || 'direct';

  const run = () => {
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
  };

  try {
    return await run();
  } catch (e) {
    // Nothing to verify for a scheduled post — it was never meant to be live.
    if (scheduledAt || !isAmbiguousError(e)) throw e;

    // Give the platform a moment to settle, then look for the post.
    await new Promise((r) => setTimeout(r, 2500));
    const found = await findPublishedPost({ conn, platform, content });
    if (found) {
      return { post_id: found, raw: { verified_after_timeout: true, error: e.message } };
    }
    if (found === null) throw e; // confirmed absent — a genuine failure

    throw new UnconfirmedPublishError(
      `${platform} did not answer in time (${e.message}). The post may still have gone live — ` +
        `check your ${platform} account before publishing it again.`,
      e
    );
  }
}

// Per-platform image dimensions (Pinterest strongly prefers tall 2:3).
//
// Every side is a multiple of 64: the diffusion models round odd sizes to
// their own grid, which is what made carousel slides come back at slightly
// different sizes (1000x1500 was rendered as 1000x1496 or 1000x1504) and made
// Pinterest reject the set for mismatched aspect ratios.
// Each platform's own recommended feed size. Portrait beats square on
// Instagram (4:5 occupies more of the screen) and Pinterest ranks 2:3, so the
// same post is generated at a different shape per destination.
export const IMAGE_DIMS = {
  pinterest: { width: 1000, height: 1500 },  // 2:3  — Pinterest's spec
  instagram: { width: 1080, height: 1350 },  // 4:5  — portrait feed
  facebook: { width: 1200, height: 630 },    // 1.91:1 — link/feed image
  x: { width: 1200, height: 675 },           // 16:9
  linkedin: { width: 1200, height: 627 },    // 1.91:1
  tiktok: { width: 1080, height: 1920 },     // 9:16 — full screen
};

// Fallback for any platform not listed above.
export const DEFAULT_IMAGE_DIMS = { width: 1080, height: 1080 };

export function imageDimsFor(platform, format) {
  // Video frames are always vertical, whatever the destination platform.
  if (format === 'video') return VIDEO_DIMS;
  return IMAGE_DIMS[platform] || DEFAULT_IMAGE_DIMS;
}

// Vertical 9:16 source frames for video. The render worker scales these up to
// 1080x1920; generating at 720p keeps generation fast without visible loss
// after the Ken Burns crop.
export const VIDEO_DIMS = { width: 720, height: 1280 };

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

  const img = await generateImage(prompts.imagePrompt, imageDimsFor(platform));

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
    // publishContent verifies against the account when the platform times out,
    // so a slow-but-successful publish is not logged as a failure.
    const result = await publishContent({ conn, platform, content });
    await logPost({ ...base, ...logCopy, status: 'success', post_id: result.post_id,
      error_message: null, raw_response: result.raw });
    return { platform, ok: true, post_id: result.post_id, preview: previewOf(content, copy) };
  } catch (e) {
    const status = e.unconfirmed ? 'unconfirmed' : 'fail';
    await logPost({ ...base, ...logCopy, status, post_id: null,
      error_message: e.message, raw_response: { error: e.message } });
    return {
      platform, ok: false, unconfirmed: Boolean(e.unconfirmed), error: e.message,
      stage: 'publish', preview: previewOf(content, copy),
    };
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
