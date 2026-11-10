import test from 'node:test';
import assert from 'node:assert/strict';
import { composeMessage, normaliseHashtags } from '../lib/content.js';
import { taggedLink, isLinkPreview } from '../lib/attribution.js';
import { cronHintFor, correctedScheduledAt } from '../lib/schedule.js';
import { parseCopy, buildPrompts, generateCopy } from '../lib/pipeline.js';
import { withUserKeys } from '../lib/keycontext.js';
import { modelFor, forgetModel, pinnedModel } from '../lib/models.js';

test('publishing avoids a repeated CTA, including punctuation differences', () => {
  const text = composeMessage({ caption: 'Your next project.\nGet it now — link in bio!', cta: 'Get it now – link in bio', hashtags: ['art', '#Art'] });
  assert.equal(text, 'Your next project.\nGet it now — link in bio!\n\n#art');
});
test('Facebook receives the product link; Instagram retains its caption CTA', () => {
  const content = { caption: 'A quieter evening.', cta: 'See the book', destinationUrl: 'https://shop.example/book' };
  assert.match(composeMessage(content, 'facebook'), /https:\/\/shop.example\/book/);
  assert.doesNotMatch(composeMessage(content, 'instagram'), /https:/);
});
test('hashtags are bounded, unique and support non-English text', () => {
  assert.equal(normaliseHashtags(['##Art', 'art', '#فن', 'kids craft', '']), '#Art #فن #kidscraft');
  assert.equal(normaliseHashtags(Array.from({ length: 15 }, (_, i) => `tag${i}`)).split(' ').length, 10);
});
test('attribution preserves campaigns and records the originating platform', () => {
  const url = new URL(taggedLink('https://shop.example/book?utm_campaign=launch#details', 'instagram', 12));
  assert.equal(url.searchParams.get('utm_source'), 'instagram');
  assert.equal(url.searchParams.get('utm_campaign'), 'launch');
  assert.equal(url.searchParams.get('utm_content'), '12');
  assert.equal(url.hash, '#details');
  assert.throws(() => taggedLink('javascript:alert(1)', 'facebook', 1));
});
test('link previews do not inflate visitor counts', () => {
  assert.equal(isLinkPreview(new Headers({ 'user-agent': 'facebookexternalhit/1.1' })), true);
  assert.equal(isLinkPreview(new Headers({ 'sec-purpose': 'prefetch' })), true);
  assert.equal(isLinkPreview(new Headers({ 'user-agent': 'Mozilla/5.0 Mobile Safari' })), false);
});
const hint = (timezone, times) => cronHintFor([{ enabled: true, timezone, times }], { now: new Date('2026-11-10T00:00:00Z') });
test('scheduler hints convert half-hour timezones to UTC', () => {
  const h = hint('Asia/Kolkata', ['09:00']);
  assert.equal(h.expression, '30,35,40 3 * * *');
  assert.equal(h.timezone, 'UTC');
});
test('retry windows cross midnight and DST offsets are included', () => {
  assert.equal(hint('UTC', ['23:58']).expression, '3,8,58 0,23 * * *');
  const hours = hint('America/New_York', ['09:00']).expression.split(' ')[1];
  assert.equal(hours, '13,14');
  assert.equal(cronHintFor([{ enabled: false, times: ['09:00'] }]), null);
});
test('future slots stored as UTC are aligned to Casablanca wall-clock time', () => {
  const now = new Date('2026-11-10T00:00:00Z');
  const post = { slot_key: '2026-11-10T04:00|instagram', scheduled_at: '2026-11-10T04:00:00Z' };
  const auto = { times: ['04:00'], timezone: 'Africa/Casablanca' };
  assert.equal(correctedScheduledAt(post, auto, now), '2026-11-10T03:00:00.000Z');
  assert.equal(correctedScheduledAt({ ...post, scheduled_at: '2026-11-10T03:00:00Z' }, auto, now), null);
  assert.equal(correctedScheduledAt(post, auto, new Date('2026-11-10T05:00:00Z')), null);
  assert.equal(correctedScheduledAt(post, { ...auto, times: ['09:00'] }, now), null);
});
test('malformed AI responses never become public captions', () => {
  for (const raw of ['not JSON', 'null', '[]', '{"caption": {"oops":true}}', '{"caption":" "}']) {
    assert.throws(() => parseCopy(raw, 'Book'));
  }
  const copy = parseCopy('```json\n{"caption":"Try a new page","hashtags":["art","Art"],"pin_description":"' + 'a'.repeat(600) + '"}\n```', 'Book');
  assert.equal(copy.hashtags, '#art');
  assert.equal(copy.pinDescription.length, 480);
});
test('missing video scenes fall through to the next configured writer', async () => {
  const originalFetch = globalThis.fetch;
  const providers = [];
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'gpt-4o-mini' }] });
    providers.push(String(url));
    if (String(url).includes('groq')) return Response.json({ choices: [{ message: { content: '{"caption":"Incomplete"}' } }] });
    return Response.json({ choices: [{ message: { content: JSON.stringify({ caption: 'Start here', scenes: [
      { narration: 'First step', image_prompt: 'A book' }, { narration: 'Second step', image_prompt: 'A page' },
    ] }) } }] });
  };
  try {
    const result = await withUserKeys(null, () => generateCopy(buildPrompts({ theme: 'Book', format: 'video' }), 'Book'), { groq: 'test-video-key', openai: 'test-video-key' });
    assert.equal(result.provider, 'openai');
    assert.equal(result.scenes.length, 2);
    assert.equal(providers.length, 2);
  } finally { globalThis.fetch = originalFetch; }
});
test('one restricted credential cannot poison another credential’s model cache', async () => {
  const originalFetch = globalThis.fetch;
  const originalOverride = process.env.GROQ_MODEL;
  globalThis.fetch = async (_url, options) => Response.json({ data: [{ id: options.headers.Authorization.endsWith('key-a') ? 'llama-3.1-8b' : 'openai/gpt-oss-120b' }] });
  try {
    delete process.env.GROQ_MODEL;
    assert.equal(await withUserKeys(null, () => modelFor('groq'), { groq: 'key-a' }), 'llama-3.1-8b');
    assert.equal(await withUserKeys(null, () => modelFor('groq'), { groq: 'key-b' }), 'openai/gpt-oss-120b');
    process.env.GROQ_MODEL = 'retired-model';
    await withUserKeys(null, () => forgetModel('groq'), { groq: 'key-a' });
    assert.equal((await withUserKeys(null, () => pinnedModel('groq'), { groq: 'key-a' })).rejected, true);
    assert.equal(await withUserKeys(null, () => modelFor('groq'), { groq: 'key-b' }), 'retired-model');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalOverride === undefined) delete process.env.GROQ_MODEL;
    else process.env.GROQ_MODEL = originalOverride;
  }
});
