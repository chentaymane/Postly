// The catalogue a post can actually be about.
//
// Without this every caption was about the business in general and every link
// went to the shop's front door, so a reader who wanted the thing in the
// picture had to go and find it themselves. A product gives the writer a real
// subject and gives the post a link that lands on the item.

import { query } from './db.js';

// Picks which product this post should be about.
//
// Least-used first, oldest tie-break: a catalogue of twenty books becomes
// twenty posts rather than the same bestseller twenty times. The automation may
// also be pinned to one product, in which case the rotation is bypassed.
export async function pickProduct(userId, { pinnedId = null } = {}) {
  if (pinnedId) {
    const { rows } = await query(
      'SELECT * FROM products WHERE id = $1 AND user_id = $2 AND enabled',
      [pinnedId, userId]
    );
    if (rows[0]) return rows[0];
    // A pinned product that has been deleted or disabled should not silently
    // stop the automation — fall through to the rotation.
  }

  const { rows } = await query(
    `SELECT * FROM products
      WHERE user_id = $1 AND enabled
      ORDER BY times_used ASC, last_used_at ASC NULLS FIRST, id
      LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

// Records that a product has had its turn, so the next pick moves on.
export async function markProductUsed(productId) {
  if (!productId) return;
  await query(
    `UPDATE products SET times_used = times_used + 1, last_used_at = now(), updated_at = now()
      WHERE id = $1`,
    [productId]
  ).catch(() => {});
}

// What the writer is told about the product. Deliberately plain prose rather
// than a JSON blob: the model writes better copy from a sentence than from a
// schema, and anything missing simply goes unmentioned.
export function productBrief(product) {
  if (!product) return '';
  return [
    `THIS POST IS ABOUT ONE SPECIFIC PRODUCT: "${product.name}".`,
    product.description ? `What it is: ${product.description}` : '',
    product.benefits ? `Why someone buys this one: ${product.benefits}` : '',
    product.price ? `Price: ${product.price}` : '',
    product.tags ? `Themes: ${product.tags}` : '',
    'Write about THIS product, not the shop in general. Name it naturally at '
      + 'least once. The call to action points at this item, not the homepage.',
  ].filter(Boolean).join('\n');
}

// ---------------------------------------------------------------------------
// Importing from a product page.
//
// Typing twenty books in by hand is the kind of chore that means the catalogue
// never gets filled, and an empty catalogue is why the posts were generic. Most
// shop pages already describe themselves in Open Graph tags, which is enough to
// fill the form and let the user correct it.
// ---------------------------------------------------------------------------

function metaTag(html, ...names) {
  for (const name of names) {
    const patterns = [
      new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']+)["']`, 'i'),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${name}["']`, 'i'),
    ];
    for (const re of patterns) {
      const m = re.exec(html);
      if (m?.[1]) return decodeEntities(m[1].trim());
    }
  }
  return '';
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

export async function importFromUrl(rawUrl) {
  let url;
  try {
    url = new URL(String(rawUrl).trim());
  } catch {
    throw new Error('that does not look like a web address');
  }
  if (!/^https?:$/.test(url.protocol)) {
    throw new Error('only http and https addresses can be read');
  }

  let html;
  try {
    const res = await fetch(url.toString(), {
      // Some shops serve a different page to something that looks like a bot.
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; Postly/1.0)' },
      signal: AbortSignal.timeout(20000),
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`the page answered HTTP ${res.status}`);
    html = (await res.text()).slice(0, 400000);
  } catch (e) {
    throw new Error(`could not read that page (${e.message})`);
  }

  const title =
    metaTag(html, 'og:title', 'twitter:title')
    || decodeEntities((/<title[^>]*>([^<]+)<\/title>/i.exec(html)?.[1] || '').trim());

  const image = metaTag(html, 'og:image', 'og:image:secure_url', 'twitter:image');

  const basic = {
    name: title.slice(0, 200),
    description: metaTag(html, 'og:description', 'twitter:description', 'description').slice(0, 1000),
    // Relative og:image values are rare but do happen.
    image_url: image ? new URL(image, url).toString().slice(0, 1000) : '',
    price: metaTag(html, 'product:price:amount', 'og:price:amount'),
    url: url.toString().slice(0, 1000),
    gallery: [],
    facts: '',
  };

  // A richer reading where the shop offers one. The Open Graph tags carry a
  // truncated description and one small preview; the page itself often has
  // every preview image at full size and the facts a buyer checks first.
  const rich = gumroadData(html);
  if (!rich) return basic;
  return {
    ...basic,
    description: rich.description || basic.description,
    image_url: rich.images[0] || basic.image_url,
    gallery: rich.gallery,
    price: rich.price || basic.price,
    facts: rich.facts,
  };
}

