'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { PlatformIcon } from '../../../components/BrandIcons';

const PLATFORM_COLORS = {
  pinterest: '#E60023', instagram: '#E4405F', facebook: '#1877F2',
  x: '#000000', linkedin: '#0A66C2', tiktok: '#010101',
};

const POST_TYPES = [
  ['mixed', 'Mixed', 'Rotates promo, tips and engagement day to day'],
  ['promo', 'Promote product', 'Always selling — outcome-led copy with a buy CTA'],
  ['tips', 'Tips & advice', 'Useful advice posts that build trust'],
  ['engage', 'Fun & engage', 'Relatable posts written to get comments'],
];

const FORMATS = [
  ['single', 'Single image'],
  ['carousel', 'Story carousel'],
  ['video', 'Narrated video'],
];

const TONES = ['friendly and engaging', 'warm and cozy', 'professional', 'playful', 'luxury / premium', 'bold and energetic'];

function HourSelect({ value, onChange, id }) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      {Array.from({ length: 24 }, (_, h) => {
        const v = `${String(h).padStart(2, '0')}:00`;
        return <option key={v} value={v}>{v}</option>;
      })}
    </select>
  );
}

function AutomationCard({ a, platforms, onChanged }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(a);
  const [busy, setBusy] = useState(null);
  const [runResult, setRunResult] = useState(null);

  const connected = new Set(platforms.filter((p) => p.connected).map((p) => p.key));

  async function patch(body) {
    const res = await fetch(`/api/automations/${a.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.ok;
  }

  async function toggle() {
    setBusy('toggle');
    await patch({ enabled: !a.enabled });
    setBusy(null);
    onChanged();
  }

  async function save() {
    setBusy('save');
    await patch({
      name: draft.name, post_type: draft.post_type, format: draft.format,
      platforms: draft.platforms, times: draft.times, theme: draft.theme ?? '',
      tone: draft.tone ?? '', approval: draft.approval,
    });
    setBusy(null);
    setOpen(false);
    onChanged('Automation updated');
  }

  async function runNow() {
    setBusy('run'); setRunResult(null);
    const res = await fetch(`/api/automations/${a.id}/run`, { method: 'POST' });
    const json = await res.json();
    setRunResult(json);
    setBusy(null);
    onChanged();
  }

  async function remove() {
    if (!confirm(`Delete "${a.name}"? Posts it already made are kept.`)) return;
    setBusy('delete');
    await fetch(`/api/automations/${a.id}`, { method: 'DELETE' });
    onChanged('Automation deleted');
  }

  function togglePlatform(key) {
    const s = new Set(draft.platforms || []);
    s.has(key) ? s.delete(key) : s.add(key);
    setDraft({ ...draft, platforms: Array.from(s) });
  }

  function setCount(n) {
    n = Math.min(Math.max(Number(n) || 1, 1), 5);
    const t = [...(draft.times || [])];
    while (t.length < n) t.push('15:00');
    setDraft({ ...draft, times: t.slice(0, n) });
  }

  const typeLabel = POST_TYPES.find(([v]) => v === a.post_type)?.[1] || a.post_type;
  const formatLabel = FORMATS.find(([v]) => v === a.format)?.[1] || a.format;
  const missing = (a.platforms || []).filter((p) => !connected.has(p));

  return (
    <div className="auto-card">
      <div className="auto-main">
        <div className="auto-head">
          <button className={`switch${a.enabled ? ' on' : ''}`} onClick={toggle}
                  disabled={busy === 'toggle'} role="switch" aria-checked={a.enabled}
                  aria-label={`${a.enabled ? 'Disable' : 'Enable'} ${a.name}`}>
            <span className="switch-knob" />
          </button>
          <div className="auto-title-wrap">
            <h2 className="auto-title">{a.name}</h2>
            <p className="auto-sub">
              {typeLabel} · {formatLabel} · {(a.times || []).length}×/day
            </p>
          </div>
          <span className={`pill ${a.enabled ? 'connected' : 'disconnected'}`}>
            <span className="dot" />{a.enabled ? 'Active' : 'Paused'}
          </span>
        </div>

        <div className="auto-meta">
          <div className="auto-platforms">
            {(a.platforms || []).length === 0 ? (
              <span className="empty">No platforms selected</span>
            ) : (
              (a.platforms || []).map((p) => (
                <span key={p} className="platform-chip" style={{ background: PLATFORM_COLORS[p] }}>
                  <PlatformIcon platform={p} size={12} /> {p}
                </span>
              ))
            )}
          </div>
          <div className="auto-times">
            {(a.times || []).map((t) => <span key={t} className="time-chip">{t}</span>)}
            <span className="auto-utc">UTC</span>
          </div>
        </div>

        {missing.length > 0 && (
          <div className="notice warn">
            Not connected: {missing.join(', ')} — these will be skipped.{' '}
            <a href="/">Connect →</a>
          </div>
        )}

        <div className="auto-stats">
          <span><strong>{a.posts_made}</strong> posts made</span>
          <span><strong>{a.run_count}</strong> runs</span>
          <span>
            Approval: <strong>{a.approval === 'auto' ? 'auto-schedule' : 'review first'}</strong>
          </span>
          {a.next_run_at && (
            <span>Next: <strong>{new Date(a.next_run_at).toLocaleString([], { hour12: false })}</strong></span>
          )}
        </div>

        {a.last_run_at && (
          <p className="auto-lastrun">
            Last run {new Date(a.last_run_at).toLocaleString([], { hour12: false })} —{' '}
            <span className={a.last_run_status === 'ok' ? 'ok-text' : a.last_run_status === 'failed' ? 'err-text' : ''}>
              {a.last_run_status}
            </span>
            {a.last_run_detail && <span className="empty"> · {a.last_run_detail}</span>}
          </p>
        )}

        {runResult && (
          <div className={`notice ${runResult.ok ? 'ok' : 'err'}`}>
            {runResult.ok
              ? <>Ran now: {runResult.detail}. <a href="/review">See in Review →</a></>
              : <>Run failed: {runResult.detail || runResult.error}</>}
          </div>
        )}

        <div className="auto-actions">
          <button className="btn btn-outline" onClick={() => { setDraft(a); setOpen(!open); }}>
            {open ? 'Close' : 'Edit'}
          </button>
          <button className="btn btn-outline" onClick={runNow} disabled={!!busy}>
            {busy === 'run' ? <><span className="spinner" /> Running…</> : 'Run now'}
          </button>
          <button className="btn btn-ghost" onClick={remove} disabled={!!busy}>Delete</button>
        </div>
      </div>

      {open && (
        <div className="auto-edit">
          <div className="field">
            <label htmlFor={`n-${a.id}`}>Name</label>
            <input id={`n-${a.id}`} value={draft.name || ''}
                   onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </div>

          <div className="field">
            <label htmlFor={`pt-${a.id}`}>Type of automation</label>
            <select id={`pt-${a.id}`} value={draft.post_type}
                    onChange={(e) => setDraft({ ...draft, post_type: e.target.value })}>
              {POST_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <p className="hint">{POST_TYPES.find(([v]) => v === draft.post_type)?.[2]}</p>
          </div>

          <div className="field">
            <label htmlFor={`fm-${a.id}`}>Format</label>
            <select id={`fm-${a.id}`} value={draft.format}
                    onChange={(e) => setDraft({ ...draft, format: e.target.value })}>
              {FORMATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            {draft.format === 'video' && (
              <p className="hint">Videos are drafted here and rendered by the local worker, then you publish them from Review.</p>
            )}
          </div>

          <div className="field">
            <label>Platforms</label>
            <div className="checks">
              {platforms.filter((p) => p.enabled).map((p) => {
                const sel = (draft.platforms || []).includes(p.key);
                return (
                  <label key={p.key} className={`check${sel ? ' selected' : ''}${p.connected ? '' : ' disabled'}`}>
                    <input type="checkbox" checked={sel} disabled={!p.connected}
                           onChange={() => togglePlatform(p.key)} />
                    <span style={{ color: sel ? undefined : p.color, display: 'inline-flex' }}>
                      <PlatformIcon platform={p.key} size={16} />
                    </span>
                    {p.name}
                  </label>
                );
              })}
            </div>
          </div>

          <div className="field">
            <label htmlFor={`c-${a.id}`}>Posts per day</label>
            <select id={`c-${a.id}`} value={(draft.times || []).length}
                    onChange={(e) => setCount(e.target.value)}>
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>

          <div className="field">
            <label>Posting hours (UTC)</label>
            <div className="times-row">
              {(draft.times || []).map((t, i) => (
                <HourSelect key={i} value={t}
                            onChange={(v) => {
                              const t2 = [...draft.times]; t2[i] = v;
                              setDraft({ ...draft, times: t2 });
                            }} />
              ))}
            </div>
          </div>

          <div className="field">
            <label htmlFor={`ap-${a.id}`}>After generating</label>
            <select id={`ap-${a.id}`} value={draft.approval}
                    onChange={(e) => setDraft({ ...draft, approval: e.target.value })}>
              <option value="review">Wait for my approval (draft in Review)</option>
              <option value="auto">Schedule automatically</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor={`th-${a.id}`}>Topic (optional)</label>
            <textarea id={`th-${a.id}`} rows={2} value={draft.theme || ''}
                      onChange={(e) => setDraft({ ...draft, theme: e.target.value })}
                      placeholder="Leave empty to rotate topics from your store profile" />
          </div>

          <div className="field">
            <label htmlFor={`tn-${a.id}`}>Tone (optional)</label>
            <select id={`tn-${a.id}`} value={draft.tone || ''}
                    onChange={(e) => setDraft({ ...draft, tone: e.target.value })}>
              <option value="">Use my store default</option>
              {TONES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          <div className="auto-actions">
            <button className="btn btn-accent" onClick={save} disabled={busy === 'save'}>
              {busy === 'save' ? <span className="spinner" /> : 'Save changes'}
            </button>
            <button className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AutomationsPage() {
  const [automations, setAutomations] = useState([]);
  const [platforms, setPlatforms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [creating, setCreating] = useState(false);
  const router = useRouter();

  const load = useCallback((message) => {
    if (message) { setToast(message); setTimeout(() => setToast(null), 3500); }
    Promise.all([
      fetch('/api/automations', { cache: 'no-store' }),
      fetch('/api/connections', { cache: 'no-store' }),
    ]).then(async ([ra, rc]) => {
      if (ra.status === 401) { router.push('/login'); return; }
      const a = await ra.json();
      const c = await rc.json();
      const connectedSet = new Set((c.connections || []).map((x) => x.platform));
      setAutomations(a.automations || []);
      setPlatforms((c.platforms || []).map((p) => ({ ...p, connected: connectedSet.has(p.key) })));
      setLoading(false);
    });
  }, [router]);

  useEffect(() => { load(); }, [load]);

  async function create() {
    setCreating(true);
    const connectedKeys = platforms.filter((p) => p.connected).map((p) => p.key);
    await fetch('/api/automations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `Automation ${automations.length + 1}`,
        post_type: 'mixed', format: 'single', approval: 'review',
        platforms: connectedKeys, times: ['10:00'], enabled: false,
      }),
    });
    setCreating(false);
    load('Automation created — set it up and enable it');
  }

  return (
    <>
      <div className="page-head">
        <div className="head-row">
          <div>
            <h1>Automations</h1>
            <p>Recurring rules that create your posts. Track what each one does, change it, or run it on demand.</p>
          </div>
          <button className="btn btn-accent" onClick={create} disabled={creating || loading}>
            {creating ? <span className="spinner" /> : 'New automation'}
          </button>
        </div>
      </div>

      {toast && <div className="toast" role="status">{toast}</div>}

      {loading ? (
        <div className="skeleton" style={{ height: 200 }} />
      ) : automations.length === 0 ? (
        <div className="empty-state">
          <p className="empty-title">No automations yet</p>
          <p className="empty">
            An automation writes and publishes posts for you on a schedule — pick the kind of
            content, the format, the platforms and the hours, and it runs every day.
          </p>
          <button className="btn btn-accent" onClick={create} disabled={creating}>
            Create your first automation
          </button>
        </div>
      ) : (
        <div className="auto-list">
          {automations.map((a) => (
            <AutomationCard key={a.id} a={a} platforms={platforms} onChanged={load} />
          ))}
        </div>
      )}
    </>
  );
}
