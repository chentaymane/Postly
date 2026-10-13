'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { PlatformIcon, NavIcon } from '../../../components/BrandIcons';
import PostEditor, { abilities } from '../../../components/PostEditor';
import {
  PLATFORM_COLORS, FORMAT_NAMES, platformName, timeOf, dayKey, dayLabel, dateLine,
  whenLong, relative, postTitle, slidesOf, statusOf, angleName,
} from '../../../components/postkit';

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

function Thumb({ post, size = 'md' }) {
  const slides = slidesOf(post);
  const src = post.image_url || slides[0] || post.product_image;
  return (
    <span className={`sch-thumb ${size}`}>
      {src
        /* eslint-disable-next-line @next/next/no-img-element */
        ? <img src={src} alt="" loading="lazy" />
        : <NavIcon name="inbox" size={18} />}
      {slides.length > 1 && <span className="sch-thumb-badge">{slides.length}</span>}
      {post.format === 'video' && <span className="sch-thumb-badge">▶</span>}
    </span>
  );
}

function PlatformLabel({ platform }) {
  return (
    <span className="sch-plat">
      <span className="sch-plat-icon" style={{ background: PLATFORM_COLORS[platform] }}>
        <PlatformIcon platform={platform} size={11} />
      </span>
      {platformName(platform)}
    </span>
  );
}

// One post on the timeline. The whole card opens it: one target, no small
// buttons to aim for.
function PostCard({ post, onOpen }) {
  const status = statusOf(post);
  const dim = post.status === 'skipped' || post.status === 'published';
  return (
    <button type="button" className={`sch-card${dim ? ' dim' : ''}`} onClick={() => onOpen(post)}>
      <Thumb post={post} />
      <span className="sch-body">
        <span className="sch-top">
          <PlatformLabel platform={post.platform} />
          <span className={`pill ${status.tone}`}>
            {status.busy ? <span className="spinner" /> : <span className="dot" />}{status.label}
          </span>
        </span>
        <span className="sch-title">{postTitle(post)}</span>
        <span className="sch-meta">
          {post.product_name || FORMAT_NAMES[post.format] || post.format}
          {angleName(post.recipe) && ` · ${angleName(post.recipe)}`}
          {post.status === 'published' && post.platform_post_url && ' · view on ' + platformName(post.platform)}
        </span>
      </span>
    </button>
  );
}

// A slot the automation has not written yet.
function PlannedCard({ item, busy, onWrite, onSkip }) {
  const writesAt = new Date(item.writes_at).getTime();
  const soon = writesAt <= Date.now();
  const blocked = item.blocked || [];
  const writable = item.platforms.some((p) => !blocked.some((b) => b.platform === p));

  // Nothing can be written for this slot at all: say so once, plainly, with
  // the fix, rather than offering actions that cannot work.
  if (!writable) {
    return (
      <div className="sch-card planned dim">
        <span className="sch-thumb md ghost"><NavIcon name="alert" size={18} /></span>
        <span className="sch-body">
          <span className="sch-top">
            <span className="sch-plats">{item.platforms.map(platformName).join(' + ')}</span>
            <span className="pill warn"><span className="dot" />Won’t post</span>
          </span>
          <span className="sch-title muted">
            {blocked.map((b) => `${platformName(b.platform)} ${b.reason}`).join(' · ')}.
          </span>
          <span className="sch-actions">
            <a className="link-btn" href="/connections">Connect accounts</a>
          </span>
        </span>
      </div>
    );
  }

  return (
    <div className="sch-card planned">
      <span className="sch-thumb md ghost">
        {busy ? <span className="spinner" /> : <NavIcon name="clock" size={18} />}
      </span>
      <span className="sch-body">
        <span className="sch-top">
          <span className="sch-plats">
            {item.platforms.map((p) => (
              <span key={p} className="sch-plat-icon" title={platformName(p)}
                    style={{ background: PLATFORM_COLORS[p] }}>
                <PlatformIcon platform={p} size={11} />
              </span>
            ))}
            {item.platforms.map(platformName).join(' + ')}
          </span>
          <span className="pill neutral">{busy ? 'Writing…' : 'Not written yet'}</span>
        </span>
        <span className="sch-title muted">
          {busy ? 'Writing the copy and artwork — this takes a minute or two.'
            : soon ? 'Being written on the next scheduler run.'
              : `Written automatically ${whenLong(item.writes_at)} — a day ahead.`}
        </span>
        {blocked.length > 0 && (
          <span className="sch-meta warn-text">
            {blocked.map((b) => `${platformName(b.platform)} ${b.reason}`).join(' · ')}
          </span>
        )}
        <span className="sch-meta">
          {item.automation_name} · {FORMAT_NAMES[item.format] || item.format}
          {item.approval === 'review' ? ' · needs your approval' : ''}
        </span>
        {!busy && (
          <span className="sch-actions">
            {writable && <button className="link-btn" onClick={onWrite}>Write it now</button>}
            <button className="link-btn muted" onClick={onSkip}>Skip this slot</button>
          </span>
        )}
      </span>
    </div>
  );
}

