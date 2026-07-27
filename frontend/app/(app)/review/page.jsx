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
  const [whenDate, setWhenDate] = useState('');
  const [whenHour, setWhenHour] = useState('10');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const isPinterest = post.platform === 'pinterest';
  // Local date + a plain 0-23 hour, combined into one timestamp.
  const when = whenDate ? `${whenDate}T${whenHour.padStart(2, '0')}:00` : '';

  async function saveSilently() {
    await fetch(`/api/queue/${post.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(edit),
    }).catch(() => {});
  }

  async function publish(scheduled) {
    setBusy(scheduled ? 'schedule' : 'publish'); setError(null);
    await saveSilently();
    const res = await fetch(`/api/queue/${post.id}/publish`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(scheduled && when ? { when: new Date(when).toISOString() } : {}),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) { setError(json.error || 'publish failed'); setBusy(null); return; }
    onChanged(scheduled ? 'Post scheduled ✓' : 'Post published ✓');
  }

  async function remove() {
    if (!confirm('Delete this draft?')) return;
    setBusy('delete');
    await fetch(`/api/queue/${post.id}`, { method: 'DELETE' });
    onChanged('Draft deleted');
  }

  return (
    <div className="review-card">
      <div className="review-media">
        {post.image_url && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img className="review-img" src={post.image_url} alt="Generated post image" />
        )}
        {Array.isArray(post.image_urls) && post.image_urls.length > 1 && (
          <div className="slide-strip">
            {post.image_urls.map((u, i) => (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img key={i} className="slide-thumb" src={u} alt={`Slide ${i + 1}`} />
            ))}
          </div>
        )}
      </div>
      <div className="review-body">
        <div className="review-head">
          <span className="platform-chip" style={{ background: PLATFORM_COLORS[post.platform] }}>
            <PlatformIcon platform={post.platform} size={13} /> {post.platform}
          </span>
          {Array.isArray(post.image_urls) && post.image_urls.length > 1 && (
            <span className="pill soon">{post.image_urls.length} slides</span>
          )}
          {post.status === 'failed' ? (
            <span className="pill disconnected"><span className="dot" />Failed</span>
          ) : (
            <span className="pill disconnected"><span className="dot" />Draft</span>
          )}
        </div>

        {post.error_message && <div className="notice err">{post.error_message}</div>}
        {error && <div className="notice err">{error}</div>}

        {isPinterest && (
          <div className="field">
            <label htmlFor={`t-${post.id}`}>Pin title</label>
            <input id={`t-${post.id}`} value={edit.pin_title}
                   onChange={(e) => setEdit({ ...edit, pin_title: e.target.value })} />
          </div>
        )}
        <div className="field">
          <label htmlFor={`c-${post.id}`}>{isPinterest ? 'Pin description' : 'Caption'}</label>
          <textarea id={`c-${post.id}`} rows={isPinterest ? 4 : 5}
                    value={isPinterest ? edit.pin_description : edit.caption}
                    onChange={(e) => setEdit(isPinterest
                      ? { ...edit, pin_description: e.target.value }
                      : { ...edit, caption: e.target.value })} />
        </div>
        {!isPinterest && (
          <>
            <div className="field">
              <label htmlFor={`cta-${post.id}`}>Call to action</label>
              <input id={`cta-${post.id}`} value={edit.cta}
                     onChange={(e) => setEdit({ ...edit, cta: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor={`h-${post.id}`}>Hashtags</label>
              <textarea id={`h-${post.id}`} rows={2} value={edit.hashtags}
                        onChange={(e) => setEdit({ ...edit, hashtags: e.target.value })} />
            </div>
          </>
        )}

        <div className="review-actions">
          <button className="btn btn-accent" disabled={!!busy} onClick={() => publish(false)}>
            {busy === 'publish' ? <span className="spinner" /> : 'Publish now'}
          </button>
          <div className="schedule-group">
            <label className="sr-only" htmlFor={`wd-${post.id}`}>Schedule date</label>
            <input id={`wd-${post.id}`} type="date" value={whenDate}
                   onChange={(e) => setWhenDate(e.target.value)} />
            <label className="sr-only" htmlFor={`wh-${post.id}`}>Schedule hour (0-23)</label>
            <select id={`wh-${post.id}`} value={whenHour}
                    onChange={(e) => setWhenHour(e.target.value)}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={String(h)}>{String(h).padStart(2, '0')}:00</option>
              ))}
            </select>
            <button className="btn btn-outline" disabled={!!busy || !when} onClick={() => publish(true)}>
              {busy === 'schedule' ? <span className="spinner" /> : 'Schedule'}
            </button>
          </div>
          <button className="btn btn-ghost" disabled={!!busy} onClick={remove}>Delete</button>
        </div>
      </div>
    </div>
  );
}

function ScheduledRow({ post, onChanged }) {
  const [busy, setBusy] = useState(false);
  async function cancel() {
    if (!confirm('Cancel this scheduled post? It returns to drafts.')) return;
    setBusy(true);
    await fetch(`/api/queue/${post.id}/cancel`, { method: 'POST' });
    onChanged('Schedule cancelled — back in drafts');
  }
  const t = new Date(post.scheduled_at);
  return (
    <div className="sched-row">
      {post.image_url && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img className="sched-thumb" src={post.image_url} alt="" />
      )}
      <span className="sched-time">{t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}</span>
      <span className="platform-chip" style={{ background: PLATFORM_COLORS[post.platform] }}>
        <PlatformIcon platform={post.platform} size={13} /> {post.platform}
      </span>
      <span className="sched-caption">{(post.pin_title || post.caption || post.theme || '').slice(0, 90)}</span>
      <button className="btn btn-ghost" disabled={busy} onClick={cancel}>
        {busy ? <span className="spinner" /> : 'Cancel'}
      </button>
    </div>
  );
}

function groupByDay(posts) {
  const groups = new Map();
  for (const p of posts) {
    const d = new Date(p.scheduled_at);
    const key = d.toDateString();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  return Array.from(groups.entries()).map(([key, items]) => {
    const d = new Date(key);
    const today = new Date(); const tomorrow = new Date(); tomorrow.setDate(today.getDate() + 1);
    const label = d.toDateString() === today.toDateString() ? 'Today'
      : d.toDateString() === tomorrow.toDateString() ? 'Tomorrow'
      : d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
    return { label, items: items.sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at)) };
  });
}

export default function ReviewPage() {
  const [posts, setPosts] = useState([]);
  const [tab, setTab] = useState('drafts');
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const router = useRouter();

  const load = useCallback((message) => {
    if (message) { setToast(message); setTimeout(() => setToast(null), 3500); }
    fetch('/api/queue', { cache: 'no-store' })
      .then((r) => { if (r.status === 401) { router.push('/login'); return null; } return r.json(); })
      .then((d) => { if (!d) return; setPosts(d.posts || []); setLoading(false); });
  }, [router]);

  useEffect(() => { load(); }, [load]);

  const drafts = posts.filter((p) => p.status === 'draft' || p.status === 'failed');
  const scheduled = posts.filter((p) => p.status === 'scheduled' && p.scheduled_at);
  const groups = groupByDay(scheduled);

  return (
    <>
      <div className="page-head">
        <h1>Review &amp; Plan</h1>
        <p>Approve drafts before they go live, and keep an eye on everything scheduled.</p>
      </div>

      {toast && <div className="toast" role="status">{toast}</div>}

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'drafts'}
                className={`tab${tab === 'drafts' ? ' active' : ''}`}
                onClick={() => setTab('drafts')}>
          Drafts {drafts.length > 0 && <span className="tab-count">{drafts.length}</span>}
        </button>
        <button role="tab" aria-selected={tab === 'scheduled'}
                className={`tab${tab === 'scheduled' ? ' active' : ''}`}
                onClick={() => setTab('scheduled')}>
          Scheduled {scheduled.length > 0 && <span className="tab-count">{scheduled.length}</span>}
        </button>
      </div>

      {loading ? (
        <div className="skeleton" style={{ height: 220 }} />
      ) : tab === 'drafts' ? (
        drafts.length === 0 ? (
          <div className="empty-state">
            <p className="empty-title">No drafts waiting</p>
            <p className="empty">Generate content and it lands here for your approval first.</p>
            <a className="btn btn-accent" href="/create">Create a post</a>
          </div>
        ) : (
          <div className="review-list">
            {drafts.map((p) => <DraftCard key={p.id} post={p} onChanged={load} />)}
          </div>
        )
      ) : scheduled.length === 0 ? (
        <div className="empty-state">
          <p className="empty-title">Nothing scheduled yet</p>
          <p className="empty">Approve a draft with a date, or enable Autopilot in Settings.</p>
          <a className="btn btn-outline" href="/settings">Open Settings</a>
        </div>
      ) : (
        <div className="sched-groups">
          {groups.map((g) => (
            <section key={g.label}>
              <h2 className="sched-day">{g.label}</h2>
              {g.items.map((p) => <ScheduledRow key={p.id} post={p} onChanged={load} />)}
            </section>
          ))}
        </div>
      )}
    </>
  );
}
