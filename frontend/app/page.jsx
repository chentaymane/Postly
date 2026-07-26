'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

function Dashboard() {
  const [data, setData] = useState({ platforms: [], connections: [] });
  const [loading, setLoading] = useState(true);
  const params = useSearchParams();
  const router = useRouter();
  const connected = params.get('connected');
  const error = params.get('error');

  async function load() {
    setLoading(true);
    const res = await fetch('/api/connections', { cache: 'no-store' });
    if (res.status === 401) { router.push('/login'); return; }
    const json = await res.json();
    setData(json);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function disconnect(id) {
    if (!confirm('Disconnect this account?')) return;
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
  for (const c of data.connections) {
    (byPlatform[c.platform] = byPlatform[c.platform] || []).push(c);
  }

  return (
    <>
      <div className="page-head">
        <h1>Connections</h1>
        <p>Connect your social accounts once. Postly publishes to all of them.</p>
      </div>

      {connected && <div className="notice ok">✓ {connected} connected successfully.</div>}
      {error && <div className="notice err">Connection failed: {error}</div>}

      {loading ? (
        <p className="empty">Loading…</p>
      ) : (
        <div className="grid">
          {data.platforms.map((p) => {
            const conns = byPlatform[p.key] || [];
            const isConnected = conns.length > 0;
            return (
              <div className="card" key={p.key}>
                <div className="card-head">
                  <div className="platform-icon" style={{ background: p.color }}>{p.emoji}</div>
                  <div>
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

                {isConnected && (
                  <div>
                    {conns.map((c) => (
                      <div key={c.id}>
                        <div className="account-line">
                          <span>@{c.account_name || c.account_id}</span>
                          {c.page_name && p.key === 'instagram' && <span>· via {c.page_name}</span>}
                        </div>
                        {p.key === 'pinterest' && (c.boards?.length > 0) && (
                          <div className="field" style={{ marginTop: 10 }}>
                            <label>Board</label>
                            <select
                              value={c.board_id || ''}
                              onChange={(e) => setBoard(c.id, e.target.value)}
                            >
                              {c.boards.map((b) => (
                                <option key={b.id} value={b.id}>{b.name}</option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <div className="card-foot">
                  {!p.enabled ? (
                    <button className="btn btn-outline btn-block" disabled>Not available yet</button>
                  ) : !p.configured ? (
                    <div style={{ width: '100%' }}>
                      <button className="btn btn-outline btn-block" disabled>Needs app setup</button>
                      <p className="hint">
                        Register a {p.name} app, then add its client ID/secret to your env.
                        {p.requirement && <> Requires: {p.requirement}.</>}
                        {' '}Redirect URI:
                        <code className="code-inline">{data.baseUrl}/api/oauth/{p.key}/callback</code>
                      </p>
                    </div>
                  ) : isConnected ? (
                    <>
                      <a className="btn btn-outline btn-block" href={`/api/oauth/${p.key}/start`}>Reconnect</a>
                      <button className="btn btn-outline" onClick={() => disconnect(conns[0].id)}>Disconnect</button>
                    </>
                  ) : (
                    <a className="btn btn-accent btn-block" href={`/api/oauth/${p.key}/start`}>Connect</a>
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
    <Suspense fallback={<p className="empty">Loading…</p>}>
      <Dashboard />
    </Suspense>
  );
}
