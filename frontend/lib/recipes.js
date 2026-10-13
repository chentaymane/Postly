// Creative angles for a post about one product.
//
// Posts used to rotate through abstract "angles" ("a common problem the
// product solves") on top of a brief that told the writer to lead with a
// lifestyle moment. The result read like the same rainy-afternoon story about
// coloring in general, with the actual book an afterthought. Every recipe here
// starts from the product — its name, what is in it, its price — and differs
// only in the creative frame around it, so the feed stays varied while every
// single post sells something specific.
//
// A recipe decides three things: what the caption does, what the words on the
// images say, and which designed slides the carousel uses (see designer.js).

const isFree = (p) => /^(free|0|\$?0(\.00)?|gratuit|gratis)$/i.test(String(p?.price || '').trim())
  || /^free\b/i.test(String(p?.name || ''));

const isDeal = (p) => /\b(offer|deal|bundle|pack|set of)\b|\+/i.test(`${p?.name || ''}`);

const isDigital = (p, brand) => /download|printable|pdf|digital/i.test(
  `${p?.description || ''} ${p?.facts || ''} ${brand?.products || ''}`
);

// Occasions a product can be tied to, by the words in its name and tags, with
// the stretch of the year when the tie-in reads as timely rather than random.
// Months are 1-12; a window may wrap past December.
const OCCASIONS = [
  { name: 'Halloween', words: /hallowe?en|spooky|pumpkin|witch|ghost|monster/i, from: [9, 20], to: [10, 31], date: [10, 31] },
  { name: 'Christmas', words: /christmas|xmas|santa|noel|winter|snow|reindeer/i, from: [11, 10], to: [12, 25], date: [12, 25] },
  { name: 'Easter', words: /easter|bunny|spring|egg/i, from: [3, 10], to: [4, 20] },
  { name: "Valentine's Day", words: /valentine|love|heart/i, from: [1, 25], to: [2, 14], date: [2, 14] },
  { name: 'back to school', words: /school|alphabet|abc|numbers?|letters|learn/i, from: [8, 10], to: [9, 25] },
  { name: 'Thanksgiving', words: /thanksgiving|turkey|autumn|fall/i, from: [11, 1], to: [11, 27] },
  { name: 'summer holidays', words: /summer|beach|ocean|sea|vacation|holiday/i, from: [6, 15], to: [8, 25] },
];

function inWindow(now, from, to) {
  const md = (now.getUTCMonth() + 1) * 100 + now.getUTCDate();
  const a = from[0] * 100 + from[1];
  const b = to[0] * 100 + to[1];
  return a <= b ? md >= a && md <= b : md >= a || md <= b;
}

// The occasion this product fits right now, if any.
export function occasionFor(product, now = new Date()) {
  const text = `${product?.name || ''} ${product?.tags || ''}`;
  for (const o of OCCASIONS) {
    if (!o.words.test(text) || !inWindow(now, o.from, o.to)) continue;
    let days = null;
    if (o.date) {
      const year = now.getUTCFullYear();
      let target = Date.UTC(year, o.date[0] - 1, o.date[1]);
      if (target < now.getTime() - 86400000) target = Date.UTC(year + 1, o.date[0] - 1, o.date[1]);
      days = Math.max(0, Math.round((target - now.getTime()) / 86400000));
    }
    return { name: o.name, days };
  }
  return null;
}

// Late in the year every product is a potential present, whatever it is.
const giftSeason = (now) => inWindow(now, [11, 1], [12, 24]);

