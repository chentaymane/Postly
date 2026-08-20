'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { PlatformIcon, NavIcon } from '../../../components/BrandIcons';

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

const TONES = [
  'friendly and engaging', 'warm and cozy', 'professional',
  'playful', 'luxury / premium', 'bold and energetic',
];

// A short, opinionated list beats a 400-entry dropdown; "my timezone" covers
// almost everyone and the rest can still be reached from the full list.
function timezoneOptions(browserZone, current) {
  const common = [
    'UTC', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid',
    'Africa/Casablanca', 'Africa/Cairo', 'Africa/Lagos', 'Africa/Johannesburg',
    'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
    'America/Sao_Paulo', 'Asia/Dubai', 'Asia/Karachi', 'Asia/Kolkata',
    'Asia/Bangkok', 'Asia/Shanghai', 'Asia/Tokyo', 'Australia/Sydney',
  ];
  return Array.from(new Set([browserZone, current, ...common].filter(Boolean)));
}

// Selected platforms that will refuse a given format. TikTok takes video only,
// so an image automation with TikTok selected published to everything else and
// quietly skipped TikTok on every single run — worth saying before the run, not
// after it.
function unsupportedPlatforms(selected, format, platforms) {
  return (selected || [])
    .map((key) => platforms.find((p) => p.key === key))
    .filter((p) => p?.formats && !p.formats.includes(format));
}

// "Narrated video", or "single image or story carousel" — the labels the form
// itself uses, so the warning and the dropdown agree.
function acceptedLabel(formats) {
  return (formats || [])
    .map((f) => FORMATS.find(([v]) => v === f)?.[1] || f)
    .join(' or ');
}

// Minutes past local midnight, for placing a marker on the day track.
function minutesOf(hhmm) {
  const [h, m] = String(hhmm || '0:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

// The clock reading right now in a given zone, as "HH:MM".
function nowInZone(tz) {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit',
    }).format(new Date());
  } catch {
    return null;
  }
}

function relative(iso) {
  if (!iso) return null;
  const diff = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  const unit =
    mins < 1 ? 'less than a minute'
      : mins < 60 ? `${mins} minute${mins === 1 ? '' : 's'}`
        : abs < 86400000 ? `${Math.round(mins / 60)} hour${Math.round(mins / 60) === 1 ? '' : 's'}`
          : `${Math.round(abs / 86400000)} day${Math.round(abs / 86400000) === 1 ? '' : 's'}`;
  return diff >= 0 ? `in ${unit}` : `${unit} ago`;
}

// ---------------------------------------------------------------------------
// The day strip: every slot of one day on a single 24-hour track, with a marker
// for "now". A list of times tells you the numbers; this tells you the shape of
// the day — whether the posts are bunched, and what is still to come.
// ---------------------------------------------------------------------------
function DayStrip({ times, timezone, tzLabel, nextRunAt }) {
  const now = nowInZone(timezone);
  const nowPct = now ? (minutesOf(now) / 1440) * 100 : null;
  const nextMinutes = nextRunAt
    ? minutesOf(new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone, hour12: false, hour: '2-digit', minute: '2-digit',
      }).format(new Date(nextRunAt)))
    : null;

  return (
    <div className="day-strip">
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="day-track">
          {nowPct !== null && (
            <span className="day-now" style={{ left: `${nowPct}%` }}
                  title={`Now — ${now} ${tzLabel}`} />
          )}
          {times.map((t) => {
            const mins = minutesOf(t);
            const isNext = nextMinutes !== null && mins === nextMinutes;
            const isPast = nowPct !== null && mins < minutesOf(now) && !isNext;
            return (
              <span key={t}
                    className={`day-marker${isNext ? ' next' : isPast ? ' past' : ''}`}
                    style={{ left: `${(mins / 1440) * 100}%` }}
                    title={`${t} ${tzLabel}${isNext ? ' — next' : ''}`} />
            );
          })}
        </div>
        <div className="day-scale" aria-hidden="true">
          <span>00</span><span>06</span><span>12</span><span>18</span><span>24</span>
        </div>
      </div>
      <span className="day-tz">{tzLabel}</span>
    </div>
  );
}

// A run's detail is one line per platform, joined with " · ". Shown as a single
// truncated string it hid the thing worth reading — that Instagram published and
// TikTok did not, and why — so it is split back out.
function runLines(detail) {
  return String(detail || '')
    .split(' · ')
    .map((s) => s.trim())
    .filter(Boolean);
}

