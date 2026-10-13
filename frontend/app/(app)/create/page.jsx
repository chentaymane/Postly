'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PlatformIcon } from '../../../components/BrandIcons';
import { RECIPES } from '../../../lib/recipes';

const TONES = [
  'friendly and engaging',
  'warm and cozy',
  'professional',
  'playful',
  'luxury / premium',
  'bold and energetic',
];

export default function CreatePage() {
  const router = useRouter();
  const [platforms, setPlatforms] = useState([]);
  const [connected, setConnected] = useState(new Set());
  const [selected, setSelected] = useState(new Set());
  const [form, setForm] = useState({
    theme: '', productName: '', description: '', tone: TONES[0], destinationUrl: '',
  });
  const [postType, setPostType] = useState('promo');
  const [format, setFormat] = useState('single');
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateSaved, setTemplateSaved] = useState(false);
  // A post about one product is designed from its own pictures — the default
  // when there are products, since that is what sells.
  const [products, setProducts] = useState([]);
  const [productId, setProductId] = useState('');
  const [recipe, setRecipe] = useState('');

  useEffect(() => {
    fetch('/api/connections', { cache: 'no-store' })
      .then((r) => (r.status === 401 ? (router.push('/login'), null) : r.json()))
      .then((d) => {
        if (!d) return;
        setPlatforms(d.platforms);
        const conn = new Set(d.connections.map((c) => c.platform));
        setConnected(conn);
        setSelected(conn);
      });
    fetch('/api/templates', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setTemplates(d.templates || []));
    fetch('/api/products', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const list = (d?.products || []).filter((p) => p.enabled);
        setProducts(list);
        if (list[0]) setProductId(String(list[0].id));
      });
  }, []);

  function loadTemplate(id) {
    const t = templates.find((x) => String(x.id) === String(id));
    if (!t) return;
    setForm({
      theme: t.theme || '',
      productName: t.product_name || '',
      description: t.description || '',
      tone: t.tone || TONES[0],
      destinationUrl: t.destination_url || '',
    });
    const tplPlatforms = Array.isArray(t.platforms) ? t.platforms : [];
    if (tplPlatforms.length) setSelected(new Set(tplPlatforms.filter((p) => connected.has(p))));
  }

  async function saveTemplate() {
    const name = prompt('Template name:', form.productName || form.theme.slice(0, 40));
    if (!name) return;
    setSavingTemplate(true);
    const res = await fetch('/api/templates', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, ...form, platforms: Array.from(selected) }),
    });
    if (res.ok) {
      const { template } = await res.json();
      setTemplates((ts) => [template, ...ts]);
      setTemplateSaved(true);
      setTimeout(() => setTemplateSaved(false), 2500);
    }
    setSavingTemplate(false);
  }

  function toggle(key) {
    const next = new Set(selected);
    next.has(key) ? next.delete(key) : next.add(key);
    setSelected(next);
  }
  function update(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function submit(e) {
    e.preventDefault();
    setSubmitting(true);
    setResults(null);
    // Generates drafts into the review queue — nothing publishes yet.
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form, postType, format, platforms: Array.from(selected),
        ...(productId ? { product_id: Number(productId), recipe: recipe || undefined } : {}),
      }),
    });
    if (res.status === 401) { router.push('/login'); return; }
    const json = await res.json();
    const drafts = json.drafts || [];
    const failures = drafts.filter((d) => !d.ok);
    if (drafts.length > 0 && failures.length === 0) {
      // Drafts wait under "Needs you", opened on the first one so the next
      // step — read it, approve it — is already on screen.
      const first = drafts.find((d) => d.draft?.id)?.draft.id;
      router.push(`/schedule?tab=review${first ? `&post=${first}` : ''}`);
      return;
    }
    setResults(
      failures.length
        ? failures.map((f) => ({ platform: f.platform, ok: false, error: f.error }))
        : [{ platform: 'error', ok: false, error: json.error || 'generation failed' }]
    );
    setSubmitting(false);
  }

  const product = products.find((p) => String(p.id) === String(productId)) || null;
  const canSubmit = (product || form.theme.trim()) && selected.size > 0 && !submitting;
  const firstPreview = results?.find((r) => r.preview)?.preview;
  const previewPlatform = results?.find((r) => r.preview)?.platform;

  return (
    <>
      <div className="page-head">
        <h1>Create a post</h1>
        <p>
          Pick a product and Postly writes the post and designs the slides from its own
          pictures — or describe anything else. Nothing goes out yet: the draft waits in
          Schedule for you to read and approve.
        </p>
      </div>

      <div className="create-grid">
        {/* ---------------- form ---------------- */}
        <div className="panel">
          <p className="panel-title">Post details</p>

          {templates.length > 0 && (
            <div className="field" style={{ marginBottom: 18 }}>
              <label htmlFor="template">Start from a saved template</label>
              <div className="template-row">
                <select id="template" value="" onChange={(e) => loadTemplate(e.target.value)}>
                  <option value="">Choose a template…</option>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            </div>
          )}

          <form className="form" onSubmit={submit}>
            {products.length > 0 && (
              <div className="field">
                <label htmlFor="product">What is it about?</label>
                <select id="product" value={productId} onChange={(e) => setProductId(e.target.value)}>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}{p.price ? ` — ${p.price}` : ''}</option>
                  ))}
                  <option value="">Something else — I'll describe it</option>
                </select>
                {product && (
                  <div className="create-product">
                    {product.image_url && (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={product.image_url} alt="" />
                    )}
                    <span>
                      <strong>{product.name}</strong>
                      <span className="hint" style={{ display: 'block', marginTop: 2 }}>
                        {[product.price, product.facts].filter(Boolean).join(' · ') || 'From your Products page'}
                      </span>
                    </span>
                  </div>
                )}
              </div>
            )}

            {product && (
              <div className="field">
                <label htmlFor="recipe">Angle</label>
                <select id="recipe" value={recipe} onChange={(e) => setRecipe(e.target.value)}>
                  <option value="">Surprise me — pick one that fits</option>
                  {Object.entries(RECIPES).map(([key, r]) => (
                    <option key={key} value={key}>{r.label}</option>
                  ))}
                </select>
                <p className="hint">The creative frame around the product. Every angle still sells this exact product.</p>
              </div>
            )}

            <div className="field">
              <label>What kind of post?</label>
              <div className="checks">
                {[
                  ['promo', 'Promote product'],
                  ['tips', 'Tips & advice'],
                  ['engage', 'Fun & engage'],
                ].map(([val, label]) => (
                  <label key={val} className={`check${postType === val ? ' selected' : ''}`}>
                    <input type="radio" name="postType" value={val}
                           checked={postType === val} onChange={() => setPostType(val)} />
                    {label}
                  </label>
                ))}
              </div>
              <p className="hint">
                {postType === 'promo' && 'Copy written to sell — outcome-focused with a buy CTA.'}
                {postType === 'tips' && 'A genuinely useful advice post (e.g. baby & parenting tips) that builds trust.'}
                {postType === 'engage' && 'Relatable and fun — written to get comments and shares.'}
              </p>
            </div>

            <div className="field">
              <label>Format</label>
              <div className="checks">
                {[
                  ['single', 'Single image'],
                  ['carousel', 'Story carousel'],
                  ['video', 'Narrated video'],
                ].map(([val, label]) => (
                  <label key={val} className={`check${format === val ? ' selected' : ''}`}>
                    <input type="radio" name="format" value={val}
                           checked={format === val} onChange={() => setFormat(val)} />
                    {label}
                  </label>
                ))}
              </div>
              {format === 'carousel' && (
                <p className="hint">
                  {product
                    ? 'Up to 4 designed slides: the product, its cover, why it is worth it, and how to get it.'
                    : '3–4 slides telling one story. Publishes as a swipeable carousel on Instagram, Facebook and Pinterest.'}
                </p>
              )}
              {format === 'video' && (
                <p className="hint">
                  A vertical short: the AI writes a 5–6 scene script, generates the artwork, and your
                  local render worker voices it with Piper and edits it with FFmpeg. The draft appears
                  under Review as <em>Rendering…</em> and becomes publishable once the video is ready.
                </p>
              )}
            </div>

            {!product && (<>
            <div className="field">
              <label htmlFor="theme">Theme or product *</label>
              <input id="theme" required value={form.theme}
                     onChange={(e) => update('theme', e.target.value)}
                     placeholder="Handmade lavender soy candles" />
            </div>

            <div className="field">
              <label htmlFor="productName">Product name</label>
              <input id="productName" value={form.productName}
                     onChange={(e) => update('productName', e.target.value)}
                     placeholder="Lumière Candle" />
            </div>

            <div className="field">
              <label htmlFor="description">Extra details</label>
              <textarea id="description" value={form.description}
                        onChange={(e) => update('description', e.target.value)}
                        placeholder="Small-batch, eco-friendly, 40-hour burn time…" />
            </div>

            <div className="field">
              <label htmlFor="tone">Tone of voice</label>
              <select id="tone" value={form.tone} onChange={(e) => update('tone', e.target.value)}>
                {TONES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            <div className="field">
              <label htmlFor="destinationUrl">Destination link</label>
              <input id="destinationUrl" type="url" value={form.destinationUrl}
                     onChange={(e) => update('destinationUrl', e.target.value)}
                     placeholder="https://yourshop.com/product" />
              <p className="hint">Used for the Pinterest Pin link and the call to action.</p>
            </div>
            </>)}

            {product && (
              <div className="field">
                <label htmlFor="tone">Tone of voice</label>
                <select id="tone" value={form.tone} onChange={(e) => update('tone', e.target.value)}>
                  {TONES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            )}

            <div className="field">
              <label>Publish to</label>
              <div className="checks">
                {platforms.filter((p) => p.enabled).map((p) => {
                  const isConn = connected.has(p.key);
                  const isSel = selected.has(p.key);
                  return (
                    <label key={p.key}
                           className={`check${isSel ? ' selected' : ''}${isConn ? '' : ' disabled'}`}>
                      <input type="checkbox" disabled={!isConn} checked={isSel}
                             onChange={() => toggle(p.key)} />
                      <span style={{ color: isSel ? undefined : p.color, display: 'inline-flex' }}>
                        <PlatformIcon platform={p.key} size={17} />
                      </span>
                      {p.name}
                    </label>
                  );
                })}
              </div>
              {connected.size === 0 && (
                <p className="hint">No accounts connected yet. <a href="/connections">Connect one →</a></p>
              )}
            </div>

            <button className="btn btn-accent btn-lg btn-block" disabled={!canSubmit}>
              {submitting ? <><span className="spinner" /> Generating…</> : 'Generate for review'}
            </button>

            <button type="button" className="btn btn-outline btn-block" disabled={!form.theme.trim() || savingTemplate}
                    onClick={saveTemplate}>
              {savingTemplate ? <span className="spinner" /> : templateSaved ? 'Saved ✓' : 'Save as template'}
            </button>
          </form>
        </div>

        {/* ---------------- preview / results ---------------- */}
        <div className="preview-sticky">
          <div className="panel">
            <p className="panel-title">{results ? 'Results' : 'Preview'}</p>

            {!results && (
              <>
                {form.theme.trim() ? (
                  <div className="mock">
                    <div className="mock-head">
                      <span className="mock-avatar" />
                      <div>
                        <div className="mock-name">{form.productName || 'Your brand'}</div>
                        <div className="mock-meta">Sponsored · just now</div>
                      </div>
                    </div>
                    <div className="mock-img placeholder-preview"
                         style={{ display: 'grid', placeItems: 'center', color: 'var(--text-dim)', fontSize: 13 }}>
                      Image will be generated
                    </div>
                    <div className="mock-body">
                      <p style={{ color: 'var(--text-dim)' }}>
                        AI copy for “{form.theme}” in a {form.tone} tone will appear here.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="placeholder-box">
                    Enter a theme to see a preview of your post.
                  </div>
                )}
              </>
            )}

            {results && (
              <>
                {results.map((r, i) => (
                  <div className="result-item" key={i}>
                    <div className="result-head">
                      <span className={`pill ${r.ok ? 'connected' : 'failed'}`}>
                        <span className="dot" />{r.ok ? 'Published' : 'Failed'}
                      </span>
                      <span className="result-platform">
                        <PlatformIcon platform={r.platform} size={15} /> {r.platform}
                      </span>
                    </div>
                    {(r.post_id || r.error) && (
                      <p className="result-detail" style={{ marginTop: 8, marginBottom: 0 }}>
                        {r.ok ? `Post ID: ${r.post_id}` : r.error}
                      </p>
                    )}
                  </div>
                ))}

                {firstPreview && (
                  <div className="mock" style={{ marginTop: 16 }}>
                    <div className="mock-head">
                      <span className="mock-avatar" />
                      <div>
                        <div className="mock-name">{form.productName || 'Your brand'}</div>
                        <div className="mock-meta">
                          {previewPlatform} · {firstPreview.provider}
                        </div>
                      </div>
                    </div>
                    {firstPreview.imageUrl && (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img className={`mock-img${previewPlatform === 'pinterest' ? ' tall' : ''}`}
                           src={firstPreview.imageUrl} alt="Generated post image" />
                    )}
                    <div className="mock-body">
                      {previewPlatform === 'pinterest' && firstPreview.pinTitle && (
                        <p className="mock-title">{firstPreview.pinTitle}</p>
                      )}
                      <p>{firstPreview.caption}</p>
                      {firstPreview.cta && <p className="mock-cta">{firstPreview.cta}</p>}
                      <p className="mock-tags">{firstPreview.hashtags}</p>
                    </div>
                  </div>
                )}

                <p className="hint" style={{ marginTop: 14 }}>
                  Every attempt is logged — <a href="/history">view history →</a>
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
