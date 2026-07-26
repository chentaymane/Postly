'use client';

import { useEffect, useState } from 'react';

export default function HistoryPage() {
  const [posts, setPosts] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/history', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { setPosts(d.posts || []); setError(d.error || null); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, []);

  return (
    <>
      <div className="page-head">
        <h1>Post History</h1>
        <p>Every publish attempt, with status and any error returned by the platform.</p>
      </div>

      {error && <div className="notice err">Could not load history: {error}</div>}

      {loading ? (
        <p className="empty">Loading…</p>
      ) : posts.length === 0 ? (
        <p className="empty">No posts yet. <a href="/create">Create your first post →</a></p>
      ) : (
        <div className="history">
          {posts.map((p) => (
            <div className="history-item" key={p.id}>
              {p.image_url ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img className="history-thumb" src={p.image_url} alt="" />
              ) : (
                <div className="history-thumb placeholder">—</div>
              )}
              <div className="history-body">
                <div className="history-meta">
                  <span className={`pill ${p.status === 'success' ? 'connected' : 'disconnected'}`}>
                    <span className="dot" />{p.status}
                  </span>
                  <strong style={{ textTransform: 'capitalize' }}>{p.platform}</strong>
                  <span className="empty">{new Date(p.created_at).toLocaleString()}</span>
                </div>
                <p className="history-caption">{p.caption || p.theme}</p>
                {p.hashtags && <p className="preview-tags">{p.hashtags}</p>}
                {p.error_message && <p className="history-error">{p.error_message}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
