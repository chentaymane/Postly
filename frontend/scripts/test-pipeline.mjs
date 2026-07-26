// Smoke-test copy + image generation (no DB, no publishing).
import { readFileSync } from 'node:fs';
for (const line of readFileSync('.env.local','utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const { buildPrompts, generateCopy, generateImage, IMAGE_DIMS } = await import('../lib/pipeline.js');

const input = { theme:'handmade lavender soy candles', productName:'Lumiere Candle',
  description:'small-batch, eco-friendly', tone:'warm and cozy' };
const prompts = buildPrompts({ ...input, forPinterest:true });
console.log('subject:', prompts.subject);

const t0 = Date.now();
const copy = await generateCopy(prompts, prompts.subject);
console.log(`\ncopy via ${copy.provider} in ${Date.now()-t0}ms`);
console.log('  caption :', copy.caption);
console.log('  hashtags:', copy.hashtags);
console.log('  cta     :', copy.cta);
console.log('  pinTitle:', copy.pinTitle);
console.log('  pinDesc :', copy.pinDescription.slice(0,90)+'...');

const t1 = Date.now();
const img = await generateImage(prompts.imagePrompt, IMAGE_DIMS.pinterest);
console.log(`\nimage (${img.model}) in ${Date.now()-t1}ms bytes=${img.bytes} warmError=${img.warmError||'none'}`);
console.log('  url:', img.imageUrl.slice(0,110)+'...');
