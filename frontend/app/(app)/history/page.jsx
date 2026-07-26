'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PlatformIcon } from '../../../components/BrandIcons';

export default function HistoryPage() {
  const [posts, setPosts] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    fetch('/api/history', { cache: 'no-store' })
      .then((r) => (r.status === 401 ? (router.push('/login'), null) : r.json()))
      .then((d) => {
        if (!d) return;
        setPosts(d.posts || []);
        setError(d.error || null);
        setLoading(false);
      })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, []);

  const okCount = posts.filter((p) => p.status === 'success').length;

  return (
    <>
      <div className="page-head">
        <h1>Post History</h1>
        <p>
          Every publish attempt with its status and any error returned by the platform.
          {posts.length > 0 && ` ${okCount} of ${posts.length} published successfully.`}
        </p>
      </div>

      {error && <div className="notice err"><strong>!</strong><span>Could not load history: {error}</span></div>}

      {loading ? (
        <div className="history">
          {[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 112 }} />)}
        </div>
      ) : posts.length === 0 ? (
        <div className="empty-state">
          <h3>No posts yet</h3>
          <p>Once you publish, every attempt shows up here with full details.</p>
          <a className="btn btn-accent" href="/create">Create your first post</a>
        </div>
      ) : (
        <div className="history">
          {posts.map((p) => (
            <div className="history-item" key={p.id}>
              {p.image_url ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img className="history-thumb" src={p.image_url} alt="" loading="lazy" />
              ) : (
                <div className="history-thumb placeholder">—</div>
              )}
              <div className="history-body">
                <div className="history-meta">
                  <span className={`pill ${p.status === 'success' ? 'connected' : 'failed'}`}>
                    <span className="dot" />{p.status === 'success' ? 'Published' : 'Failed'}
                  </span>
                  <span className="history-platform">
                    <PlatformIcon platform={p.platform} size={15} /> {p.platform}
                  </span>
                  <span className="history-time">{new Date(p.created_at).toLocaleString()}</span>
                </div>

                <p className="history-caption">{p.caption || p.theme}</p>
                {p.hashtags && <p className="history-tags">{p.hashtags}</p>}
                {p.error_message && <p className="history-error">{p.error_message}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
