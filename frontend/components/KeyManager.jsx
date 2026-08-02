'use client';

import { useEffect, useState, useCallback } from 'react';

// Shared by the Settings page and the onboarding wizard, so there is exactly
// one implementation of "add and check an API key".
export default function KeyManager({ compact = false, filter = null, onChange }) {
  const [kinds, setKinds] = useState([]);
  const [creds, setCreds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(null);     // which kind's form is showing
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/credentials', { cache: 'no-store' });
    if (!res.ok) { setLoading(false); return; }
    const d = await res.json();
    setKinds(d.kinds || []);
    setCreds(d.credentials || []);
    setLoading(false);
    onChange?.(d.credentials || []);
  }, [onChange]);

  useEffect(() => { load(); }, [load]);

  async function add(kind) {
    setBusy(kind); setError(null); setNote(null);
    const res = await fetch('/api/credentials', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, secret }),
    });
    const json = await res.json();
    setBusy(null);
    if (!res.ok) { setError(json.error || 'could not save that key'); return; }
    setSecret(''); setOpen(null); setNote('Key verified and saved.');
    load();
  }

  async function recheck(id) {
    setBusy(`check-${id}`); setError(null); setNote(null);
    const res = await fetch(`/api/credentials/${id}`, { method: 'POST' });
    const json = await res.json();
    setBusy(null);
    setNote(json.ok ? 'Key is working.' : null);
    if (!json.ok) setError(json.error || 'key check failed');
    load();
  }

  async function remove(id) {
    if (!confirm('Delete this key? Accounts connected with it will stop publishing.')) return;
    setBusy(`del-${id}`);
    const res = await fetch(`/api/credentials/${id}`, { method: 'DELETE' });
    const json = await res.json().catch(() => ({}));
    setBusy(null);
    if (json.connectionsAffected > 0) {
      setNote(`Key deleted. ${json.connectionsAffected} connected account(s) will need reconnecting.`);
    }
    load();
  }

  const shown = filter ? kinds.filter((k) => filter.includes(k.kind)) : kinds;
  if (loading) return <div className="skeleton" style={{ height: 160 }} />;

  return (
    <div className="keys">
      {error && <div className="notice err">{error}</div>}
      {note && <div className="notice ok">{note}</div>}

      {shown.map((k) => {
        const mine = creds.filter((c) => c.kind === k.kind);
        const totalAccounts = mine.reduce((s, c) => s + c.accounts, 0);
        const capacity = k.accountsPerKey ? mine.length * k.accountsPerKey : null;
        const full = capacity !== null && totalAccounts >= capacity && mine.length > 0;

        return (
          <div className="key-card" key={k.kind}>
            <div className="key-head">
              <div>
                <p className="key-name">
                  {k.label}
                  <span className={`pill ${mine.length ? 'connected' : 'disconnected'}`}>
                    <span className="dot" />
                    {mine.length ? `${mine.length} key${mine.length > 1 ? 's' : ''}` : 'not set'}
                  </span>
                </p>
                <p className="key-blurb">{k.blurb}</p>
              </div>
              <a className="btn btn-ghost" href={k.signupUrl} target="_blank" rel="noreferrer">
                Get a key ↗
              </a>
            </div>

            {mine.length > 0 && (
              <div className="key-list">
                {mine.map((c) => (
                  <div className="key-row" key={c.id}>
                    <code className="key-hint">{c.hint}</code>
                    <span className={`pill ${c.status === 'ok' ? 'connected' : c.status === 'invalid' ? 'failed' : 'disconnected'}`}>
                      <span className="dot" />{c.status === 'ok' ? 'working' : c.status}
                    </span>
                    {k.accountsPerKey && (
                      <span className="key-cap">
                        {c.accounts}/{k.accountsPerKey} accounts
                      </span>
                    )}
                    <span className="key-actions">
                      <button className="link-btn" disabled={busy === `check-${c.id}`}
                              onClick={() => recheck(c.id)}>
                        {busy === `check-${c.id}` ? 'checking…' : 'check'}
                      </button>
                      <button className="link-btn danger" disabled={busy === `del-${c.id}`}
                              onClick={() => remove(c.id)}>delete</button>
                    </span>
                  </div>
                ))}
              </div>
            )}

            {full && (
              <p className="hint">
                All {k.label} keys are at their {k.accountsPerKey}-account limit. Add another
                key to connect more accounts.
              </p>
            )}

            {open === k.kind ? (
              <div className="key-form">
                <label className="sr-only" htmlFor={`k-${k.kind}`}>{k.label} API key</label>
                <input id={`k-${k.kind}`} type="password" autoComplete="off"
                       placeholder={k.placeholder} value={secret}
                       onChange={(e) => setSecret(e.target.value)} />
                <button className="btn btn-accent" disabled={!secret.trim() || busy === k.kind}
                        onClick={() => add(k.kind)}>
                  {busy === k.kind ? <><span className="spinner" /> Verifying…</> : 'Save key'}
                </button>
                <button className="btn btn-ghost"
                        onClick={() => { setOpen(null); setSecret(''); setError(null); }}>
                  Cancel
                </button>
              </div>
            ) : (
              <button className={`btn ${mine.length ? 'btn-outline' : 'btn-accent'}${compact ? '' : ''}`}
                      onClick={() => { setOpen(k.kind); setSecret(''); setError(null); }}>
                {mine.length ? `Add another ${k.label} key` : `Add ${k.label} key`}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
