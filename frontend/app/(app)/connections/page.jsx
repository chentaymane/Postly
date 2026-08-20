'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { PlatformIcon } from '../../../components/BrandIcons';

function Dashboard() {
  const [data, setData] = useState({ platforms: [], connections: [], baseUrl: '' });
  const [loading, setLoading] = useState(true);
  const params = useSearchParams();
  const router = useRouter();
  const connected = params.get('connected');
  const error = params.get('error');

  async function load() {
    const res = await fetch('/api/connections', { cache: 'no-store' });
    if (res.status === 401) { router.push('/login'); return; }
    setData(await res.json());
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function disconnect(id) {
    if (!confirm('Disconnect this account? Postly will no longer be able to publish to it.')) return;
    await fetch(`/api/connections/${id}`, { method: 'DELETE' });
    load();
  }

  async function setBoard(id, boardId) {
    await fetch(`/api/connections/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ board_id: boardId }),
    });
    load();
  }

  const byPlatform = {};
  for (const c of data.connections) (byPlatform[c.platform] ||= []).push(c);
  const isLive = (c) => c.status === 'connected';
  const liveCount = data.platforms.filter(
    (p) => (byPlatform[p.key] || []).some(isLive)
  ).length;

  return (
    <>
      <div className="page-head">
        <h1>Connections</h1>
        <p>
          Connect an account once — Postly publishes to it from then on.
          {liveCount > 0 && ` ${liveCount} account${liveCount > 1 ? 's' : ''} connected.`}
        </p>
      </div>

      {connected && <div className="notice ok"><strong>✓</strong><span>{connected} connected successfully.</span></div>}
      {error && <div className="notice err"><strong>!</strong><span>{error}</span></div>}

      {loading ? (
        <div className="grid">
          {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="skeleton skeleton-card" />)}
        </div>
      ) : (
        <div className="grid">
          {data.platforms.map((p) => {
            const conns = byPlatform[p.key] || [];
            // A row exists for a dropped account too, so "connected" has to mean
            // the connector still recognises it — not merely that we once did.
            const isConnected = conns.some(isLive);

            return (
              <div className="card" key={p.key}>
                <div className="card-head">
                  <span className="platform-icon" style={{ background: p.color }}>
                    <PlatformIcon platform={p.key} />
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <p className="card-title">{p.name}</p>
                    {!p.enabled ? (
                      <span className="pill soon">Coming soon</span>
                    ) : isConnected ? (
                      <span className="pill connected"><span className="dot" />Connected</span>
                    ) : (
                      <span className="pill disconnected"><span className="dot" />Not connected</span>
                    )}
                  </div>
                </div>

                {isConnected && conns.map((c) => (
                  <div key={c.id}>
                    <p className="card-sub">
                      @{c.account_name || c.account_id}
                      {p.key === 'instagram' && c.page_name && ` · via ${c.page_name}`}
                    </p>

                    {/* Whatever is actually wrong with this account, said here.
                        A Pinterest account with no boards, or one the connector has
                        dropped, used to look identical to a healthy one and only
                        revealed itself as a failed post hours later. */}
                    {c.last_error && (
                      <div className={`notice ${c.status === 'connected' ? 'warn' : 'err'}`}
                           style={{ marginTop: 10, marginBottom: 0 }}>
                        <span className="notice-body">{c.last_error}</span>
                      </div>
                    )}

                    {p.key === 'pinterest' && c.boards?.length > 0 && (
                      <div className="field" style={{ marginTop: 12 }}>
                        <label htmlFor={`board-${c.id}`}>Publish to board</label>
                        <select
                          id={`board-${c.id}`}
                          value={c.board_id || ''}
                          onChange={(e) => setBoard(c.id, e.target.value)}
                        >
                          {c.boards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                        </select>
                      </div>
                    )}
                  </div>
                ))}

                <div className="card-foot">
                  {!p.enabled ? (
                    <button className="btn btn-outline btn-block" disabled>Not available yet</button>
                  ) : !p.configured ? (
                    <div style={{ width: '100%' }}>
                      <button className="btn btn-outline btn-block" disabled>Setup required</button>
                      <p className="hint">
                        Register a {p.name} app and add its credentials.
                        {p.requirement && <> Requires a {p.requirement}.</>}
                        {' '}Redirect URI:
                        <code className="code-inline">{data.baseUrl}/api/oauth/{p.key}/callback</code>
                      </p>
                    </div>
                  ) : isConnected ? (
                    <>
                      <a className="btn btn-outline" href={p.connectPath}>Reconnect</a>
                      <button className="btn btn-ghost" onClick={() => disconnect(conns[0].id)}>Disconnect</button>
                    </>
                  ) : (
                    <a className="btn btn-accent btn-block" href={p.connectPath}>
                      Connect {p.name}
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div className="grid"><div className="skeleton skeleton-card" /></div>}>
      <Dashboard />
    </Suspense>
  );
}
