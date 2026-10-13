// Designed post images, built from the product's own pictures.
//
// Posts used to be illustrated with generated lifestyle photos — a child at a
// kitchen table, a rainy window — that never showed the thing for sale. A
// reader could not tell what was being sold without reading the caption, and
// the generator answered our server with HTTP 402 half the time anyway.
//
// These slides put the real product in front of the reader: the shop's own
// mockup and cover, set on a background coloured from the product itself,
// with the post's headline, the price and the selling points drawn on. Text is
// converted to vector outlines with embedded fonts, so nothing depends on the
// fonts a serverless machine happens to have installed.

import sharp from 'sharp';
import opentype from 'opentype.js';
import * as FONTS from './fonts/index.js';

// ---------------------------------------------------------------------------
// Fonts and text
// ---------------------------------------------------------------------------

const parsed = new Map();
function font(name) {
  if (!parsed.has(name)) {
    const buf = Buffer.from(FONTS[name], 'base64');
    parsed.set(name, opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)));
  }
  return parsed.get(name);
}

// Playful brands get rounded letterforms; formal ones a clean geometric sans.
// Which reads as which is decided by the brand's own tone setting.
const TYPE = {
  playful: { display: 'fredokaSemiBold', body: 'fredokaMedium' },
  neutral: { display: 'poppinsSemiBold', body: 'poppinsMedium' },
};
export function typeFor(tone = '') {
  return /professional|luxury|premium/i.test(tone) ? TYPE.neutral : TYPE.playful;
}