// The product data a Gumroad page embeds for its own app: every preview image
// at full size, the full description, the page count and the price in cents.
// Read defensively — it is a page, not an API, and may change shape.
function gumroadData(html) {
  const text = decodeEntities(html);
  if (!/"covers":\[/.test(text) || !/gumroad/i.test(text)) return null;

  const str = (key) => {
    const m = new RegExp(`"${key}":"((?:[^"\\\\]|\\\\.)*)"`).exec(text);
    if (!m) return '';
    try { return JSON.parse(`"${m[1]}"`); } catch { return m[1]; }
  };
  const num = (key) => {
    const m = new RegExp(`"${key}":(-?\\d+)`).exec(text);
    return m ? Number(m[1]) : null;
  };

  let covers = [];
  const cm = /"covers":(\[[\s\S]*?\]),"main_cover_id"/.exec(text);
  if (cm) {
    try { covers = JSON.parse(cm[1]); } catch { covers = []; }
  }
  const images = covers
    .filter((c) => !c.type || c.type === 'image')
    .map((c) => c.original_url || c.url)
    .filter((u) => /^https:\/\//.test(u || ''));

  // The square thumbnail is usually the cover alone — the picture a buyer
  // recognises, and a good second slide after the full mockup.
  const thumb = str('thumbnail_url');
  const gallery = [thumb, ...images.slice(1)].filter((u) => /^https:\/\//.test(u || ''));

  const descriptionHtml = str('description_html');
  const description = descriptionHtml
    .replace(/<\s*(br|\/p|\/li|\/h\d)\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
    .slice(0, 2000);

  const cents = num('price_cents');
  const currency = (str('currency_code') || 'usd').toUpperCase();
  const symbol = { USD: '$', EUR: '€', GBP: '£' }[currency];
  const price = cents === null
    ? ''
    : cents === 0
      ? 'Free'
      : symbol ? `${symbol}${(cents / 100).toFixed(2)}` : `${(cents / 100).toFixed(2)} ${currency}`;

  // "17 Pages- Format PDF - 2.6MB" → "17 Pages · Format PDF · 2.6MB"
  const facts = str('summary').split(/\s*-\s+|\s+-\s*/).map((s) => s.trim()).filter(Boolean).join(' · ').slice(0, 200);

  return { images, gallery, description, price, facts };
}

// Re-reads a product's own page and refreshes what the posts are built from:
// the pictures, the full description, the facts and the price. The name, the
// link, the user's own notes ("why someone buys this") and the tags are left
// alone — those may have been written by hand.
export async function refreshProduct(product) {
  if (!product?.url) throw new Error('this product has no page link to read');
  const page = await importFromUrl(product.url);
  const { rows } = await query(
    `UPDATE products SET
        image_url = COALESCE(NULLIF($2, ''), image_url),
        gallery = $3::jsonb,
        description = COALESCE(NULLIF($4, ''), description),
        facts = NULLIF($5, ''),
        price = COALESCE(NULLIF($6, ''), price),
        updated_at = now()
      WHERE id = $1
      RETURNING *`,
    [product.id, page.image_url, JSON.stringify(page.gallery || []), page.description, page.facts, page.price]
  );
  return rows[0];
}
