'use client';

import { useEffect, useState } from 'react';

function ago(at) {
  if (!at) return 'never';
  const m = Math.round((Date.now() - new Date(at).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

const POST_PILL = {
  published: 'ok',
  failed: 'danger',
  scheduled: 'info',
  unconfirmed: 'warn',
};

const RUN_PILL = { ok: 'ok', failed: 'danger', partial: 'warn' };

// One account's real history.
//
// Loaded on demand rather than with the list: nobody needs forty posts for
// every account at once, and fetching them all would make the page slowest in
// the case that matters most — lots of users. The counts on the row answer
// "how much"; this answers "what, and is it going wrong".
export default function AdminUserDetail({ userId }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/admin/users/${userId}/activity`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => { if (live) setD(j); })
      .catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [userId]);

  if (error) return <p className="empty">Could not load activity ({error}).</p>;
  if (!d) return <div className="skeleton" style={{ height: 120 }} />;

  return (
    <div className="admin-detail">
      <div className="admin-detail-grid">
        <div>
          <p className="panel-title">Brand</p>
          {d.brand ? (
            <p className="admin-meta">
              {d.brand.store_name || 'unnamed'}
              {d.brand.niche && ` · ${d.brand.niche}`}
              {d.brand.language && ` · ${d.brand.language}`}
              {d.brand.has_rules && ' · has custom rules'}
              {d.brand.store_url && <><br />{d.brand.store_url}</>}
            </p>
          ) : <p className="empty">No brand profile yet.</p>}
        </div>

        <div>
          <p className="panel-title">Connections ({d.connections.length})</p>
          {d.connections.length === 0 ? <p className="empty">None.</p> : (
            <ul className="admin-list">
              {d.connections.map((c, i) => (
                <li key={i}>
                  <span className={`pill ${c.status === 'connected' ? 'ok' : 'danger'}`}>
                    {c.status}
                  </span>{' '}
                  {c.platform} · {c.account_name || '(unnamed)'}
                  {c.board && ` · board "${c.board}"`}
                  {c.last_error && <span className="err-text"> — {c.last_error}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <p className="panel-title admin-sub">Automations ({d.automations.length})</p>
      {d.automations.length === 0 ? <p className="empty">None.</p> : (
        <ul className="admin-list">
          {d.automations.map((a) => (
            <li key={a.id}>
              <span className={`pill ${a.enabled ? 'ok' : 'neutral'}`}>
                {a.enabled ? 'on' : 'off'}
              </span>{' '}
              <strong>{a.name}</strong> · {a.format} · {(a.times || []).join(', ')} {a.timezone}
              {' · '}{a.approval === 'auto' ? 'auto-publish' : 'review first'}
              {' · '}{a.run_count} runs
              {a.last_run_status && (
                <span className={a.last_run_status === 'failed' ? 'err-text' : undefined}>
                  {` · last ${a.last_run_status} ${ago(a.last_run_at)}`}
                </span>
              )}
              {a.detail && <><br /><span className="empty">{a.detail}</span></>}
            </li>
          ))}
        </ul>
      )}

      <p className="panel-title admin-sub">Recent posts ({d.posts.length})</p>
      {d.posts.length === 0 ? <p className="empty">Has never generated a post.</p> : (
        <div className="admin-list">
          {d.posts.map((p) => (
            <div className="admin-post" key={p.id}>
              <span className={`pill ${POST_PILL[p.status] || 'neutral'}`}>{p.status}</span>
              <span className="admin-post-body">
                <strong>{p.platform}</strong> · {p.format}
                {' · '}{(p.pin_title || p.theme || 'untitled').slice(0, 70)}
                {p.error_message && (
                  <><br /><span className="err-text">{p.error_message.slice(0, 170)}</span></>
                )}
              </span>
              {p.platform_post_url && (
                <a className="mini-link" href={p.platform_post_url}
                   target="_blank" rel="noreferrer">view</a>
              )}
              <span className="mini-time">{ago(p.created_at)}</span>
            </div>
          ))}
        </div>
      )}

      {d.runs.length > 0 && (
        <>
          <p className="panel-title admin-sub">Recent automation runs</p>
          <div className="admin-list">
            {d.runs.map((r) => (
              <div className="admin-post" key={r.id}>
                <span className={`pill ${RUN_PILL[r.status] || 'neutral'}`}>{r.status}</span>
                <span className="admin-post-body">
                  {r.automation || 'deleted automation'} · {r.trigger}
                  {` · made ${r.generated}, failed ${r.failed}`}
                  {r.detail && <><br /><span className="empty">{r.detail.slice(0, 200)}</span></>}
                </span>
                <span className="mini-time">{ago(r.started_at)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