// Skip placeholders for one slot, shown once rather than once per platform.
function SkippedSlotCard({ group, busy, onRestore }) {
  return (
    <div className="sch-card planned dim">
      <span className="sch-thumb md ghost"><NavIcon name="alert" size={18} /></span>
      <span className="sch-body">
        <span className="sch-top">
          <span className="sch-plats">
            {group.platforms.map((p) => (
              <span key={p} className="sch-plat-icon" style={{ background: PLATFORM_COLORS[p] }}>
                <PlatformIcon platform={p} size={11} />
              </span>
            ))}
            {group.platforms.map(platformName).join(' + ')}
          </span>
          <span className="pill neutral"><span className="dot" />Skipped</span>
        </span>
        <span className="sch-title muted">{group.reason || 'Skipped by you — nothing goes out at this time.'}</span>
        <span className="sch-actions">
          <button className="link-btn" disabled={busy} onClick={onRestore}>
            {busy ? <span className="spinner" /> : 'Undo skip'}
          </button>
        </span>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Upcoming: a day-by-day timeline
// ---------------------------------------------------------------------------

function groupTimeline(items, { platform, automation }) {
  const visible = items.filter((it) => {
    if (automation && String(it.automation_id) !== String(automation)) return false;
    if (platform) {
      if (it.kind === 'planned') return it.platforms.includes(platform);
      return it.platform === platform;
    }
    return true;
  });

  // Skip placeholders for the same slot collapse into one card.
  const entries = [];
  const skipped = new Map();
  for (const it of visible) {
    if (it.kind === 'post' && it.status === 'skipped' && !it.caption && !it.pin_description && it.slot_key) {
      const key = `${it.automation_id}|${it.slot_key.split('|')[0]}`;
      if (!skipped.has(key)) {
        const group = {
          kind: 'skipped-slot', key, at: it.at, automation_id: it.automation_id,
          slot: it.slot_key.split('|')[0], platforms: [], reason: it.error_message,
        };
        skipped.set(key, group);
        entries.push(group);
      }
      skipped.get(key).platforms.push(it.platform);
      continue;
    }
    entries.push(it);
  }

  const days = new Map();
  for (const it of entries) {
    if (!it.at) continue;
    const dk = dayKey(it.at);
    if (!days.has(dk)) days.set(dk, new Map());
    const slots = days.get(dk);
    const tk = timeOf(it.at);
    if (!slots.has(tk)) slots.set(tk, { time: tk, at: it.at, items: [] });
    slots.get(tk).items.push(it);
  }
  return Array.from(days.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, slots]) => ({
      key,
      slots: Array.from(slots.values()).sort((x, y) => x.time.localeCompare(y.time)),
    }));
}

function SlotRow({ slot, now, renderItem }) {
  const past = new Date(slot.at).getTime() < now;
  return (
    <div className={`sch-slot${past ? ' past' : ''}`}>
      <div className="sch-time">
        <strong>{slot.time}</strong>
        <span>{relative(slot.at, now)}</span>
      </div>
      <div className="sch-cards">{slot.items.map(renderItem)}</div>
    </div>
  );
}

