'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

const TONES = [
  'friendly and engaging', 'warm and cozy', 'professional',
  'playful', 'luxury / premium', 'bold and energetic',
];

const LANGUAGES = [
  'English', 'French', 'Spanish', 'German', 'Italian', 'Portuguese',
  'Arabic', 'Dutch', 'Polish', 'Turkish', 'Japanese',
];

const PROMPT_PLACEHOLDER =
  'Anything the AI should always do, or never do. For example:\n' +
  'Never mention discounts or sales.\n' +
  'Always say "instant download", never "shipping".\n' +
  'We are based in Casablanca — mention it when it fits.\n' +
  'Never describe the faces of children.';

const EMPTY = {
  store_name: '', store_url: '', products: '', audience: '', benefits: '',
  default_tone: TONES[0], niche: '', custom_prompt: '', banned_words: '',
  language: 'English', auto_enabled: false, auto_posts_per_day: 1,
  auto_times: ['10:00'], auto_platforms: [],
};

export default function SettingsPage() {
  const [b, setB] = useState(EMPTY);
  const [niches, setNiches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  useEffect(() => {
    fetch('/api/brand', { cache: 'no-store' })
      .then((r) => { if (r.status === 401) { router.push('/login'); return null; } return r.json(); })
      .then((d) => {
        if (!d) return;
        setNiches(d.niches || []);
        if (d.brand) {
          setB({
            ...EMPTY,
            ...d.brand,
            default_tone: d.brand.default_tone || TONES[0],
            language: d.brand.language || 'English',
            auto_times: Array.isArray(d.brand.auto_times) ? d.brand.auto_times : ['10:00'],
            auto_platforms: Array.isArray(d.brand.auto_platforms) ? d.brand.auto_platforms : [],
          });
        }
        setLoading(false);
      });
  }, [router]);

  function set(k, v) { setB((x) => ({ ...x, [k]: v })); setSaved(false); }

  async function save(e, applyPreset = false) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch('/api/brand', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...b, apply_preset: applyPreset }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) {
      // The server decides what a preset actually filled in, so the form is
      // refreshed from its answer rather than from what we hoped it would do.
      if (json.brand) setB({ ...EMPTY, ...json.brand });
      setSaved(true);
    }
  }

  const chosen = niches.find((n) => n.id === b.niche);

  if (loading) {
    return (
      <>
        <div className="page-head"><h1>Brand</h1></div>
        <div className="skeleton" style={{ height: 320 }} />
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <h1>Brand</h1>
        <p>
          Everything here goes into every post Postly writes. The more specific it is, the less
          the copy reads like it could belong to anyone.
        </p>
      </div>

      {saved && (
        <div className="notice ok">
          <span className="notice-body">Saved. New posts use this straight away.</span>
        </div>
      )}

      <form className="form" onSubmit={(e) => save(e)} style={{ maxWidth: 760 }}>
        <h2 className="section-title">What kind of business is this?</h2>
        <div className="field">
          <label htmlFor="niche">Business type</label>
          <select id="niche" value={b.niche || ''} onChange={(e) => set('niche', e.target.value)}>
            <option value="">Choose one…</option>
            {niches.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
          </select>
          {chosen && <p className="hint">{chosen.blurb}</p>}
          {b.niche && b.niche !== 'custom' && (
            <p className="hint">
              <button type="button" className="link-btn" disabled={busy}
                      onClick={(e) => save(e, true)}>
                Fill the empty fields below from this preset
              </button>
              {' '}— anything you have already written is left alone.
            </p>
          )}
        </div>

        <h2 className="section-title">Your business</h2>
        <div className="field">
          <label htmlFor="sn">Name</label>
          <input id="sn" value={b.store_name || ''}
                 onChange={(e) => set('store_name', e.target.value)}
                 placeholder="What you are called" />
        </div>
        <div className="field">
          <label htmlFor="su">Link</label>
          <input id="su" value={b.store_url || ''}
                 onChange={(e) => set('store_url', e.target.value)}
                 placeholder="https://…" />
          <p className="hint">The destination for pins and calls to action.</p>
        </div>
        <div className="field">
          <label htmlFor="pr">What do you sell or offer?</label>
          <textarea id="pr" rows={2} value={b.products || ''}
                    onChange={(e) => set('products', e.target.value)}
                    placeholder="Be concrete — the AI writes about exactly this" />
        </div>
        <div className="field">
          <label htmlFor="au">Who is it for?</label>
          <textarea id="au" rows={2} value={b.audience || ''}
                    onChange={(e) => set('audience', e.target.value)}
                    placeholder="The person who should stop scrolling" />
        </div>
        <div className="field">
          <label htmlFor="bf">Why do they choose you?</label>
          <textarea id="bf" rows={3} value={b.benefits || ''}
                    onChange={(e) => set('benefits', e.target.value)}
                    placeholder="The reasons a customer would give, in their own words" />
        </div>

        <h2 className="section-title">Voice</h2>
        <div className="field-row">
          <div className="field">
            <label htmlFor="tn">Default tone</label>
            <select id="tn" value={b.default_tone || TONES[0]}
                    onChange={(e) => set('default_tone', e.target.value)}>
              {TONES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="lg">Language</label>
            <select id="lg" value={b.language || 'English'}
                    onChange={(e) => set('language', e.target.value)}>
              {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
            <p className="hint">Captions, hashtags and titles are all written in this.</p>
          </div>
        </div>

        <div className="field">
          <label htmlFor="cp">Your own rules for every post</label>
          <textarea id="cp" rows={6} value={b.custom_prompt || ''}
                    onChange={(e) => set('custom_prompt', e.target.value)}
                    placeholder={PROMPT_PLACEHOLDER} />
          <p className="hint">
            These outrank Postly&apos;s built-in writing rules, so put anything non-negotiable
            here. Each automation can add rules of its own on top of these.
          </p>
        </div>

        <div className="field">
          <label htmlFor="bw">Words to never use</label>
          <input id="bw" value={b.banned_words || ''}
                 onChange={(e) => set('banned_words', e.target.value)}
                 placeholder="cheap, sale, discount, hurry" />
          <p className="hint">Comma separated.</p>
        </div>

        <h2 className="section-title">Posting schedule</h2>
        <p className="hint" style={{ marginTop: 0 }}>
          Scheduling lives in <a href="/automations">Automations</a>, where each rule has its own
          content type, format, platforms, hours and extra instructions.
        </p>
        <div><a className="btn btn-outline" href="/automations">Open Automations</a></div>

        <div>
          <button className="btn btn-accent" disabled={busy}>
            {busy ? <span className="spinner" /> : 'Save brand'}
          </button>
        </div>
      </form>
    </>
  );
}
