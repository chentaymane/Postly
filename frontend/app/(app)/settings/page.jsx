'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

const TONES = ['friendly and engaging', 'warm and cozy', 'professional', 'playful', 'luxury / premium', 'bold and energetic'];
const AUTO_PLATFORMS = ['pinterest', 'instagram', 'facebook', 'tiktok', 'linkedin'];

export default function SettingsPage() {
  const [b, setB] = useState({
    store_name: '', store_url: '', products: '', audience: '', benefits: '',
    default_tone: TONES[0], auto_enabled: false, auto_posts_per_day: 1,
    auto_times: ['10:00'], auto_platforms: [],
  });
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  useEffect(() => {
    fetch('/api/brand', { cache: 'no-store' })
      .then((r) => { if (r.status === 401) { router.push('/login'); return null; } return r.json(); })
      .then((d) => {
        if (!d) return;
        if (d.brand) {
          setB({
            ...d.brand,
            default_tone: d.brand.default_tone || TONES[0],
            auto_times: Array.isArray(d.brand.auto_times) ? d.brand.auto_times : ['10:00'],
            auto_platforms: Array.isArray(d.brand.auto_platforms) ? d.brand.auto_platforms : [],
          });
        }
        setLoading(false);
      });
  }, [router]);

  function set(k, v) { setB((x) => ({ ...x, [k]: v })); setSaved(false); }

  function togglePlatform(p) {
    const s = new Set(b.auto_platforms);
    s.has(p) ? s.delete(p) : s.add(p);
    set('auto_platforms', Array.from(s));
  }

  function setTime(i, v) {
    const t = [...b.auto_times]; t[i] = v; set('auto_times', t);
  }

  function setCount(n) {
    n = Math.min(Math.max(Number(n) || 1, 1), 5);
    let t = [...b.auto_times];
    while (t.length < n) t.push('15:00');
    set('auto_posts_per_day', n);
    setB((x) => ({ ...x, auto_posts_per_day: n, auto_times: t.slice(0, n) }));
  }

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch('/api/brand', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b),
    });
    setBusy(false);
    if (res.ok) setSaved(true);
  }

  if (loading) return <p className="empty">Loading…</p>;

  return (
    <>
      <div className="page-head">
        <h1>Settings</h1>
        <p>Tell the AI about your store so every post is written to sell it — then put posting on autopilot.</p>
      </div>

      {saved && <div className="notice ok">✓ Saved. New posts will use this profile.</div>}

      <form className="form" onSubmit={save} style={{ maxWidth: 720 }}>
        <h2 className="section-title">Your store</h2>
        <div className="field">
          <label>Store name</label>
          <input value={b.store_name || ''} onChange={(e) => set('store_name', e.target.value)}
                 placeholder="e.g. Coloring Haven" />
        </div>
        <div className="field">
          <label>Store link</label>
          <input value={b.store_url || ''} onChange={(e) => set('store_url', e.target.value)}
                 placeholder="https://yourstore.gumroad.com" />
          <p className="hint">Used as the destination for Pins and CTAs.</p>
        </div>
        <div className="field">
          <label>What do you sell?</label>
          <textarea rows={2} value={b.products || ''} onChange={(e) => set('products', e.target.value)}
                    placeholder="e.g. printable coloring books for kids and adults" />
        </div>
        <div className="field">
          <label>Who buys it?</label>
          <textarea rows={2} value={b.audience || ''} onChange={(e) => set('audience', e.target.value)}
                    placeholder="e.g. parents of kids 3-10, teachers, mindfulness fans" />
        </div>
        <div className="field">
          <label>Why do they buy it? (benefits)</label>
          <textarea rows={3} value={b.benefits || ''} onChange={(e) => set('benefits', e.target.value)}
                    placeholder="e.g. screen-free calm activity, builds focus and creativity, instant download" />
        </div>
        <div className="field">
          <label>Default tone</label>
          <select value={b.default_tone || TONES[0]} onChange={(e) => set('default_tone', e.target.value)}>
            {TONES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        <h2 className="section-title">Autopilot</h2>
        <label className="check" style={{ maxWidth: 'fit-content' }}>
          <input type="checkbox" checked={!!b.auto_enabled}
                 onChange={(e) => set('auto_enabled', e.target.checked)} />
          <span>Post automatically every day</span>
        </label>

        {b.auto_enabled && (
          <>
            <div className="field">
              <label>Posts per day</label>
              <select value={b.auto_posts_per_day} onChange={(e) => setCount(e.target.value)}>
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Posting hours (0–23, UTC)</label>
              <div className="times-row">
                {b.auto_times.slice(0, b.auto_posts_per_day).map((t, i) => (
                  <select key={i} value={t} onChange={(e) => setTime(i, e.target.value)}>
                    {Array.from({ length: 24 }, (_, h) => {
                      const v = `${String(h).padStart(2, '0')}:00`;
                      return <option key={v} value={v}>{String(h).padStart(2, '0')}:00</option>;
                    })}
                  </select>
                ))}
              </div>
              <p className="hint">Posts are generated once a day and scheduled at these hours.</p>
            </div>
            <div className="field">
              <label>Platforms</label>
              <div className="checks">
                {AUTO_PLATFORMS.map((p) => (
                  <label key={p} className="check">
                    <input type="checkbox" checked={b.auto_platforms.includes(p)}
                           onChange={() => togglePlatform(p)} />
                    <span style={{ textTransform: 'capitalize' }}>{p}</span>
                  </label>
                ))}
              </div>
              <p className="hint">Only connected accounts are posted to.</p>
            </div>
          </>
        )}

        <div>
          <button className="btn btn-accent" disabled={busy}>
            {busy ? <span className="spinner" /> : 'Save settings'}
          </button>
        </div>
      </form>
    </>
  );
}
