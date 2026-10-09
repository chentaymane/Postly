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

  return {
    name: title.slice(0, 200),
    description: metaTag(html, 'og:description', 'twitter:description', 'description').slice(0, 1000),
    // Relative og:image values are rare but do happen.
    image_url: image ? new URL(image, url).toString().slice(0, 1000) : '',
    price: metaTag(html, 'product:price:amount', 'og:price:amount'),
    url: url.toString().slice(0, 1000),
  };
}