export const RECIPES = {
  showcase: {
    label: 'Meet the product',
    types: ['promo'],
    slides: ['hero', 'cover', 'bullets', 'cta'],
    brief:
      'Introduce this product directly, the way its proud maker would at a market stall: what it is, '
      + 'what is in it (only what the details support), and exactly who it is perfect for. '
      + 'The hook is the single most appealing thing about owning it, said plainly.',
    headline: 'the product\'s promise in 4-7 words',
  },
  peek: {
    label: 'A look inside',
    types: ['promo', 'tips'],
    slides: ['hero', 'bullets', 'cover', 'cta'],
    brief:
      'Take the reader inside the product: name 2-3 specific things they will find in it — pages, '
      + 'characters, scenes, parts — only what the name and details support, and the feeling of starting '
      + 'the first one. Leave them curious about the rest.',
    headline: 'a curiosity hook about what is inside, 4-7 words',
  },
  gift: {
    label: 'Gift idea',
    types: ['promo'],
    slides: ['cover', 'hero', 'bullets', 'cta'],
    brief:
      'Pitch it as an easy, thoughtful gift: one specific person to give it to (a niece, a whole class, '
      + 'a friend who needs a calm evening) and one specific occasion (a birthday party favour, a holiday, '
      + 'a "thinking of you"). If it is a download, say it can be ready to give in minutes.',
    headline: 'a gift idea in 4-7 words',
  },
  pick: {
    label: 'Which would you pick?',
    types: ['engage'],
    slides: ['hero', 'cover', 'cta'],
    brief:
      'An engagement post built on this product: tease 2-3 things the details say are inside it and ask '
      + 'readers which one they would start with, answering in the comments with a number or a word. If the '
      + 'details do not name what is inside, ask which part of the theme they would color first instead. '
      + 'Keep it playful. End by saying where to get it.',
    headline: 'a short playful question, 3-7 words',
  },
  moment: {
    label: 'The perfect moment',
    types: ['promo', 'engage', 'tips'],
    slides: ['hero', 'bullets', 'cta'],
    brief:
      'Name ONE specific, real moment this exact product is perfect for (the half hour before dinner, a '
      + 'long car ride, a sleepover, a quiet Sunday morning) and show how this product fits it. '
      + 'One moment only, vivid and concrete — and the product named, not "coloring" in general.',
    headline: 'the moment, in 4-7 words',
  },
  free: {
    label: 'Free download',
    types: ['promo', 'engage'],
    when: (p) => isFree(p),
    weight: 2,
    slides: ['hero', 'cover', 'cta'],
    brief:
      'Lead with FREE. This product is free to download: say exactly what they get, that there is no catch, '
      + 'and that if they love it the full versions are in the shop. Make the first line impossible to ignore.',
    headline: 'starts with "Free" — 3-7 words',
  },
  season: {
    label: 'Seasonal',
    types: ['promo', 'engage'],
    when: (p, ctx) => Boolean(ctx.occasion),
    weight: 2,
    slides: ['hero', 'bullets', 'cta'],
    brief:
      'Tie the product to {occasion}, which is coming up now{days}. Say why it fits {occasion} and one '
      + 'concrete way to use it then (a party table, a classroom, a family evening). Timely, not pushy.',
    headline: 'mentions {occasion}, 4-7 words',
  },
  classroom: {
    label: 'For teachers & parents',
    types: ['promo', 'tips'],
    when: (p, ctx) => ctx.digital,
    slides: ['hero', 'bullets', 'cta'],
    brief:
      'Speak to teachers, homeschool parents and childminders. A printable means one purchase covers a whole '
      + 'group — print as many copies as needed. Suggest one concrete way to use this product in a lesson, '
      + 'a quiet-time slot or a theme week.',
    headline: 'speaks to teachers or parents, 4-7 words',
  },
  deal: {
    label: 'The deal',
    types: ['promo'],
    when: (p) => isDeal(p),
    weight: 2,
    slides: ['hero', 'bullets', 'cta'],
    brief:
      'Spell out exactly what is included and the price, as given in the details. No invented discounts, '
      + 'countdowns or "limited" claims unless the details state them.',
    headline: 'what you get, 4-7 words',
  },
};

// The recipes that fit this product today, weighted, in a stable order.
export function eligibleRecipes(product, { postType = 'mixed', now = new Date(), brand = null } = {}) {
  const ctx = { occasion: occasionFor(product, now), digital: isDigital(product, brand), giftSeason: giftSeason(now) };
  const list = [];
  for (const [key, r] of Object.entries(RECIPES)) {
    if (postType !== 'mixed' && !r.types.includes(postType)) continue;
    if (r.when && !r.when(product, ctx)) continue;
    let weight = r.weight || 1;
    if (key === 'gift' && ctx.giftSeason) weight = 2;
    for (let i = 0; i < weight; i++) list.push(key);
  }
  // A product with nothing special about it still gets the core angles.
  if (list.length === 0) list.push('showcase', 'peek', 'moment');
  return { keys: list, ctx };
}

// One recipe for one post. `seed` varies by slot and run, so consecutive posts
// — and consecutive posts about the same product — take different angles.
export function pickRecipe(product, { postType = 'mixed', seed = 0, now = new Date(), brand = null, avoid = null } = {}) {
  const { keys, ctx } = eligibleRecipes(product, { postType, now, brand });
  let key = keys[Math.abs(seed) % keys.length];
  if (avoid && key === avoid && keys.some((k) => k !== avoid)) {
    key = keys.find((k, i) => k !== avoid && i > (Math.abs(seed) % keys.length)) || keys.find((k) => k !== avoid);
  }
  return { key, recipe: RECIPES[key], ctx };
}

// The recipe's brief with this product's occasion filled in.
export function recipeBrief(key, ctx = {}) {
  const r = RECIPES[key] || RECIPES.showcase;
  const occasion = ctx.occasion?.name || 'the season';
  const days = ctx.occasion?.days != null ? ` (in ${ctx.occasion.days} days)` : '';
  const fill = (t) => t.replace(/\{occasion\}/g, occasion).replace(/\{days\}/g, days);
  return { label: r.label, brief: fill(r.brief), headline: fill(r.headline), slides: r.slides };
}
