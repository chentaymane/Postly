'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

function Dashboard() {
  const [data, setData] = useState({ platforms: [], connections: [] });
  const [loading, setLoading] = useState(true);
  const params = useSearchParams();
  const connected = params.get('connected');
  const error = params.get('error');

  async function load() {
    setLoading(true);
    const res = await fetch('/api/connections', { cache: 'no-store' });
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
                      <div className="account-line" key={c.id}>
                        <span>@{c.account_name || c.account_id}</span>
                        {c.board_name && <span>· board: {c.board_name}</span>}
                      </div>
                    ))}
                  </div>
                )}

                <div className="card-foot">
                  {!p.enabled ? (
                    <button className="btn btn-outline btn-block" disabled>Not available yet</button>
                  ) : !p.configured ? (
                    <button className="btn btn-outline btn-block" disabled title="Add client ID/secret to .env.local">
                      Needs app setup
                    </button>
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