function RunHistory({ runs }) {
  if (!runs || runs.length === 0) {
    return <p className="empty">No runs recorded yet.</p>;
  }
  return (
    <div className="runs">
      {runs.map((r) => (
        <div className="run-row" key={r.id}>
          <span className="run-when">
            {new Date(r.started_at).toLocaleString([], {
              hour12: false, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
            })}
          </span>
          <span className={`pill ${
            r.status === 'ok' ? 'ok'
              : r.status === 'failed' ? 'danger'
                : r.status === 'partial' ? 'warn' : 'neutral'
          }`}>
            {r.status}
          </span>
          <span className="run-detail" title={r.detail || ''}>
            {runLines(r.detail).length > 0 ? (
              <span className="run-lines">
                {runLines(r.detail).map((line, i) => <span key={i}>{line}</span>)}
              </span>
            ) : (
              r.status === 'skipped' ? 'nothing due' : '—'
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

function AutomationCard({ a, platforms, browserZone, onChanged }) {
  const [open, setOpen] = useState(false);
  const [showRuns, setShowRuns] = useState(false);
  const [draft, setDraft] = useState(a);
  const [busy, setBusy] = useState(null);
  const [runResult, setRunResult] = useState(null);

  const connected = new Set(platforms.filter((p) => p.connected).map((p) => p.key));
  const times = Array.isArray(a.times) ? a.times : [];
  const tzLabel = a.tz_label || a.timezone;

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
    onChanged(a.enabled ? 'Automation paused' : 'Automation active');
  }

  async function save() {
    setBusy('save');
    await patch({
      name: draft.name, post_type: draft.post_type, format: draft.format,
      platforms: draft.platforms, times: draft.times, timezone: draft.timezone,
      theme: draft.theme ?? '', tone: draft.tone ?? '', approval: draft.approval,
      custom_prompt: draft.custom_prompt ?? '',
      catch_up_hours: draft.catch_up_hours,
    });
    setBusy(null);
    setOpen(false);
    onChanged('Automation updated');
  }

  async function runNow() {
    setBusy('run'); setRunResult(null);
    const res = await fetch(`/api/automations/${a.id}/run`, { method: 'POST' });
    setRunResult(await res.json());
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

  // The single most common cause of "it posted at the wrong time": the
  // automation is still on UTC while the person reading this is not.
  const zoneMismatch = a.timezone === 'UTC' && browserZone && browserZone !== 'UTC';

  const wrongFormat = unsupportedPlatforms(a.platforms, a.format, platforms);
  const draftWrongFormat = unsupportedPlatforms(draft.platforms, draft.format, platforms);

  return (
    <div className={`auto-card${a.enabled ? '' : ' paused'}`}>
      <div className="auto-main">
        <div className="auto-head">
          <button className={`switch${a.enabled ? ' on' : ''}`} onClick={toggle}
                  disabled={busy === 'toggle'} role="switch" aria-checked={a.enabled}
                  aria-label={`${a.enabled ? 'Pause' : 'Activate'} ${a.name}`}>
            <span className="switch-knob" />
          </button>
          <div className="auto-title-wrap">
            <h2 className="auto-title">{a.name}</h2>
            <p className="auto-sub">
              {typeLabel} · {formatLabel} · {times.length}×/day ·{' '}
              {a.approval === 'auto' ? 'posts automatically' : 'waits for approval'}
            </p>
          </div>
          <span className={`pill ${a.enabled ? 'ok' : 'neutral'}`}>
            <span className={`dot${a.enabled ? ' pulse' : ''}`} />{a.enabled ? 'Active' : 'Paused'}
          </span>
        </div>

        {times.length > 0 && (
          <DayStrip times={times} timezone={a.timezone} tzLabel={tzLabel} nextRunAt={a.next_run_at} />
        )}

        <div className="auto-meta">
          <div className="auto-platforms">
            {(a.platforms || []).length === 0 ? (
              <span className="empty">No platforms selected</span>
            ) : (
              (a.platforms || []).map((p) => (
                <span key={p} className="platform-chip" style={{ background: PLATFORM_COLORS[p] }}>
                  <PlatformIcon platform={p} size={11} /> {p}
                </span>
              ))
            )}
          </div>
          <div className="auto-times">
            {times.map((t) => (
              <span key={t} className="time-chip">{t}</span>
            ))}
          </div>
        </div>

        {zoneMismatch && (
          <div className="notice warn">
            <span className="notice-icon"><NavIcon name="clock" size={16} /></span>
            <span className="notice-body">
              These times are <strong>UTC</strong>, but your computer is on <strong>{browserZone}</strong> —
              so a post set for {times[0] || '10:00'} goes out at a different hour where you are.{' '}
              <button className="link-btn" onClick={async () => {
                setBusy('tz');
                await patch({ timezone: browserZone });
                setBusy(null);
                onChanged(`Times now follow ${browserZone}`);
              }}>Use {browserZone} instead</button>
            </span>
          </div>
        )}

        {wrongFormat.length > 0 && (
          <div className="notice warn">
            <span className="notice-icon"><NavIcon name="alert" size={16} /></span>
            <span className="notice-body">
              {wrongFormat.map((p) => p.name).join(', ')}{' '}
              {wrongFormat.length === 1 ? 'does' : 'do'} not accept{' '}
              <strong>{formatLabel}</strong> — {wrongFormat.length === 1 ? 'it is' : 'they are'}{' '}
              skipped on every run. {wrongFormat.length === 1 ? 'It accepts' : 'They accept'}{' '}
              {acceptedLabel(wrongFormat[0].formats)}.{' '}
              {wrongFormat.every((p) => p.formats.includes('video')) && (
                <button className="link-btn" disabled={!!busy} onClick={async () => {
                  setBusy('format');
                  await patch({ format: 'video' });
                  setBusy(null);
                  onChanged('Format changed to Narrated video');
                }}>Switch to Narrated video</button>
              )}
            </span>
          </div>
        )}

        {missing.length > 0 && (
          <div className="notice warn">
            <span className="notice-icon"><NavIcon name="alert" size={16} /></span>
            <span className="notice-body">
              Not connected: {missing.join(', ')} — these are skipped every run.{' '}
              <a href="/">Connect them →</a>
            </span>
          </div>
        )}

        <div className="auto-stats">
          <span><strong>{a.posts_live}</strong> live</span>
          <span><strong>{a.posts_made}</strong> made</span>
          {a.posts_failed > 0 && <span className="err-text"><strong>{a.posts_failed}</strong> failed</span>}
          <span><strong>{a.run_count}</strong> runs</span>
          {a.enabled && a.next_run_at && (
            <span>
              Next{' '}
              <strong>
                {new Date(a.next_run_at).toLocaleString([], {
                  hour12: false, weekday: 'short', hour: '2-digit', minute: '2-digit',
                })}
              </strong>{' '}
              <span className="empty">({relative(a.next_run_at)})</span>
            </span>
          )}
        </div>

        {a.last_run_at && (
          <p className="auto-sub" style={{ margin: 0 }}>
            Last run {relative(a.last_run_at)} —{' '}
            <span className={
              a.last_run_status === 'ok' ? 'ok-text'
                : a.last_run_status === 'failed' ? 'err-text'
                  : a.last_run_status === 'partial' ? 'warn-text' : ''
            }>
              {a.last_run_status}
            </span>
            {a.last_run_detail && <span className="empty"> · {a.last_run_detail}</span>}
          </p>
        )}

        {runResult && (
          <div className={`notice ${runResult.ok ? 'ok' : 'err'}`}>
            <span className="notice-body">
              {runResult.ok
                ? <>Test run: {runResult.detail}. <a href="/review">See it in Review →</a></>
                : <>Run failed: {runResult.detail || runResult.error}</>}
            </span>
          </div>
        )}

        <div className="auto-actions">
          <button className="btn btn-outline btn-sm" onClick={() => { setDraft(a); setOpen(!open); }}
                  aria-expanded={open}>
            {open ? 'Close' : 'Edit'}
          </button>
          <button className="btn btn-outline btn-sm" onClick={runNow} disabled={!!busy}
                  title="Generates one post per platform right now. Today's scheduled posts still happen.">
            {busy === 'run' ? <><span className="spinner" /> Running…</> : 'Test run'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowRuns(!showRuns)}
                  aria-expanded={showRuns}>
            {showRuns ? 'Hide history' : 'History'}
          </button>
          <button className="btn btn-ghost btn-sm danger" onClick={remove} disabled={!!busy}
                  style={{ marginLeft: 'auto' }}>
            Delete
          </button>
        </div>

        {showRuns && (
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--s3)' }}>
            <p className="panel-title" style={{ marginBottom: 'var(--s2)' }}>Recent runs</p>
            <RunHistory runs={a.runs} />
          </div>
        )}
      </div>

      {open && (
        <div className="auto-edit">
          <div className="field">
            <label htmlFor={`n-${a.id}`}>Name</label>
            <input id={`n-${a.id}`} value={draft.name || ''}
                   onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor={`pt-${a.id}`}>Type of content</label>
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
              {draftWrongFormat.length > 0 && (
                <p className="hint warn-text">
                  {draftWrongFormat.map((p) => p.name).join(', ')} will be skipped —{' '}
                  {draftWrongFormat.length === 1 ? 'it accepts' : 'they accept'}{' '}
                  {acceptedLabel(draftWrongFormat[0].formats)} only.
                </p>
              )}
              {draft.format === 'video' && (
                <p className="hint">
                  Videos are drafted here and rendered by the local worker. They publish at their
                  scheduled time once the MP4 is ready.
                </p>
              )}
            </div>
          </div>

          <div className="field">
            <label>Platforms</label>
            <div className="checks">
              {platforms.filter((p) => p.enabled).map((p) => {
                const sel = (draft.platforms || []).includes(p.key);
                return (
                  <label key={p.key}
                         className={`check${sel ? ' selected' : ''}${p.connected ? '' : ' disabled'}`}>
                    <input type="checkbox" checked={sel} disabled={!p.connected}
                           onChange={() => togglePlatform(p.key)} />
                    <span style={{ color: sel ? undefined : p.color, display: 'inline-flex' }}>
                      <PlatformIcon platform={p.key} size={15} />
                    </span>
                    {p.name}
                  </label>
                );
              })}
            </div>
          </div>

          <p className="section-title">Schedule</p>

          <div className="field">
            <label htmlFor={`tz-${a.id}`}>Timezone</label>
            <select id={`tz-${a.id}`} value={draft.timezone || 'UTC'}
                    onChange={(e) => setDraft({ ...draft, timezone: e.target.value })}>
              {timezoneOptions(browserZone, draft.timezone).map((z) => (
                <option key={z} value={z}>
                  {z}{z === browserZone ? ' (yours)' : ''}
                </option>
              ))}
            </select>
            <p className="hint">
              Posting hours are read in this timezone and stay put across daylight saving.
              It is {nowInZone(draft.timezone || 'UTC')} there right now.
            </p>
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor={`c-${a.id}`}>Posts per day</label>
              <select id={`c-${a.id}`} value={(draft.times || []).length}
                      onChange={(e) => setCount(e.target.value)}>
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor={`cu-${a.id}`}>If a run is missed</label>
              <select id={`cu-${a.id}`} value={draft.catch_up_hours ?? 6}
                      onChange={(e) => setDraft({ ...draft, catch_up_hours: Number(e.target.value) })}>
                <option value={0}>Skip it</option>
                <option value={2}>Catch up within 2 hours</option>
                <option value={6}>Catch up within 6 hours</option>
                <option value={12}>Catch up within 12 hours</option>
                <option value={24}>Catch up within a day</option>
              </select>
              <p className="hint">A late post still goes out, rather than the day being lost.</p>
            </div>
          </div>

          <div className="field">
            <label>Posting hours</label>
            <div className="times-row">
              {(draft.times || []).map((t, i) => (
                <input key={i} type="time" value={t} step="300"
                       aria-label={`Posting time ${i + 1}`}
                       onChange={(e) => {
                         const t2 = [...draft.times];
                         t2[i] = e.target.value || '10:00';
                         setDraft({ ...draft, times: t2 });
                       }} />
              ))}
            </div>
            <p className="hint">Local to {draft.timezone || 'UTC'}.</p>
          </div>

          <div className="field">
            <label htmlFor={`ap-${a.id}`}>After generating</label>
            <select id={`ap-${a.id}`} value={draft.approval}
                    onChange={(e) => setDraft({ ...draft, approval: e.target.value })}>
              <option value="review">Wait for my approval (draft in Review)</option>
              <option value="auto">Publish at the scheduled time</option>
            </select>
          </div>

          <p className="section-title">Content</p>

          <div className="field">
            <label htmlFor={`th-${a.id}`}>Topic (optional)</label>
            <textarea id={`th-${a.id}`} rows={2} value={draft.theme || ''}
                      onChange={(e) => setDraft({ ...draft, theme: e.target.value })}
                      placeholder="Leave empty to rotate topics from your brand profile" />
          </div>

          <div className="field">
            <label htmlFor={`cp-${a.id}`}>Extra rules for this automation</label>
            <textarea id={`cp-${a.id}`} rows={4} value={draft.custom_prompt || ''}
                      onChange={(e) => setDraft({ ...draft, custom_prompt: e.target.value })}
                      placeholder="Only behind-the-scenes posts. Never mention price." />
            <p className="hint">
              Added on top of your{' '}
              <a href="/settings">brand rules</a>, not instead of them — so a brand-wide rule
              still applies here.
            </p>
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
              {busy === 'save' ? <><span className="spinner" /> Saving…</> : 'Save changes'}
            </button>
            <button className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scheduler health. An automation that looks enabled and simply never posts is
// indistinguishable from one with nothing due — unless the app says when the
// scheduler last ran.
// ---------------------------------------------------------------------------
function SchedulerHealth({ health, onKick, kicking }) {
  if (!health) return null;

  if (health.neverRan) {
    return (
      <div className="health down">
        <span className="health-dot" />
        <span className="health-text">
          <strong>The scheduler has not run yet.</strong> Posts are generated and published by a
          tick that should arrive every few minutes.
        </span>
        <button className="btn btn-outline btn-sm" onClick={onKick} disabled={kicking}>
          {kicking ? <span className="spinner" /> : 'Run it now'}
        </button>
      </div>
    );
  }

  const mins = Math.round((health.ageMs || 0) / 60000);

  // A tab-driven tick is not a scheduler. It looks identical in every other
  // respect, so the one case that must never read as healthy is the one where
  // closing this page stops the posting.
  if (health.healthy && health.source === 'browser-tab') {
    return (
      <div className="health down">
        <span className="health-dot" />
        <span className="health-text">
          <strong>Only this browser tab is driving the scheduler.</strong> Posts stop going out
          when you close it. Enable the <code>scheduler</code> GitHub Action so it runs without you.
        </span>
        <button className="btn btn-outline btn-sm" onClick={onKick} disabled={kicking}>
          {kicking ? <span className="spinner" /> : 'Run now'}
        </button>
      </div>
    );
  }

  const SOURCE_LABEL = {
    'github-actions': 'GitHub Actions',
    'vercel-cron': 'the Vercel cron',
    'external-cron': 'your cron',
    'external': 'an external scheduler',
    'browser-tab': 'a browser tab',
  };

  return (
    <div className={`health ${health.healthy ? 'up' : 'down'}`}>
      <span className="health-dot" />
      <span className="health-text">
        {health.healthy ? (
          <>
            Scheduler ran <strong>{mins < 1 ? 'just now' : `${mins} min ago`}</strong>
            {health.source && <> via {SOURCE_LABEL[health.source] || health.source}</>}
            {health.upcoming > 0 && <> · <strong>{health.upcoming}</strong> post{health.upcoming === 1 ? '' : 's'} queued</>}
            {health.retrying > 0 && <> · <strong>{health.retrying}</strong> retrying</>}
            {health.blocked > 0 && <> · <strong className="err-text">{health.blocked}</strong> need attention</>}
          </>
        ) : (
          <>
            <strong>Last tick was {mins} minutes ago.</strong> Scheduled posts go out late while
            this is behind. Missed slots are still caught up, but if the gap keeps growing check
            that the <code>scheduler</code> GitHub Action is enabled and its{' '}
            <code>CRON_SECRET</code> matches.
          </>
        )}
      </span>
      <button className="btn btn-outline btn-sm" onClick={onKick} disabled={kicking}>
        {kicking ? <span className="spinner" /> : 'Run now'}
      </button>
    </div>
  );
}

// The render worker is a separate machine from the scheduler, and only videos
// depend on it. With video the default format, a worker that is not running
// looks exactly like an automation that has stopped: drafts are made on time
// and simply never publish, because a video without an MP4 cannot go out.
function RenderWorkerHealth({ health }) {
  const waiting = health?.awaitingRender || 0;
  if (waiting === 0) return null;

  return (
    <div className="health down">
      <span className="health-dot" />
      <span className="health-text">
        <strong>{waiting} video{waiting === 1 ? '' : 's'} waiting on the render worker</strong>{' '}
        for over 30 minutes. They publish as soon as the MP4 exists — start{' '}
        <code>worker/render_worker.py</code> on the machine with FFmpeg and Piper.
      </span>
    </div>
  );
}

export default function AutomationsPage() {
  const [automations, setAutomations] = useState([]);
  const [platforms, setPlatforms] = useState([]);
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [creating, setCreating] = useState(false);
  const [kicking, setKicking] = useState(false);
  const router = useRouter();

  // The zone this person is actually in — the default for anything new, and
  // what the mismatch warning compares against.
  const browserZone = useMemo(() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return 'UTC'; }
  }, []);

  const load = useCallback((message) => {
    if (message) { setToast(message); setTimeout(() => setToast(null), 3500); }
    Promise.all([
      fetch('/api/automations', { cache: 'no-store' }),
      fetch('/api/connections', { cache: 'no-store' }),
      fetch('/api/scheduler', { cache: 'no-store' }),
    ]).then(async ([ra, rc, rh]) => {
      if (ra.status === 401) { router.push('/login'); return; }
      const a = await ra.json();
      const c = await rc.json();
      const h = rh.ok ? await rh.json() : null;
      const connectedSet = new Set((c.connections || []).map((x) => x.platform));
      setAutomations(a.automations || []);
      setPlatforms((c.platforms || []).map((p) => ({ ...p, connected: connectedSet.has(p.key) })));
      setHealth(h);
      setLoading(false);
    });
  }, [router]);

  useEffect(() => { load(); }, [load]);

  async function kick() {
    setKicking(true);
    await fetch('/api/scheduler?force=1', { method: 'POST' }).catch(() => {});
    setKicking(false);
    load('Scheduler run finished');
  }

  async function create() {
    setCreating(true);
    const connectedKeys = platforms.filter((p) => p.connected).map((p) => p.key);
    await fetch('/api/automations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `Automation ${automations.length + 1}`,
        // Narrated video by default: it is the format every connected platform
        // accepts, TikTok included, and TikTok takes nothing else.
        post_type: 'mixed', format: 'video', approval: 'review',
        platforms: connectedKeys, times: ['10:00'],
        timezone: browserZone,     // never silently default someone to UTC
        enabled: false,
      }),
    });
    setCreating(false);
    load('Automation created — set it up, then switch it on');
  }

  const activeCount = automations.filter((a) => a.enabled).length;

  return (
    <>
      <div className="page-head">
        <div className="head-row">
          <div>
            <h1>Automations</h1>
            <p>
              Recurring rules that write and publish your posts.
              {automations.length > 0 && ` ${activeCount} of ${automations.length} active.`}
            </p>
          </div>
          <button className="btn btn-accent" onClick={create} disabled={creating || loading}>
            {creating ? <span className="spinner" /> : 'New automation'}
          </button>
        </div>
      </div>

      {toast && <div className="toast" role="status">{toast}</div>}

      {!loading && <SchedulerHealth health={health} onKick={kick} kicking={kicking} />}
      {!loading && <RenderWorkerHealth health={health} />}

      {loading ? (
        <div className="skeleton-stack">
          <div className="skeleton" style={{ height: 52 }} />
          <div className="skeleton" style={{ height: 260 }} />
          <div className="skeleton" style={{ height: 260 }} />
        </div>
      ) : automations.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon"><NavIcon name="automation" size={26} /></span>
          <p className="empty-title">No automations yet</p>
          <p>
            An automation writes and publishes posts for you on a schedule. Pick the kind of
            content, the format, the platforms and the hours — it runs every day in your own
            timezone, and catches up if a run is missed. New automations make narrated video,
            which every platform accepts and which needs the local render worker running.
          </p>
          <button className="btn btn-accent" onClick={create} disabled={creating}>
            Create your first automation
          </button>
        </div>
      ) : (
        <div className="auto-list">
          {automations.map((a) => (
            <AutomationCard key={a.id} a={a} platforms={platforms}
                            browserZone={browserZone} onChanged={load} />
          ))}
        </div>
      )}
    </>
  );
}
