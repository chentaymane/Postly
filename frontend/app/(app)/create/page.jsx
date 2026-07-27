'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PlatformIcon } from '../../../components/BrandIcons';

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
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateSaved, setTemplateSaved] = useState(false);

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
      body: JSON.stringify({ ...form, platforms: Array.from(selected) }),
    });
    if (res.status === 401) { router.push('/login'); return; }
    const json = await res.json();
    const drafts = json.drafts || [];
    const failures = drafts.filter((d) => !d.ok);
    if (drafts.length > 0 && failures.length === 0) {
      router.push('/review');
      return;
    }
    setResults(
      failures.length
        ? failures.map((f) => ({ platform: f.platform, ok: false, error: f.error }))
        : [{ platform: 'error', ok: false, error: json.error || 'generation failed' }]
    );
    setSubmitting(false);
  }

  const canSubmit = form.theme.trim() && selected.size > 0 && !submitting;
  const firstPreview = results?.find((r) => r.preview)?.preview;
  const previewPlatform = results?.find((r) => r.preview)?.platform;

  return (
    <>
      <div className="page-head">
        <h1>Create Post</h1>
        <p>Describe your product or theme — Postly writes the copy, generates the image, and publishes it.</p>
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
                <p className="hint">No accounts connected yet. <a href="/">Connect one →</a></p>
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
