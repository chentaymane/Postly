'use client';

import { useEffect, useState } from 'react';

const TONES = ['friendly and engaging', 'warm and cozy', 'professional', 'playful', 'luxury / premium', 'bold and energetic'];

export default function CreatePage() {
  const [platforms, setPlatforms] = useState([]);
  const [connected, setConnected] = useState(new Set());
  const [selected, setSelected] = useState(new Set());
  const [form, setForm] = useState({ theme: '', productName: '', description: '', tone: TONES[0], destinationUrl: '' });
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState(null);

  useEffect(() => {
    fetch('/api/connections', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        setPlatforms(d.platforms);
        const conn = new Set(d.connections.map((c) => c.platform));
        setConnected(conn);
        setSelected(new Set(conn)); // pre-select connected ones
      });
  }, []);

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
    const res = await fetch('/api/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, platforms: Array.from(selected) }),
    });
    const json = await res.json();
    setResults(json.results || [{ platform: 'error', ok: false, error: json.error || 'unknown error' }]);
    setSubmitting(false);
  }

  const canSubmit = form.theme.trim() && selected.size > 0 && !submitting;

  return (
    <>
      <div className="page-head">
        <h1>Create Post</h1>
        <p>Describe your product or theme. Postly writes the copy, generates the image, and publishes.</p>
      </div>

      <form className="form" onSubmit={submit}>
        <div className="field">
          <label>Theme or product *</label>
          <input value={form.theme} onChange={(e) => update('theme', e.target.value)}
                 placeholder="e.g. Handmade lavender soy candles" required />
        </div>

        <div className="field">
          <label>Product name (optional)</label>
          <input value={form.productName} onChange={(e) => update('productName', e.target.value)}
                 placeholder="e.g. Lumière Candle" />
        </div>

        <div className="field">
          <label>Extra details (optional)</label>
          <textarea value={form.description} onChange={(e) => update('description', e.target.value)}
                    placeholder="small-batch, eco-friendly, 40-hour burn time…" />
        </div>

        <div className="field">
          <label>Tone</label>
          <select value={form.tone} onChange={(e) => update('tone', e.target.value)}>
            {TONES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        <div className="field">
          <label>Destination URL (optional — used for Pinterest link & CTA)</label>
          <input value={form.destinationUrl} onChange={(e) => update('destinationUrl', e.target.value)}
                 placeholder="https://yourshop.com/product" />
        </div>

        <div className="field">
          <label>Publish to</label>
          <div className="checks">
            {platforms.filter((p) => p.enabled).map((p) => {
              const isConn = connected.has(p.key);
              return (
                <label key={p.key} className={`check ${isConn ? '' : 'disabled'}`}>
                  <input type="checkbox" disabled={!isConn}
                         checked={selected.has(p.key)} onChange={() => toggle(p.key)} />
                  <span>{p.emoji} {p.name}</span>
                </label>
              );
            })}
          </div>
          {connected.size === 0 && <p className="hint">No accounts connected yet. <a href="/">Connect one →</a></p>}
        </div>

        <div>
          <button className="btn btn-accent" disabled={!canSubmit}>
            {submitting ? <><span className="spinner" /> Publishing…</> : 'Generate & Publish'}
          </button>
        </div>
      </form>

      {results && (
        <div className="result">
          <h3>Results</h3>
          {results.map((r, i) => (
            <div key={i}>
              <div className="result-row">
                <span className={`pill ${r.ok ? 'connected' : 'disconnected'}`}>
                  <span className="dot" />{r.ok ? 'Published' : 'Failed'}
                </span>
                <strong style={{ textTransform: 'capitalize' }}>{r.platform}</strong>
                <span className="empty">
                  {r.ok ? (r.post_id ? `#${r.post_id}` : '') : (r.error || '')}
                </span>
              </div>

              {r.preview && (
                <div className="preview">
                  {r.preview.imageUrl && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img className="preview-img" src={r.preview.imageUrl} alt="Generated post image" />
                  )}
                  <div className="preview-copy">
                    {r.preview.pinTitle && r.platform === 'pinterest' && (
                      <p className="preview-title">{r.preview.pinTitle}</p>
                    )}
                    <p>{r.preview.caption}</p>
                    {r.preview.cta && <p className="preview-cta">{r.preview.cta}</p>}
                    <p className="preview-tags">{r.preview.hashtags}</p>
                  </div>
                </div>
              )}
            </div>
          ))}
          <p className="hint" style={{ marginTop: 14 }}>
            Every attempt is logged — see <a href="/history">post history →</a>
          </p>
        </div>
      )}
    </>
  );
}
