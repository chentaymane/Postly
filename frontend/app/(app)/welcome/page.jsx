'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import KeyManager from '../../../components/KeyManager';
import { PlatformIcon } from '../../../components/BrandIcons';

const PLATFORM_COLORS = {
  pinterest: '#E60023', instagram: '#E4405F', facebook: '#1877F2',
  x: '#000000', linkedin: '#0A66C2', tiktok: '#010101',
};

const STEPS = [
  { key: 'writer', title: 'Add a writer', blurb: 'The AI that writes your captions.' },
  { key: 'connector', title: 'Add a connector', blurb: 'Lets you link your social accounts.' },
  { key: 'accounts', title: 'Connect accounts', blurb: 'Link the profiles you post to.' },
  { key: 'brand', title: 'Describe your store', blurb: 'So the writing sells your product.' },
];

export default function WelcomePage() {
  const [step, setStep] = useState(0);
  const [creds, setCreds] = useState([]);
  const [conns, setConns] = useState([]);
  const [platforms, setPlatforms] = useState([]);
  const [brand, setBrand] = useState({ store_name: '', store_url: '', products: '', audience: '', benefits: '' });
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  async function refresh() {
    const [c, k] = await Promise.all([
      fetch('/api/connections', { cache: 'no-store' }),
      fetch('/api/credentials', { cache: 'no-store' }),
    ]);
    if (c.status === 401) { router.push('/login'); return; }
    const cj = await c.json();
    const kj = await k.json();
    setConns(cj.connections || []);
    setPlatforms(cj.platforms || []);
    setCreds(kj.credentials || []);
  }

  useEffect(() => {
    refresh();
    fetch('/api/brand', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.brand && setBrand((b) => ({ ...b, ...d.brand })));
  }, []);

  const hasWriter = creds.some((c) => ['groq', 'openai', 'gemini', 'anthropic'].includes(c.kind));
  const hasConnector = creds.some((c) => ['zernio', 'socialapi'].includes(c.kind));
  const hasAccount = conns.length > 0;
  const done = [hasWriter, hasConnector, hasAccount, Boolean(brand.store_name)];

  async function saveBrand() {
    setSaving(true);
    await fetch('/api/brand', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(brand),
    });
    setSaving(false);
    router.push('/dashboard');
  }

  return (
    <div className="wizard">
      <div className="page-head">
        <h1>Welcome to Postly</h1>
        <p>Four short steps and your store starts posting itself. You can change all of this later.</p>
      </div>

      <ol className="stepper">
        {STEPS.map((s, i) => (
          <li key={s.key} className={`step${i === step ? ' current' : ''}${done[i] ? ' done' : ''}`}>
            <button className="step-btn" onClick={() => setStep(i)}>
              <span className="step-num">{done[i] ? '✓' : i + 1}</span>
              <span>
                <span className="step-title">{s.title}</span>
                <span className="step-blurb">{s.blurb}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>

      <section className="panel wizard-panel">
        {step === 0 && (
          <>
            <p className="panel-title">Step 1 — the writer</p>
            <p className="hint" style={{ marginTop: 0 }}>
              Postly uses your own AI key, so your usage is yours. <strong>Groq is free</strong> and
              takes about a minute to sign up for.
            </p>
            <KeyManager filter={['groq', 'openai', 'gemini', 'anthropic']} onChange={setCreds} />
            <div className="wizard-nav">
              <button className="btn btn-accent" disabled={!hasWriter} onClick={() => setStep(1)}>
                Continue
              </button>
              {!hasWriter && <span className="hint">Add a key to continue.</span>}
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <p className="panel-title">Step 2 — the connector</p>
            <p className="hint" style={{ marginTop: 0 }}>
              This is what links your social profiles. <strong>Zernio</strong> covers Pinterest,
              Instagram, TikTok, Facebook, LinkedIn, Threads and YouTube, and its free tier
              includes two connected accounts per key.
            </p>
            <KeyManager filter={['zernio', 'socialapi']} onChange={setCreds} />
            <div className="wizard-nav">
              <button className="btn btn-outline" onClick={() => setStep(0)}>Back</button>
              <button className="btn btn-accent" disabled={!hasConnector}
                      onClick={() => { refresh(); setStep(2); }}>
                Continue
              </button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <p className="panel-title">Step 3 — connect your accounts</p>
            <p className="hint" style={{ marginTop: 0 }}>
              One click each. You approve on the platform&apos;s own page — Postly never sees
              your password.
            </p>
            <div className="grid">
              {platforms.filter((p) => p.enabled && p.configured).map((p) => {
                const linked = conns.find((c) => c.platform === p.key);
                return (
                  <div className="card" key={p.key}>
                    <div className="card-head">
                      <span className="platform-icon" style={{ background: p.color }}>
                        <PlatformIcon platform={p.key} size={22} />
                      </span>
                      <div>
                        <p className="card-title">{p.name}</p>
                        {linked
                          ? <span className="pill connected"><span className="dot" />@{linked.account_name}</span>
                          : <span className="pill disconnected"><span className="dot" />not connected</span>}
                      </div>
                    </div>
                    <div className="card-foot">
                      <a className={`btn ${linked ? 'btn-outline' : 'btn-accent'} btn-block`}
                         href={p.connectPath}>
                        {linked ? 'Reconnect' : 'Connect'}
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="wizard-nav">
              <button className="btn btn-outline" onClick={() => setStep(1)}>Back</button>
              <button className="btn btn-accent" onClick={() => setStep(3)}>
                {hasAccount ? 'Continue' : 'Skip for now'}
              </button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <p className="panel-title">Step 4 — your store</p>
            <p className="hint" style={{ marginTop: 0 }}>
              This is what turns generic captions into copy that sells <em>your</em> product.
            </p>
            <div className="form">
              <div className="field">
                <label htmlFor="sn">Store name</label>
                <input id="sn" value={brand.store_name || ''}
                       onChange={(e) => setBrand({ ...brand, store_name: e.target.value })}
                       placeholder="Coloring Haven" />
              </div>
              <div className="field">
                <label htmlFor="su">Store link</label>
                <input id="su" value={brand.store_url || ''}
                       onChange={(e) => setBrand({ ...brand, store_url: e.target.value })}
                       placeholder="https://yourstore.com" />
              </div>
              <div className="field">
                <label htmlFor="pr">What do you sell?</label>
                <textarea id="pr" rows={2} value={brand.products || ''}
                          onChange={(e) => setBrand({ ...brand, products: e.target.value })}
                          placeholder="printable coloring books for kids" />
              </div>
              <div className="field">
                <label htmlFor="au">Who buys it?</label>
                <textarea id="au" rows={2} value={brand.audience || ''}
                          onChange={(e) => setBrand({ ...brand, audience: e.target.value })}
                          placeholder="parents of kids 3-10, teachers" />
              </div>
              <div className="field">
                <label htmlFor="be">Why do they buy it?</label>
                <textarea id="be" rows={2} value={brand.benefits || ''}
                          onChange={(e) => setBrand({ ...brand, benefits: e.target.value })}
                          placeholder="screen-free calm activity, instant download" />
              </div>
            </div>
            <div className="wizard-nav">
              <button className="btn btn-outline" onClick={() => setStep(2)}>Back</button>
              <button className="btn btn-accent" disabled={saving} onClick={saveBrand}>
                {saving ? <span className="spinner" /> : 'Finish setup'}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