// Characters the font cannot draw — emoji, mostly — would come out as empty
// boxes. They are dropped rather than printed as a defect.
function clean(text, f) {
  return [...String(text || '')]
    .filter((c) => c === ' ' || f.hasChar(c))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

function measure(f, text, size) {
  return f.getAdvanceWidth(text, size, { kerning: true });
}

function wrap(f, text, size, maxWidth) {
  const words = text.split(' ').filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (!line || measure(f, next, size) <= maxWidth) line = next;
    else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  return lines;
}

// The largest size at which the text fits the box in the allowed lines.
function fit(f, text, { maxWidth, maxLines, size, minSize }) {
  for (let s = size; s >= minSize; s -= 2) {
    const lines = wrap(f, text, s, maxWidth);
    if (lines.length <= maxLines && lines.every((l) => measure(f, l, s) <= maxWidth)) {
      return { lines, size: s };
    }
  }
  const lines = wrap(f, text, minSize, maxWidth).slice(0, maxLines);
  return { lines, size: minSize };
}

// Height of a block of `n` lines at `size`, matching where textBlock ends.
function blockHeight(n, size, lineHeight = 1.14) {
  return n > 0 ? (n - 1) * size * lineHeight + size * 1.08 : 0;
}

// SVG outlines for a block of lines. `y` is the top of the block; returns the
// markup and the y where the block ends.
function textBlock(f, lines, size, { x, y, align = 'center', fill, lineHeight = 1.14 }) {
  const ascent = (f.ascender / f.unitsPerEm) * size;
  const step = size * lineHeight;
  let markup = '';
  lines.forEach((line, i) => {
    const w = measure(f, line, size);
    const left = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    const baseline = y + ascent * 0.92 + i * step;
    const d = f.getPath(line, left, baseline, size, { kerning: true }).toPathData(1);
    markup += `<path d="${d}" fill="${fill}"/>`;
  });
  return { markup, bottom: y + (lines.length - 1) * step + size * 1.08 };
}

// ---------------------------------------------------------------------------
// Colour, taken from the product
// ---------------------------------------------------------------------------

function hsl(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const k = (n) => (n + h / 30) % 12;
  const c = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
  return `#${[c(0), c(8), c(4)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// White or near-black, whichever reads better on the given fill.
function onColor(hex, ink) {
  const l = luminance(hex);
  const contrastWhite = 1.05 / (l + 0.05);
  const contrastInk = (l + 0.05) / (luminance(ink) + 0.05);
  return contrastWhite >= contrastInk ? '#FFFFFF' : ink;
}

// The product's own colour: the most common strong hue in its picture.
//
// A plain "dominant colour" is useless here — shop mockups are mostly white
// background, so the dominant colour is white. Only pixels with real colour in
// them vote, weighted by how saturated they are.
export async function paletteFrom(image) {
  let hue = 38; // warm amber when the picture has no colour to offer
  let sat = 0.55;
  try {
    const { data, info } = await sharp(image)
      .resize(64, 64, { fit: 'inside' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const bins = new Array(36).fill(0);
    const sats = new Array(36).fill(0);
    for (let i = 0; i < data.length; i += info.channels) {
      const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const l = (max + min) / 2;
      const d = max - min;
      if (d < 0.12 || l < 0.15 || l > 0.9) continue;
      const s = d / (1 - Math.abs(2 * l - 1));
      let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h = (h * 60 + 360) % 360;
      const bin = Math.floor(h / 10);
      bins[bin] += s;
      sats[bin] += s;
    }
    let best = -1;
    bins.forEach((v, i) => { if (v > 0 && (best < 0 || v > bins[best])) best = i; });
    if (best >= 0 && bins[best] > 6) {
      hue = best * 10 + 5;
      sat = Math.min(0.85, Math.max(0.4, sats[best] / Math.max(1, bins[best]) + 0.1));
    }
  } catch { /* keep the warm default */ }

  const ink = hsl(hue, 0.35, 0.13);
  const accent = hsl(hue, Math.min(0.9, sat + 0.1), 0.46);
  return {
    hue,
    bg: hsl(hue, Math.min(0.6, sat), 0.95),
    bg2: hsl(hue, Math.min(0.65, sat), 0.88),
    deep: hsl(hue, Math.min(0.7, sat), 0.22),
    accent,
    onAccent: onColor(accent, ink),
    ink,
    inkSoft: hsl(hue, 0.18, 0.32),
    // A second hue a third of the wheel away, for the decorative shapes.
    pop: hsl((hue + 140) % 360, 0.75, 0.62),
  };
}

// ---------------------------------------------------------------------------
// Pictures
// ---------------------------------------------------------------------------

// A picture fitted into a box, with rounded corners. Returns the buffer and
// its final size so the caller can centre it and put a shadow under it.
async function framed(image, maxW, maxH, radius) {
  const resized = await sharp(image)
    .resize(Math.round(maxW), Math.round(maxH), { fit: 'inside', withoutEnlargement: false })
    .toBuffer({ resolveWithObject: true });
  const { width, height } = resized.info;
  const mask = Buffer.from(
    `<svg width="${width}" height="${height}"><rect width="${width}" height="${height}" rx="${radius}" ry="${radius}"/></svg>`
  );
  const data = await sharp(resized.data)
    .ensureAlpha()
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();
  return { data, width, height };
}

function shadow(x, y, w, h, r, color, u) {
  return `<rect x="${x}" y="${y + 18 * u}" width="${w}" height="${h}" rx="${r}" fill="${color}" opacity="0.28" filter="url(#soft)"/>`;
}

const DEFS = (u) => `<defs><filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${22 * u}"/></filter></defs>`;

// A row of pills, centred on x. Each pill: { text, fill, color }.
function pills(items, f, { cx, y, u }) {
  const size = 34 * u;
  const padX = 30 * u;
  const h = 74 * u;
  const gap = 18 * u;
  const widths = items.map((p) => measure(f, p.text, size) + padX * 2);
  const total = widths.reduce((a, b) => a + b, 0) + gap * (items.length - 1);
  let x = cx - total / 2;
  let markup = '';
  items.forEach((p, i) => {
    markup += `<rect x="${x}" y="${y}" width="${widths[i]}" height="${h}" rx="${h / 2}" fill="${p.fill}"${p.stroke ? ` stroke="${p.stroke}" stroke-width="${2 * u}"` : ''}/>`;
    markup += textBlock(f, [p.text], size, {
      x: x + widths[i] / 2, y: y + (h - size * 1.08) / 2 + size * 0.04, fill: p.color,
    }).markup;
    x += widths[i] + gap;
  });
  return { markup, bottom: y + h };
}

// Soft decorative circles in the corners — the shop's own mockups use paint
// splashes; this keeps the feel without pretending to be them.
function blobs(W, H, pal, u) {
  return [
    `<circle cx="${W * 0.92}" cy="${H * 0.06}" r="${190 * u}" fill="${pal.accent}" opacity="0.14"/>`,
    `<circle cx="${W * 0.04}" cy="${H * 0.3}" r="${120 * u}" fill="${pal.pop}" opacity="0.16"/>`,
    `<circle cx="${W * 0.1}" cy="${H * 0.97}" r="${210 * u}" fill="${pal.accent}" opacity="0.12"/>`,
    `<circle cx="${W * 0.95}" cy="${H * 0.78}" r="${90 * u}" fill="${pal.pop}" opacity="0.14"/>`,
  ].join('');
}

async function finish(W, H, svg, layers) {
  return sharp(Buffer.from(svg))
    .resize(W, H)
    .composite(layers)
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
}

// ---------------------------------------------------------------------------
// Slides
// ---------------------------------------------------------------------------

// The thumbnail: headline, the product itself, and the two facts a buyer
// checks first. It has to sell on its own — most people never swipe.
async function heroSlide({ W, H, u, pal, type, image, text, brandName }) {
  const disp = font(type.display);
  const body = font(type.body);
  const margin = 70 * u;
  const tall = H / W > 1.4;

  // Measure everything first, then centre the whole stack: a wide picture on
  // a tall canvas otherwise leaves a hole between the words and the badges.
  const head = fit(disp, clean(text.headline, disp) || ' ', {
    maxWidth: W - margin * 2, maxLines: tall ? 3 : 2, size: (tall ? 108 : 96) * u, minSize: 60 * u,
  });
  const sub = clean(text.subhead, body);
  const subFit = sub
    ? fit(body, sub, { maxWidth: W - margin * 2, maxLines: 2, size: (tall ? 44 : 40) * u, minSize: 30 * u })
    : null;
  const brand = clean(brandName, body);

  const headH = blockHeight(head.lines.length, head.size);
  const subH = subFit ? 20 * u + blockHeight(subFit.lines.length, subFit.size) : 0;
  const gapAbove = 54 * u;
  const gapBelow = 64 * u;
  const pillH = 74 * u;
  const brandH = brand ? 36 * u + 28 * u * 1.08 : 0;
  const outer = 80 * u;

  const maxPicH = H - outer * 2 - headH - subH - gapAbove - gapBelow - pillH - brandH;
  const pic = await framed(image, W - 2 * 48 * u, Math.max(200 * u, maxPicH), 26 * u);

  const stackH = headH + subH + gapAbove + pic.height + gapBelow + pillH + brandH;
  let y = Math.max(outer, (H - stackH) / 2);

  const h = textBlock(disp, head.lines, head.size, { x: W / 2, y, fill: pal.ink });
  let markup = h.markup;
  y = h.bottom;
  if (subFit) {
    const b = textBlock(body, subFit.lines, subFit.size, { x: W / 2, y: y + 20 * u, fill: pal.inkSoft });
    markup += b.markup;
    y = b.bottom;
  }
  y += gapAbove;
  const px = Math.round((W - pic.width) / 2);
  const py = Math.round(y);
  y += pic.height + gapBelow;

  const p = pills(text.badges.map((b, i) => (i === 0
    ? { text: b, fill: pal.accent, color: pal.onAccent }
    : { text: b, fill: '#FFFFFF', color: pal.ink, stroke: pal.bg2 })), body, { cx: W / 2, y, u });
  y = p.bottom;

  const foot = brand
    ? textBlock(body, [brand], 28 * u, { x: W / 2, y: y + 36 * u, fill: pal.inkSoft }).markup
    : '';

  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${DEFS(u)}
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${pal.bg}"/><stop offset="1" stop-color="${pal.bg2}"/></linearGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#g)"/>${blobs(W, H, pal, u)}
    ${shadow(px, py, pic.width, pic.height, 26 * u, pal.deep, u)}
    ${markup}${p.markup}${foot}</svg>`;
  return finish(W, H, svg, [{ input: pic.data, left: px, top: py }]);
}

// The cover on its own, large — the picture a buyer will recognise in the shop.
async function coverSlide({ W, H, u, pal, type, image, text }) {
  const disp = font(type.display);
  const body = font(type.body);
  const margin = 80 * u;

  const line = clean(text.coverLine, disp);
  const l = fit(disp, line || ' ', { maxWidth: W - margin * 2, maxLines: 2, size: 64 * u, minSize: 44 * u });
  const t = textBlock(disp, l.lines, l.size, { x: W / 2, y: 86 * u, fill: pal.deep });

  const name = clean(text.productName, body);
  const n = fit(body, name || ' ', { maxWidth: W - margin * 2, maxLines: 2, size: 40 * u, minSize: 30 * u });
  const nameY = H - 70 * u - n.lines.length * n.size * 1.14;
  const nb = textBlock(body, n.lines, n.size, { x: W / 2, y: nameY, fill: pal.inkSoft });

  const areaTop = t.bottom + 40 * u;
  const areaH = nameY - 44 * u - areaTop;
  const pic = await framed(image, W - 2 * 90 * u, areaH, 22 * u);
  const px = Math.round((W - pic.width) / 2);
  const py = Math.round(areaTop + (areaH - pic.height) / 2);

  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${DEFS(u)}
    <rect width="${W}" height="${H}" fill="${pal.bg2}"/>
    <circle cx="${W / 2}" cy="${py + pic.height / 2}" r="${Math.max(pic.width, pic.height) * 0.62}" fill="#FFFFFF" opacity="0.55"/>
    ${blobs(W, H, pal, u)}
    ${shadow(px, py, pic.width, pic.height, 22 * u, pal.deep, u)}
    ${t.markup}${nb.markup}</svg>`;
  return finish(W, H, svg, [{ input: pic.data, left: px, top: py }]);
}

// Three short reasons, on the product's darkest colour. The swipe that
// answers "why this one?" in five seconds.
async function bulletsSlide({ W, H, u, pal, type, image, text }) {
  const disp = font(type.display);
  const body = font(type.body);
  const margin = 86 * u;
  const dot = 56 * u;
  const textW = W - margin * 2 - dot - 32 * u;

  const title = clean(text.bulletsTitle, disp) || ' ';
  const tt = fit(disp, title, { maxWidth: W - margin * 2, maxLines: 2, size: 84 * u, minSize: 56 * u });
  const rows = (text.bullets || []).slice(0, 3)
    .map((raw) => clean(raw, body))
    .filter(Boolean)
    .map((line) => fit(body, line, { maxWidth: textW, maxLines: 2, size: 52 * u, minSize: 38 * u }));

  // The picture goes in the bottom corner; the words are centred in what is left.
  const layers = [];
  let thumbMarkup = '';
  let thumbH = 0;
  if (image) {
    const box = Math.min(W * 0.4, H * 0.3);
    const pic = await framed(image, box * 1.4, box, 18 * u);
    const px = Math.round(W - margin - pic.width);
    const py = Math.round(H - 76 * u - pic.height);
    thumbMarkup = shadow(px, py, pic.width, pic.height, 18 * u, '#000000', u);
    layers.push({ input: pic.data, left: px, top: py });
    thumbH = pic.height + 76 * u;
  }

  const rowGap = 50 * u;
  const rowsH = rows.reduce((sum, r) => sum + Math.max(dot, blockHeight(r.lines.length, r.size)), 0)
    + rowGap * Math.max(0, rows.length - 1);
  const blockH = blockHeight(tt.lines.length, tt.size) + 64 * u + rowsH;
  const room = H - thumbH - 60 * u;
  let y = Math.max(90 * u, (room - blockH) / 2);

  const t = textBlock(disp, tt.lines, tt.size, { x: margin, y, align: 'left', fill: '#FFFFFF' });
  let markup = t.markup;
  y = t.bottom + 64 * u;
  for (const r of rows) {
    const rowH = Math.max(dot, blockHeight(r.lines.length, r.size));
    const cy = y + Math.min(rowH, dot) / 2 + (r.lines.length > 1 ? 4 * u : 0);
    markup += `<circle cx="${margin + dot / 2}" cy="${cy}" r="${dot / 2}" fill="${pal.accent}"/>`;
    markup += `<path d="M ${margin + dot * 0.28} ${cy} l ${dot * 0.16} ${dot * 0.17} l ${dot * 0.3} ${-dot * 0.34}" stroke="${pal.onAccent}" stroke-width="${7 * u}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
    const textTop = r.lines.length > 1 ? y : y + (dot - r.size * 1.08) / 2;
    markup += textBlock(body, r.lines, r.size, {
      x: margin + dot + 32 * u, y: textTop, align: 'left', fill: '#FFFFFF',
    }).markup;
    y += rowH + rowGap;
  }

  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${DEFS(u)}
    <rect width="${W}" height="${H}" fill="${pal.deep}"/>
    <circle cx="${W * 0.95}" cy="${H * 0.08}" r="${230 * u}" fill="${pal.accent}" opacity="0.22"/>
    <circle cx="${W * 0.02}" cy="${H * 0.92}" r="${160 * u}" fill="${pal.pop}" opacity="0.18"/>
    ${thumbMarkup}${markup}</svg>`;
  return finish(W, H, svg, layers);
}

// The ask. Big, plain, and impossible to mistake for anything else.
async function ctaSlide({ W, H, u, pal, type, image, text }) {
  const disp = font(type.display);
  const body = font(type.body);
  const margin = 80 * u;
  const tall = H / W > 1.4;

  const line = clean(text.ctaLine, disp) || 'Get yours today';
  const l = fit(disp, line, { maxWidth: W - margin * 2, maxLines: tall ? 3 : 2, size: (tall ? 120 : 112) * u, minSize: 70 * u });
  const name = clean(text.productName, body);
  const n = name ? fit(body, name, { maxWidth: W - margin * 2, maxLines: 2, size: 44 * u, minSize: 32 * u }) : null;
  const pillItems = [
    { text: text.price, fill: '#FFFFFF', color: pal.deep },
    { text: text.action, fill: pal.deep, color: '#FFFFFF' },
  ].filter((x) => clean(x.text, body));

  const lineH = blockHeight(l.lines.length, l.size);
  const nameH = n ? 24 * u + blockHeight(n.lines.length, n.size) : 0;
  const gapAbove = 56 * u;
  const gapBelow = 64 * u;
  const pillH = pillItems.length ? 74 * u : 0;
  const outer = 90 * u;

  const layers = [];
  let pic = null;
  const maxPicH = H - outer * 2 - lineH - nameH - gapAbove - gapBelow - pillH;
  if (image && maxPicH > 200 * u) pic = await framed(image, W - 2 * 100 * u, maxPicH, 24 * u);

  const stackH = lineH + nameH + (pic ? gapAbove + pic.height : 0) + gapBelow + pillH;
  let y = Math.max(outer, (H - stackH) / 2);

  const t = textBlock(disp, l.lines, l.size, { x: W / 2, y, fill: pal.onAccent });
  let markup = t.markup;
  y = t.bottom;
  if (n) {
    const nb = textBlock(body, n.lines, n.size, { x: W / 2, y: y + 24 * u, fill: pal.onAccent });
    markup += nb.markup;
    y = nb.bottom;
  }
  let picMarkup = '';
  if (pic) {
    y += gapAbove;
    const px = Math.round((W - pic.width) / 2);
    const py = Math.round(y);
    picMarkup = shadow(px, py, pic.width, pic.height, 24 * u, pal.deep, u);
    layers.push({ input: pic.data, left: px, top: py });
    y += pic.height;
  }
  y += gapBelow;
  const p = pillItems.length ? pills(pillItems, body, { cx: W / 2, y, u }) : { markup: '' };

  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${DEFS(u)}
    <defs><linearGradient id="c" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${pal.accent}"/><stop offset="1" stop-color="${pal.deep}"/></linearGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#c)"/>
    <circle cx="${W * 0.9}" cy="${H * 0.12}" r="${200 * u}" fill="#FFFFFF" opacity="0.10"/>
    <circle cx="${W * 0.08}" cy="${H * 0.86}" r="${170 * u}" fill="#FFFFFF" opacity="0.08"/>
    ${picMarkup}${markup}${p.markup}</svg>`;
  return finish(W, H, svg, layers);
}

const SLIDES = { hero: heroSlide, cover: coverSlide, bullets: bulletsSlide, cta: ctaSlide };

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

// Downloads are shared between the platforms of one slot: the same book is
// drawn for Instagram and Pinterest a few seconds apart.
const imageCache = new Map();
async function load(url) {
  if (!url) return null;
  if (imageCache.has(url)) return imageCache.get(url);
  const pending = (async () => {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await sharp(buf).metadata(); // throws if it is not a picture
    return buf;
  })().catch(() => null);
  imageCache.set(url, pending);
  if (imageCache.size > 40) imageCache.delete(imageCache.keys().next().value);
  return pending;
}

export function canDesign(product) {
  return Boolean(product?.image_url);
}

// The product's real pictures: the main one (often a mockup with pages) and,
// when the shop has one, a cover shot for the second slide.
export async function productImages(product) {
  const gallery = Array.isArray(product?.gallery) ? product.gallery.filter(Boolean) : [];
  const main = await load(product?.image_url);
  const extra = gallery.length ? await load(gallery[0]) : null;
  return { main: main || extra, cover: extra || main };
}

const ACTIONS = { instagram: 'Link in bio', pinterest: 'Tap to get it', facebook: 'Link below', tiktok: 'Link in bio' };

function priceLabel(price) {
  const p = String(price || '').trim();
  if (!p) return '';
  return /^(free|0|\$?0(\.00)?|gratuit|gratis)$/i.test(p) ? 'FREE' : p;
}

// Draws the slides for one post. `kinds` is the recipe's slide order; a single
// image post gets the hero alone. Returns JPEG buffers in slide order.
export async function designSlides({
  product, copy, kinds = ['hero'], dims, platform, tone, brandName,
}) {
  const { main, cover } = await productImages(product);
  if (!main) throw new Error('could not download the product picture');

  const pal = await paletteFrom(cover || main);
  const type = typeFor(tone);
  const W = dims.width;
  const H = dims.height;
  const u = W / 1080;
  const price = priceLabel(product.price);
  const badges = [copy.badge || 'Instant download', price].map((b) => String(b || '').trim()).filter(Boolean).slice(0, 2);

  const text = {
    headline: copy.headline || product.name,
    subhead: copy.subhead,
    badges,
    coverLine: copy.coverLine,
    bulletsTitle: copy.bulletsTitle,
    bullets: copy.bullets,
    ctaLine: copy.ctaLine,
    productName: product.name,
    price,
    action: ACTIONS[platform] || 'Link in bio',
  };

  const out = [];
  for (const kind of kinds) {
    const render = SLIDES[kind];
    if (!render) continue;
    const image = kind === 'cover' ? (cover || main) : kind === 'bullets' ? (cover || main) : main;
    out.push(await render({ W, H, u, pal, type, image, text, brandName }));
  }
  return out;
}

