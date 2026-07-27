'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { PlatformIcon } from '../../../components/BrandIcons';

const PLATFORM_COLORS = {
  pinterest: '#E60023', instagram: '#E4405F', facebook: '#1877F2',
  x: '#000000', linkedin: '#0A66C2', tiktok: '#010101',
};

function DraftCard({ post, onChanged }) {
  const [edit, setEdit] = useState({
    caption: post.caption || '', hashtags: post.hashtags || '', cta: post.cta || '',
    pin_title: post.pin_title || '', pin_description: post.pin_description || '',
  });
  const [when, setWhen] = useState('');
  const [busy, setBusy] = useState(null); // 'save' | 'publish' | 'schedule' | 'delete'
  const [error, setError] = useState(null);
  const isPinterest = post.platform === 'pinterest';
  const isScheduled = post.status === 'scheduled';

  async function save() {
    setBusy('save'); setError(null);
    const res = await fetch(`/api/queue/${post.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(edit),
    });
    if (!res.ok) setError((await res.json()).error || 'save failed');
    setBusy(null);
  }

  async function publish(scheduled) {
    setBusy(scheduled ? 'schedule' : 'publish'); setError(null);
    await save0();
    const res = await fetch(`/api/queue/${post.id}/publish`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(scheduled && when ? { when: new Date(when).toISOString() } : {}),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) { setError(json.error || 'publish failed'); setBusy(null); return; }
    setBusy(null);
    onChanged();
  }

  // Persist edits silently before publishing so what you see is what goes out.
  async function save0() {
    await fetch(`/api/queue/${post.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(edit),
    }).catch(() => {});
  }

  async function remove() {
    if (!confirm('Delete this draft?')) return;
    setBusy('delete');
    await fetch(`/api/queue/${post.id}`, { method: 'DELETE' });
    setBusy(null);
    onChanged();
  }

  return (
    <div className="review-card">
      {post.image_url && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img className="review-img" src={post.image_url} alt="Generated post image" />
      )}
      <div className="review-body">
        <div className="review-head">
          <span className="platform-chip" style={{ background: PLATFORM_COLORS[post.platform] }}>
            <PlatformIcon platform={post.platform} size={13} /> {post.platform}
          </span>
          {isScheduled ? (
            <span className="pill soon">Scheduled · {new Date(post.scheduled_at).toLocaleString()}</span>
          ) : post.status === 'failed' ? (
            <span className="pill disconnected"><span className="dot" />Failed</span>
          ) : (
            <span className="pill disconnected"><span className="dot" />Draft</span>
          )}
        </div>

        {post.error_message && <div className="notice err">{post.error_message}</div>}
        {error && <div className="notice err">{error}</div>}

        {!isScheduled && (
          <>
            {isPinterest && (
              <div className="field">
                <label>Pin title</label>
                <input value={edit.pin_title}
                       onChange={(e) => setEdit({ ...edit, pin_title: e.target.value })} />
              </div>
            )}
            <div className="field">
              <label>{isPinterest ? 'Pin description' : 'Caption'}</label>
              <textarea rows={isPinterest ? 4 : 5}
                        value={isPinterest ? edit.pin_description : edit.caption}
                        onChange={(e) => setEdit(isPinterest
                          ? { ...edit, pin_description: e.target.value }
                          : { ...edit, caption: e.target.value })} />
            </div>
            {!isPinterest && (
              <>
                <div className="field">
                  <label>Call to action</label>
                  <input value={edit.cta} onChange={(e) => setEdit({ ...edit, cta: e.target.value })} />
                </div>
                <div className="field">
                  <label>Hashtags</label>
                  <textarea rows={2} value={edit.hashtags}
                            onChange={(e) => setEdit({ ...edit, hashtags: e.target.value })} />
                </div>
              </>
            )}

            <div className="review-actions">
              <button className="btn btn-accent" disabled={!!busy} onClick={() => publish(false)}>
                {busy === 'publish' ? <span className="spinner" /> : 'Publish now'}
              </button>
              <div className="schedule-group">
                <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
                <button className="btn btn-outline" disabled={!!busy || !when} onClick={() => publish(true)}>
                  {busy === 'schedule' ? <span className="spinner" /> : 'Schedule'}
                </button>
              </div>
              <button className="btn btn-ghost" disabled={!!busy} onClick={remove}>Delete</button>
            </div>
          </>
        )}
        {isScheduled && (
          <p className="empty">This post is queued — the platform will publish it automatically.</p>
        )}
      </div>
    </div>
  );
}

export default function ReviewPage() {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const load = useCallback(() => {
    fetch('/api/queue', { cache: 'no-store' })
      .then((r) => { if (r.status === 401) { router.push('/login'); return null; } return r.json(); })
      .then((d) => { if (!d) return; setPosts(d.posts || []); setLoading(false); });
  }, [router]);

  useEffect(() => { load(); }, [load]);

  return (
    <>
      <div className="page-head">
        <h1>Review</h1>
        <p>Approve, edit, schedule, or delete generated posts before they go live.</p>
      </div>
      {loading ? (
        <p className="empty">Loading…</p>
      ) : posts.length === 0 ? (
        <p className="empty">Nothing waiting for review. <a href="/create">Generate a post →</a></p>
      ) : (
        <div className="review-list">
          {posts.map((p) => <DraftCard key={`${p.id}-${p.status}`} post={p} onChanged={load} />)}
        </div>
      )}
    </>
  );
}
