'use client';

import { useEffect, useState, useCallback, Fragment } from 'react';
import { useRouter } from 'next/navigation';
import AdminUserDetail from '../../../components/AdminUserDetail';
import '../../admin.css';

function ago(at) {
  if (!at) return 'never';
  const ms = Date.now() - new Date(at).getTime();
  const m = Math.round(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function Kpi({ label, value, sub, tone }) {
  return (
    <div className="kpi">
      <p className="kpi-label">{label}</p>
      <p className={`kpi-value${tone ? ' ' + tone : ''}`}>{value}</p>
      {sub && <p className="kpi-sub">{sub}</p>}
    </div>
  );
}

// Thirty days of signups. A bar chart rather than a line: these are counts of
// discrete events, and most days are zero on a young instance — a line implies
// a continuum between them that does not exist.
function SignupChart({ days }) {
  const max = Math.max(1, ...days.map((d) => d.n));
  return (
    <div className="admin-spark" role="img"
         aria-label={`Signups over the last ${days.length} days, ${days.reduce((s, d) => s + d.n, 0)} total`}>
      {days.map((d) => (
        <span key={d.day} className="admin-spark-col" title={`${d.day}: ${d.n}`}>
          <span className="admin-spark-bar"
                style={{ height: d.n ? `${Math.max(8, (d.n / max) * 100)}%` : '2px',
                         opacity: d.n ? 1 : 0.25 }} />
        </span>
      ))}
    </div>
  );
}

// "Active" is deliberately about output, not logins: somebody who signs in and
// never publishes is not using the product.
function activity(u) {
  if (u.published > 0) return { label: 'active', cls: 'ok' };
  if (u.connections > 0 || u.automations > 0) return { label: 'setting up', cls: 'warn' };
  if (u.keys > 0) return { label: 'signed up', cls: 'neutral' };
  return { label: 'empty', cls: 'neutral' };
}

export default function AdminPage() {
  const [d, setD] = useState(null);
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(null);
  const [openUser, setOpenUser] = useState(null);
  const [toast, setToast] = useState(null);
  const router = useRouter();

  const load = useCallback((message) => {
    if (message) { setToast(message); setTimeout(() => setToast(null), 4000); }
    fetch('/api/admin', { cache: 'no-store' })
      .then((r) => {
        if (r.status === 401) { router.push('/login'); return null; }
        if (r.status === 404) { setDenied(true); return null; }
        return r.json();
      })
      .then((json) => json && setD(json));
  }, [router]);

  useEffect(() => { load(); }, [load]);

  async function removeUser(u) {
    const warning =
      `Delete ${u.email}?\n\n`
      + `This also deletes ${u.published + u.failed + u.pending} post(s), `
      + `${u.connections} connection(s), ${u.keys} API key(s) and all their history.\n\n`
      + 'This cannot be undone.';
    if (!confirm(warning)) return;
    setBusy(u.id);
    const res = await fetch(`/api/admin/users/${u.id}`, { method: 'DELETE' });
    const json = await res.json().catch(() => ({}));
    setBusy(null);
    load(res.ok ? `Deleted ${json.deleted?.email || u.email}` : (json.error || 'Delete failed'));
  }

  if (denied) {
    return (
      <>
        <div className="page-head"><h1>Not found</h1></div>
        <div className="empty-state">
          <p className="empty-title">There is nothing here</p>
          <p>
            The admin view is only available to the addresses listed in{' '}
            <code>ADMIN_EMAILS</code>.
          </p>
          <a className="btn btn-outline" href="/dashboard">Back to dashboard</a>
        </div>
      </>
    );
  }

  if (!d) {
    return (
      <>
        <div className="page-head"><h1>Admin</h1></div>
        <div className="skeleton-stack">
          <div className="skeleton" style={{ height: 110 }} />
          <div className="skeleton" style={{ height: 260 }} />
        </div>
      </>
    );
  }

  const t = d.totals;

  return (
    <>
      <div className="page-head">
        <div className="head-row">
          <div>
            <h1>Admin</h1>
            <p>Everyone on this instance, and whether it is actually working for them.</p>
          </div>
          <button className="btn btn-outline" onClick={() => load()}>Refresh</button>
        </div>
      </div>

      {toast && <div className="toast" role="status">{toast}</div>}

      <div className="kpi-grid">
        <Kpi label="Users" value={t.users} sub={`${t.users_7d} in the last 7 days`} />
        <Kpi label="Published" value={t.published} sub={`${t.published_7d} this week`}
             tone={t.published > 0 ? 'success' : undefined} />
        <Kpi label="Connections" value={t.connections} sub="accounts linked" />
        <Kpi label="Automations on" value={t.automations_on} sub="running now" />
        <Kpi label="Link clicks" value={t.clicks} sub="tracked" tone="accent" />
        <Kpi label="Failed posts" value={t.failed}
             sub={t.failed > 0 ? 'need attention' : 'none'}
             tone={t.failed > 0 ? 'danger' : undefined} />
      </div>

      {/* System health first: if the scheduler is down, every other number on
          this page is about to stop moving and that is the headline. */}
      <section className="panel">
        <p className="panel-title">System</p>
        <div className="admin-health">
          <div className={`health ${d.scheduler?.healthy ? 'up' : 'down'}`} style={{ margin: 0 }}>
            <span className="health-dot" />
            <span className="health-text">
              <strong>Scheduler</strong>{' '}
              {d.scheduler
                ? <>ran {ago(d.scheduler.at)} via {d.scheduler.source || 'unknown'}</>
                : 'has never run'}
            </span>
          </div>
          <div className={`health ${d.renderWorker?.healthy ? 'up' : 'down'}`} style={{ margin: 0 }}>
            <span className="health-dot" />
            <span className="health-text">
              <strong>Render worker</strong>{' '}
              {d.renderWorker
                ? <>last seen {ago(d.renderWorker.at)} via {d.renderWorker.source || 'unknown'}</>
                : 'has never checked in'}
            </span>
          </div>
        </div>
      </section>

      {d.failing.length > 0 && (
        <section className="panel">
          <p className="panel-title">Automations failing right now</p>
          <p className="hint" style={{ marginTop: 0, marginBottom: 'var(--s4)' }}>
            These look enabled to their owner but their last run did not succeed.
          </p>
          <div className="mini-list">
            {d.failing.map((f) => (
              <div className="mini-row" key={f.id} style={{ alignItems: 'flex-start' }}>
                <span className={`pill ${f.last_run_status === 'failed' ? 'danger' : 'warn'}`}>
                  {f.last_run_status}
                </span>
                <span className="mini-text" style={{ whiteSpace: 'normal' }}>
                  <strong>{f.email}</strong> · {f.name}
                  <br />
                  <span className="empty">{f.detail || 'no detail recorded'}</span>
                </span>
                <span className="mini-time">{ago(f.last_run_at)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Everything that happened lately, across all accounts. The tables
          say how much; this says what, while it is still fixable. */}
      <section className="panel">
        <p className="panel-title">Live activity</p>
        {(!d.activity || d.activity.length === 0) ? (
          <p className="empty">Nothing has happened yet.</p>
        ) : (
          <div className="admin-list">
            {d.activity.map((a) => (
              <div className="admin-post" key={a.id}>
                <span className={`pill ${
                  a.status === 'published' ? 'ok'
                    : a.status === 'failed' ? 'danger'
                      : a.status === 'scheduled' ? 'info' : 'neutral'
                }`}>{a.status}</span>
                <span className="admin-post-body">
                  <strong>{a.email}</strong> · {a.platform} · {a.format}
                  {' · '}{(a.pin_title || a.theme || 'untitled').slice(0, 60)}
                  {a.error_message && (
                    <><br /><span className="err-text">{a.error_message.slice(0, 150)}</span></>
                  )}
                </span>
                {a.platform_post_url && (
                  <a className="mini-link" href={a.platform_post_url}
                     target="_blank" rel="noreferrer">view</a>
                )}
                <span className="mini-time">{ago(a.updated_at)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <p className="panel-title">Signups · last 30 days</p>
        <SignupChart days={d.signups} />
      </section>

      <section className="panel">
        <p className="panel-title">Users ({d.users.length})</p>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Status</th>
                <th className="num">Conn</th>
                <th className="num">Autos</th>
                <th className="num">Keys</th>
                <th className="num">Live</th>
                <th className="num">Failed</th>
                <th>Last post</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {d.users.map((u) => {
                const a = activity(u);
                return (
                  <Fragment key={u.id}>
                  <tr>
                    <td>
                      <span className="admin-email">{u.email}</span>
                      <span className="admin-meta">
                        joined {ago(u.created_at)}
                        {u.last_login_at && ` · seen ${ago(u.last_login_at)}`}
                      </span>
                    </td>
                    <td><span className={`pill ${a.cls}`}>{a.label}</span></td>
                    <td className="num">{u.connections}</td>
                    <td className="num">
                      {u.automations_on}/{u.automations}
                    </td>
                    <td className="num">{u.keys}</td>
                    <td className="num">{u.published}</td>
                    <td className={`num${u.failed > 0 ? ' err-text' : ''}`}>{u.failed}</td>
                    <td className="admin-meta">{ago(u.last_post_at)}</td>
                    <td className="admin-actions">
                      <button className="link-btn"
                              onClick={() => setOpenUser(openUser === u.id ? null : u.id)}
                              aria-expanded={openUser === u.id}>
                        {openUser === u.id ? 'Hide' : 'Activity'}
                      </button>
                      <button className="link-btn danger" disabled={busy === u.id}
                              onClick={() => removeUser(u)}>
                        {busy === u.id ? '…' : 'Delete'}
                      </button>
                    </td>
                  </tr>
                  {openUser === u.id && (
                    <tr className="admin-detail-row">
                      <td colSpan={9}><AdminUserDetail userId={u.id} /></td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