function Upcoming({ data, filters, setFilters, onOpen, onSlot, slotBusy }) {
  const [showEarlier, setShowEarlier] = useState(false);
  const now = Date.now();
  const todayKey = dayKey(new Date().toISOString());
  // Days before today are history, which the Published tab covers.
  const days = useMemo(() => {
    const list = groupTimeline(data.items, filters).filter((d) => d.key >= todayKey);
    // Today always shows, even empty, so the "now" line anchors the page.
    if (list[0]?.key !== todayKey) list.unshift({ key: todayKey, slots: [] });
    return list;
  }, [data.items, filters, todayKey]);

  const platforms = useMemo(() => {
    const s = new Set();
    for (const it of data.items) {
      if (it.kind === 'planned') it.platforms.forEach((p) => s.add(p));
      else if (it.platform) s.add(it.platform);
    }
    return Array.from(s).sort();
  }, [data.items]);

  const automation = filters.automation
    ? data.automations.find((a) => String(a.id) === String(filters.automation))
    : null;

  const renderItem = (it) => {
    if (it.kind === 'planned') {
      const key = `${it.automation_id}|${it.slot}`;
      return (
        <PlannedCard key={`p-${key}-${it.platforms.join()}`} item={it}
                     busy={slotBusy === key}
                     onWrite={() => onSlot(it, 'write')}
                     onSkip={() => onSlot(it, 'skip')} />
      );
    }
    if (it.kind === 'skipped-slot') {
      return (
        <SkippedSlotCard key={`s-${it.key}`} group={it} busy={slotBusy === it.key}
                         onRestore={() => onSlot(it, 'restore')} />
      );
    }
    return <PostCard key={`q-${it.id}`} post={it} onOpen={onOpen} />;
  };

  if (!data.items.some((it) => it.at && dayKey(it.at) >= todayKey)) {
    return (
      <div className="empty-state">
        <span className="empty-icon"><NavIcon name="calendar" size={26} /></span>
        <p className="empty-title">Nothing coming up</p>
        <p>
          Switch on an automation and its posts appear here a day before they go out —
          where you can read, change or skip each one.
        </p>
        <div className="head-actions">
          <a className="btn btn-accent" href="/automations">Set up an automation</a>
          <a className="btn btn-outline" href="/create">Create one post</a>
        </div>
      </div>
    );
  }

  return (
    <>
      {(platforms.length > 1 || automation) && (
        <div className="chip-row" role="group" aria-label="Filter">
          <button className={`chip${!filters.platform ? ' on' : ''}`}
                  onClick={() => setFilters({ ...filters, platform: null })}>All platforms</button>
          {platforms.map((p) => (
            <button key={p} className={`chip${filters.platform === p ? ' on' : ''}`}
                    onClick={() => setFilters({ ...filters, platform: filters.platform === p ? null : p })}>
              <PlatformIcon platform={p} size={12} /> {platformName(p)}
            </button>
          ))}
          {automation && (
            <button className="chip on" onClick={() => setFilters({ ...filters, automation: null })}
                    aria-label={`Stop showing only ${automation.name}`}>
              {automation.name} <span aria-hidden="true">×</span>
            </button>
          )}
        </div>
      )}

      {days.length === 1 && days[0].slots.length === 0 && (filters.platform || filters.automation) && (
        <p className="empty">Nothing matches this filter.</p>
      )}

      <div className="sch-days">
        {days.map((day) => {
          const isToday = day.key === todayKey;
          const earlier = isToday ? day.slots.filter((s) => new Date(s.at).getTime() < now) : [];
          const later = isToday ? day.slots.filter((s) => new Date(s.at).getTime() >= now) : day.slots;
          const count = day.slots.reduce((n, s) => n + s.items.length, 0);
          return (
            <section className="sch-day" key={day.key}>
              <header className="sch-day-head">
                <h2>{dayLabel(day.key)}</h2>
                <span className="sch-day-date">{dateLine(day.key)}</span>
                <span className="sch-day-count">{count} post{count === 1 ? '' : 's'}</span>
              </header>

              {earlier.length > 0 && (
                <>
                  <button className="sch-earlier" onClick={() => setShowEarlier(!showEarlier)}
                          aria-expanded={showEarlier}>
                    {showEarlier ? 'Hide' : 'Show'} earlier today
                    <span className="tab-count">{earlier.reduce((n, s) => n + s.items.length, 0)}</span>
                  </button>
                  {showEarlier && earlier.map((slot) => (
                    <SlotRow key={slot.time} slot={slot} now={now} renderItem={renderItem} />
                  ))}
                </>
              )}

              {isToday && (
                <div className="now-line" aria-label="Now">
                  <span>Now · {timeOf(new Date().toISOString())}</span>
                </div>
              )}

              {later.length === 0 && isToday && (
                <p className="empty sch-none">Nothing else today.</p>
              )}
              {later.map((slot) => (
                <SlotRow key={slot.time} slot={slot} now={now} renderItem={renderItem} />
              ))}
            </section>
          );
        })}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Needs you: drafts to approve, failures, unconfirmed publishes
// ---------------------------------------------------------------------------

function NeedsYou({ posts, onOpen, onApprove, approving }) {
  if (posts.length === 0) {
    return (
      <div className="empty-state">
        <span className="empty-icon"><NavIcon name="check" size={26} /></span>
        <p className="empty-title">All clear</p>
        <p>
          Nothing is waiting on you. Drafts to approve, posts that failed and publishes a
          platform never confirmed all land here.
        </p>
      </div>
    );
  }
  return (
    <div className="need-list">
      {posts.map((p) => {
        const status = statusOf(p);
        const can = abilities(p);
        const text = String(p.caption || p.pin_description || '').trim();
        return (
          <div className="need-card" key={p.id}>
            <button type="button" className="need-open" onClick={() => onOpen(p)}>
              <Thumb post={p} size="lg" />
              <span className="sch-body">
                <span className="sch-top">
                  <PlatformLabel platform={p.platform} />
                  <span className={`pill ${status.tone}`}>
                    {status.busy ? <span className="spinner" /> : <span className="dot" />}{status.label}
                  </span>
                </span>
                <span className="sch-title">{postTitle(p)}</span>
                {text && <span className="need-text">{text}</span>}
                <span className="sch-meta">
                  {p.scheduled_at ? `For ${whenLong(p.scheduled_at)}` : 'No time set'}
                  {p.product_name ? ` · ${p.product_name}` : ''}
                  {p.automation_name ? ` · ${p.automation_name}` : ''}
                </span>
                {p.error_message && p.status !== 'draft' && (
                  <span className="need-error">{p.error_message}</span>
                )}
              </span>
            </button>
            <div className="need-actions">
              {can.approve && (
                <button className="btn btn-accent btn-sm" disabled={approving === p.id}
                        onClick={() => onApprove(p)}>
                  {approving === p.id ? <span className="spinner" /> : 'Approve'}
                </button>
              )}
              <button className="btn btn-outline btn-sm" onClick={() => onOpen(p)}>
                {p.status === 'unconfirmed' ? 'Resolve' : can.edit ? 'Edit' : 'Open'}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Published
// ---------------------------------------------------------------------------

function Published({ posts, onOpen }) {
  if (!posts) {
    return (
      <div className="skeleton-stack">
        <div className="skeleton" style={{ height: 64 }} />
        <div className="skeleton" style={{ height: 64 }} />
      </div>
    );
  }
  if (posts.length === 0) {
    return (
      <div className="empty-state">
        <span className="empty-icon"><NavIcon name="history" size={26} /></span>
        <p className="empty-title">Nothing published yet</p>
        <p>Posts appear here once they are live, with a link to each one.</p>
      </div>
    );
  }
  return (
    <>
      <div className="pub-list">
        {posts.map((p) => (
          <div className="pub-row" key={p.id}>
            <button type="button" className="pub-open" onClick={() => onOpen(p)}>
              <Thumb post={p} size="sm" />
              <span className="pub-main">
                <span className="sch-title">{postTitle(p)}</span>
                <span className="sch-meta">
                  <PlatformLabel platform={p.platform} /> · {whenLong(p.at)}
                  {p.product_name ? ` · ${p.product_name}` : ''}
                </span>
              </span>
              <span className="pub-clicks"><strong>{p.clicks}</strong> click{p.clicks === 1 ? '' : 's'}</span>
            </button>
            {p.platform_post_url && (
              <a className="mini-link" href={p.platform_post_url} target="_blank" rel="noreferrer">View ↗</a>
            )}
          </div>
        ))}
      </div>
      <p className="hint">
        Every publish attempt, failures included, is in the <a href="/history">full log</a>.
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

// "today", "tomorrow", or the weekday, for the middle of a sentence.
function dayWord(iso) {
  const label = dayLabel(dayKey(iso));
  return ['Today', 'Tomorrow', 'Yesterday'].includes(label) ? label.toLowerCase() : label;
}

function StatusStrip({ data, onKick, kicking }) {
  const sched = data.scheduler || {};
  const now = Date.now();
  // What will actually go out next: a planned slot every platform of which
  // is blocked (not connected, wrong format) never will, and neither will a
  // post whose automation is paused.
  const goesOut = (it) => it.at && new Date(it.at).getTime() >= now - 60000
    && (it.kind === 'planned'
      ? it.platforms.some((p) => !(it.blocked || []).some((b) => b.platform === p))
      : ['scheduled', 'draft', 'generating'].includes(it.status) && !it.automation_paused);
  const next = data.items.find(goesOut);
  const sameSlot = next ? data.items.filter((it) => it.at === next.at && goesOut(it)) : [];
  const nextPlatforms = Array.from(new Set(sameSlot.flatMap((it) => (it.kind === 'planned' ? it.platforms : [it.platform]))));
  const nextProduct = sameSlot.find((it) => it.product_name)?.product_name;

  if (sched.neverRan || !sched.healthy) {
    return (
      <div className="health down">
        <span className="health-dot" />
        <span className="health-text">
          {sched.neverRan ? (
            <><strong>The scheduler has never run</strong>, so nothing is being written or posted.</>
          ) : (
            <>
              <strong>The scheduler missed {sched.missedAt ? whenLong(sched.missedAt) : 'its last run'}.</strong>{' '}
              Nothing is posted while it is stopped — check the cron job that calls Postly.
            </>
          )}
        </span>
        <button className="btn btn-outline btn-sm" onClick={onKick} disabled={kicking}>
          {kicking ? <span className="spinner" /> : 'Run it now'}
        </button>
      </div>
    );
  }

  return (
    <div className="next-strip">
      <span className="next-icon"><NavIcon name="clock" size={18} /></span>
      {next ? (
        <span className="next-text">
          Next post <strong>{relative(next.at)}</strong> — {dayWord(next.at)} at{' '}
          <strong>{timeOf(next.at)}</strong> on {nextPlatforms.map(platformName).join(' + ')}
          {nextProduct ? <> · <span className="next-product">{nextProduct}</span></> : null}
        </span>
      ) : (
        <span className="next-text">Nothing scheduled to go out.</span>
      )}
      <span className="next-health" title={sched.lastTickAt ? `Last run ${whenLong(sched.lastTickAt)}` : ''}>
        <span className="dot" /> Scheduler OK
      </span>
    </div>
  );
}

function SchedulePage() {
  const router = useRouter();
  const params = useSearchParams();
  const [tab, setTab] = useState(params.get('tab') === 'review' ? 'review'
    : params.get('tab') === 'published' ? 'published' : 'upcoming');
  const [data, setData] = useState(null);
  const [needs, setNeeds] = useState([]);
  const [published, setPublished] = useState(null);
  const [filters, setFilters] = useState({ platform: null, automation: params.get('automation') });
  const [open, setOpen] = useState(null);
  const [toast, setToast] = useState(null);
  const [slotBusy, setSlotBusy] = useState(null);
  const [approving, setApproving] = useState(null);
  const [kicking, setKicking] = useState(false);
  const toastTimer = useRef(null);
  const wantedPost = useRef(params.get('post'));

  const say = useCallback((message, undo) => {
    clearTimeout(toastTimer.current);
    setToast({ message, undo });
    toastTimer.current = setTimeout(() => setToast(null), undo ? 7000 : 3500);
  }, []);

  const load = useCallback(async () => {
    try {
      const [rs, rq] = await Promise.all([
        fetch('/api/schedule', { cache: 'no-store' }),
        fetch('/api/queue', { cache: 'no-store' }),
      ]);
      if (rs.status === 401) { router.push('/login'); return; }
      const s = await rs.json();
      const q = await rq.json();
      setData(s);
      setNeeds((q.posts || []).filter((p) => ['draft', 'failed', 'unconfirmed'].includes(p.status)));
    } catch { /* keep what is on screen; the next poll retries */ }
  }, [router]);

  const loadPublished = useCallback(() => {
    fetch('/api/queue?view=published', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setPublished(d.posts || []))
      .catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (tab === 'published') loadPublished(); }, [tab, loadPublished]);

  // Posts move on their own — written by the scheduler, sent at their minute —
  // so the page follows along. Faster while something is visibly in motion.
  const moving = data?.items?.some((it) => ['generating', 'publishing', 'retrying'].includes(it.status));
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, moving ? 10000 : 60000);
    return () => clearInterval(t);
  }, [moving, load]);

  // A link straight to one post (from the dashboard, say) opens it.
  useEffect(() => {
    if (!wantedPost.current || !data) return;
    const id = String(wantedPost.current);
    const found = data.items.find((it) => it.kind === 'post' && String(it.id) === id)
      || needs.find((p) => String(p.id) === id);
    if (found) setOpen(found);
    wantedPost.current = null;
  }, [data, needs]);

  // Keep the open sheet fed with the freshest copy of its post.
  const openPost = useMemo(() => {
    if (!open) return null;
    const fresh = data?.items?.find((it) => it.kind === 'post' && it.id === open.id)
      || needs.find((p) => p.id === open.id)
      || published?.find((p) => p.id === open.id);
    return fresh ? { ...open, ...fresh } : open;
  }, [open, data, needs, published]);

  const changed = useCallback((message, opts = {}) => {
    say(message, opts.undo ? async () => {
      await opts.undo();
      setToast(null);
      load();
    } : null);
    load();
    if (tab === 'published') loadPublished();
  }, [say, load, loadPublished, tab]);

  async function slotAction(item, action) {
    const key = item.kind === 'skipped-slot' ? item.key : `${item.automation_id}|${item.slot}`;
    setSlotBusy(key);
    try {
      const res = await fetch('/api/schedule/slot', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ automation_id: item.automation_id, slot: item.slot, action }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) {
        say(json.error || json.detail || 'That did not work — try again.');
      } else if (action === 'skip') {
        say(`Skipped ${whenLong(item.at)}`, async () => {
          await fetch('/api/schedule/slot', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ automation_id: item.automation_id, slot: item.slot, action: 'restore' }),
          });
          setToast(null);
          load();
        });
      } else if (action === 'restore') {
        say('Slot restored — it will be written a day ahead as usual');
      } else {
        say('Written — open it to read or change it');
      }
    } finally {
      setSlotBusy(null);
      load();
    }
  }

  async function approve(post) {
    setApproving(post.id);
    const res = await fetch(`/api/queue/${post.id}/approve`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    const json = await res.json().catch(() => ({}));
    setApproving(null);
    if (!res.ok || json.ok === false) { say(json.error || 'Could not approve it'); return; }
    say(json.status === 'scheduled' ? `Approved — goes out ${whenLong(json.scheduled_at)}` : 'Approved and posted');
    load();
  }

  async function kick() {
    setKicking(true);
    await fetch('/api/scheduler?force=1', { method: 'POST' }).catch(() => {});
    setKicking(false);
    load();
  }

  const upcomingCount = data
    ? data.items.filter((it) => it.at && new Date(it.at).getTime() >= Date.now()
        && (it.kind === 'planned' ? true : ['scheduled', 'draft', 'generating'].includes(it.status))).length
    : 0;

  return (
    <>
      <div className="page-head">
        <div className="head-row">
          <div>
            <h1>Schedule</h1>
            <p>
              Every post coming up. Automations write them a day ahead, so you can read,
              change or skip any of them before it goes out.
            </p>
          </div>
          <a className="btn btn-accent" href="/create">Create post</a>
        </div>
      </div>

      {data && <StatusStrip data={data} onKick={kick} kicking={kicking} />}

      <div className="tabs" role="tablist">
        {[
          ['upcoming', 'Upcoming', upcomingCount],
          ['review', 'Needs you', needs.length],
          ['published', 'Published', null],
        ].map(([key, label, count]) => (
          <button key={key} role="tab" aria-selected={tab === key}
                  className={`tab${tab === key ? ' active' : ''}${key === 'review' && count > 0 ? ' attention' : ''}`}
                  onClick={() => setTab(key)}>
            {label} {count > 0 && <span className="tab-count">{count}</span>}
          </button>
        ))}
      </div>

      {!data ? (
        <div className="skeleton-stack">
          <div className="skeleton" style={{ height: 90 }} />
          <div className="skeleton" style={{ height: 90 }} />
          <div className="skeleton" style={{ height: 90 }} />
        </div>
      ) : tab === 'upcoming' ? (
        <Upcoming data={data} filters={filters} setFilters={setFilters}
                  onOpen={setOpen} onSlot={slotAction} slotBusy={slotBusy} />
      ) : tab === 'review' ? (
        <NeedsYou posts={needs} onOpen={setOpen} onApprove={approve} approving={approving} />
      ) : (
        <Published posts={published} onOpen={setOpen} />
      )}

      {openPost && (
        <PostEditor post={openPost} products={data?.products || []}
                    onClose={() => setOpen(null)} onChanged={changed} />
      )}

      {toast && (
        <div className="toast" role="status">
          <span>{toast.message}</span>
          {toast.undo && <button className="toast-action" onClick={toast.undo}>Undo</button>}
        </div>
      )}
    </>
  );
}

export default function SchedulePageWrapper() {
  return (
    <Suspense fallback={<div className="skeleton" style={{ height: 240 }} />}>
      <SchedulePage />
    </Suspense>
  );
}
