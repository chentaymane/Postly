'use client';

import { useEffect, useRef, useState } from 'react';
import { PlatformIcon, NavIcon } from './BrandIcons';
import {
  PLATFORM_COLORS, FORMAT_NAMES, platformName, statusOf, slidesOf, whenLong, relative, angleName,
} from './postkit';

const FIELDS = ['caption', 'hashtags', 'cta', 'pin_title', 'pin_description'];

function fieldsOf(post) {
  return Object.fromEntries(FIELDS.map((k) => [k, post[k] || '']));
}

// What can still be done to a post, from its state alone.
export function abilities(post) {
  const s = post.status;
  const held = s === 'scheduled' && post.delivery === 'postly' && !post.published_post_id;
  return {
    edit: held || ['draft', 'failed', 'unconfirmed'].includes(s),
    rewrite: held || s === 'draft' || s === 'failed',
    approve: s === 'draft' && !(post.format === 'video' && !post.video_url),
    postNow: (held || s === 'draft' || s === 'failed') && !(post.format === 'video' && !post.video_url),
    skip: ['draft', 'scheduled', 'failed', 'unconfirmed'].includes(s),
    unskip: s === 'skipped',
    resolve: s === 'unconfirmed',
    held,
  };
}

// The side sheet for one post: see it as it will go out, change the words,
// re-roll it, swap the product, or decide its fate — post now, skip, approve.
export default function PostEditor({ post: initial, products = [], onClose, onChanged }) {
  const [post, setPost] = useState(initial);
  const [fields, setFields] = useState(fieldsOf(initial));
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [slide, setSlide] = useState(0);
  const closeRef = useRef(null);

  // A reload from the page brings a fresher copy of the same post. Take it,
  // unless there are unsaved edits that it would wipe.
  const dirty = FIELDS.some((k) => (fields[k] || '') !== (post[k] || ''));
  useEffect(() => {
    if (initial.id !== post.id || (!dirty && initial.updated_at !== post.updated_at)) {
      setPost(initial);
      setFields(fieldsOf(initial));
      setSlide(0);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const can = abilities(post);
  const status = statusOf(post);
  const isPinterest = post.platform === 'pinterest';
  const isVideo = post.format === 'video';
  const slides = slidesOf(post);
  const media = slides.length ? slides : [post.image_url].filter(Boolean);
  const shown = media[Math.min(slide, media.length - 1)] || null;
  const future = post.scheduled_at && new Date(post.scheduled_at).getTime() > Date.now() + 60000;
  const name = platformName(post.platform);

  async function call(kind, url, init = {}) {
    setBusy(kind); setError(null);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        ...init,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) {
        setError(json.error || json.message || 'That did not work — try again.');
        return null;
      }
      return json;
    } catch {
      setError('Could not reach Postly — check your connection.');
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function save({ quiet = false } = {}) {
    if (!dirty) return true;
    const json = await call('save', `/api/queue/${post.id}`, {
      method: 'PATCH', body: JSON.stringify(fields),
    });
    if (!json) return false;
    setPost({ ...post, ...json.post });
    if (!quiet) onChanged('Changes saved');
    return true;
  }

  async function rewrite(mode, productId) {
    const body = { mode };
    if (productId !== undefined) body.product_id = productId;
    const json = await call(productId !== undefined ? 'product' : mode, `/api/queue/${post.id}/regenerate`, {
      body: JSON.stringify(body),
    });
    if (!json) return;
    const next = { ...post, ...json.post };
    if (productId !== undefined) {
      next.product_name = products.find((p) => String(p.id) === String(productId))?.name || null;
    }
    setPost(next);
    setFields(fieldsOf(next));
    setSlide(0);
    onChanged(next.recipe && json.remadeImages
      ? `Rewritten — ${angleName(next.recipe) || 'new version'}`
      : json.remadeImages ? 'New picture and text are in' : 'Text rewritten');
  }

  async function changeProduct(value) {
    const id = value ? Number(value) : null;
    const label = products.find((p) => String(p.id) === String(value))?.name || 'no particular product';
    if (!confirm(`Re-write this post about ${label}? The picture and text are made again.`)) return;
    await rewrite('all', id);
  }

  async function postNow() {
    if (!confirm(`Post this to ${name} now?`)) return;
    if (!(await save({ quiet: true }))) return;
    const json = await call('post', `/api/queue/${post.id}/publish`, { body: '{}' });
    if (json) { onChanged(`Posted to ${name}`); onClose(); }
  }

  async function approve() {
    if (!(await save({ quiet: true }))) return;
    const json = await call('approve', `/api/queue/${post.id}/approve`, { body: '{}' });
    if (!json) return;
    onChanged(json.status === 'scheduled'
      ? `Approved — goes out ${whenLong(json.scheduled_at)}`
      : `Posted to ${name}`);
    onClose();
  }

  async function skip() {
    const json = await call('skip', `/api/queue/${post.id}/skip`, { body: '{}' });
    if (!json) return;
    onChanged('Post skipped', {
      undo: () => fetch(`/api/queue/${post.id}/skip`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ undo: true }),
      }),
    });
    onClose();
  }

  async function unskip() {
    const json = await call('unskip', `/api/queue/${post.id}/skip`, {
      body: JSON.stringify({ undo: true }),
    });
    if (json) { onChanged('Post restored'); onClose(); }
  }

  async function resolve(force) {
    const json = await call(force ? 'force' : 'check', `/api/queue/${post.id}/confirm`, {
      body: JSON.stringify(force ? { force: true } : {}),
    });
    if (!json) return;
    if (json.status === 'published') { onChanged('Marked as published'); onClose(); return; }
    if (json.status === 'draft') { onChanged(json.message || 'Not published — back in drafts'); onClose(); return; }
    setError(json.message || `Could not reach ${name} to check.`);
  }

  const set = (k) => (e) => setFields({ ...fields, [k]: e.target.value });
  const anyBusy = Boolean(busy);
  const rewriting = busy === 'text' || busy === 'all' || busy === 'product';

  return (
    <div className="sheet-scrim" onClick={onClose}>
      <aside className="sheet" role="dialog" aria-modal="true" aria-label="Post details"
             onClick={(e) => e.stopPropagation()}>
        <header className="sheet-head">
          <span className="sheet-platform" style={{ background: PLATFORM_COLORS[post.platform] }}>
            <PlatformIcon platform={post.platform} size={16} />
          </span>
          <div className="sheet-heading">
            <p className="sheet-when">
              {post.status === 'published' ? 'Posted ' : ''}
              {whenLong(post.at || post.scheduled_at) || 'No time set'}
            </p>
            <p className="sheet-sub">
              {name}
              {post.format && ` · ${FORMAT_NAMES[post.format] || post.format}`}
              {angleName(post.recipe) && ` · ${angleName(post.recipe)}`}
              {post.scheduled_at && post.status !== 'published' && ` · ${relative(post.scheduled_at)}`}
            </p>
          </div>
          <span className={`pill ${status.tone}`}>
            {status.busy ? <span className="spinner" /> : <span className="dot" />}{status.label}
          </span>
          <button className="sheet-close" ref={closeRef} onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className="sheet-body">
          {post.status === 'skipped' && post.error_message && (
            <div className="notice"><span className="notice-body">{post.error_message}</span></div>
          )}
          {post.status === 'unconfirmed' && (
            <div className="notice warn">
              <span className="notice-icon"><NavIcon name="alert" size={16} /></span>
              <span className="notice-body">
                {name} never confirmed this one. Look at your account: if it is there, mark it
                live — posting again would make a duplicate.
              </span>
            </div>
          )}
          {post.status === 'failed' && post.error_message && (
            <div className={`notice ${status.label === 'Retrying' ? 'warn' : 'err'}`}>
              <span className="notice-icon"><NavIcon name="alert" size={16} /></span>
              <span className="notice-body">
                {post.error_message}
                {status.label === 'Retrying' && <> — trying again {relative(post.next_attempt_at)}.</>}
              </span>
            </div>
          )}
          {post.automation_paused && post.status === 'scheduled' && (
            <div className="notice">
              <span className="notice-icon"><NavIcon name="clock" size={16} /></span>
              <span className="notice-body">
                Its automation is paused, so this will not go out unless you resume it before{' '}
                {whenLong(post.scheduled_at)} — or post it yourself now.
              </span>
            </div>
          )}
          {post.status === 'scheduled' && !can.held && (
            <div className="notice">
              <span className="notice-body">
                {name} is holding this one and releases it at its time. To change it, skip it
                and write a new post.
              </span>
            </div>
          )}

          <div className="sheet-media">
            {isVideo && post.video_url ? (
              <video className="sheet-img" src={post.video_url} poster={post.image_url || undefined}
                     controls playsInline preload="metadata" />
            ) : shown ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img className="sheet-img" src={shown} alt={`${name} post image`} />
            ) : (
              <div className="sheet-img empty"><NavIcon name="inbox" size={28} /></div>
            )}
            {rewriting && (
              <div className="sheet-media-busy"><span className="spinner" /> Writing it again…</div>
            )}
            {media.length > 1 && (
              <div className="slide-strip" role="tablist" aria-label="Slides">
                {media.map((u, i) => (
                  <button key={u + i} className={`slide-btn${i === slide ? ' active' : ''}`}
                          onClick={() => setSlide(i)} aria-label={`Slide ${i + 1}`}
                          aria-selected={i === slide} role="tab">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={u} alt="" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {(can.rewrite && products.length > 0) ? (
            <div className="field">
              <label htmlFor="pe-product">About</label>
              <select id="pe-product" value={post.product_id || ''} disabled={anyBusy}
                      onChange={(e) => changeProduct(e.target.value)}>
                <option value="">No particular product</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}{p.enabled ? '' : ' (paused)'}</option>
                ))}
              </select>
              <p className="hint">Pick another product and the post is written again about it.</p>
            </div>
          ) : post.product_name ? (
            <p className="sheet-product"><NavIcon name="inbox" size={14} /> {post.product_name}</p>
          ) : null}

          {isPinterest && (
            <div className="field">
              <label htmlFor="pe-title">Pin title</label>
              <input id="pe-title" value={fields.pin_title} onChange={set('pin_title')}
                     readOnly={!can.edit} maxLength={100} />
            </div>
          )}
          <div className="field">
            <label htmlFor="pe-text">{isPinterest ? 'Pin description' : 'Caption'}</label>
            <textarea id="pe-text" rows={isPinterest ? 5 : 7} readOnly={!can.edit}
                      value={isPinterest ? fields.pin_description : fields.caption}
                      onChange={set(isPinterest ? 'pin_description' : 'caption')} />
          </div>
          {!isPinterest && (
            <>
              <div className="field">
                <label htmlFor="pe-cta">Call to action</label>
                <input id="pe-cta" value={fields.cta} onChange={set('cta')} readOnly={!can.edit} />
              </div>
              <div className="field">
                <label htmlFor="pe-tags">Hashtags</label>
                <textarea id="pe-tags" rows={2} value={fields.hashtags} onChange={set('hashtags')}
                          readOnly={!can.edit} />
              </div>
            </>
          )}

          {can.rewrite && (
            <div className="sheet-rewrite">
              <span className="sheet-rewrite-label">Not quite right?</span>
              <button className="btn btn-outline btn-sm" disabled={anyBusy} onClick={() => rewrite('text')}
                      title={post.recipe ? 'Same angle, new words — the slides are redrawn with them' : 'New words, same picture'}>
                {busy === 'text' ? <span className="spinner" /> : 'Rewrite'}
              </button>
              {!isVideo && (
                <button className="btn btn-outline btn-sm" disabled={anyBusy} onClick={() => rewrite('all')}
                        title={post.recipe ? 'A different creative angle on the same product' : 'New picture and new words'}>
                  {busy === 'all' ? <span className="spinner" /> : post.recipe ? 'Try another angle' : 'New picture + text'}
                </button>
              )}
            </div>
          )}

          {post.platform_post_url && (
            <a className="btn btn-outline" href={post.platform_post_url} target="_blank" rel="noreferrer">
              View on {name} ↗
            </a>
          )}

          {error && <div className="notice err" role="alert"><span className="notice-body">{error}</span></div>}
        </div>

        <footer className="sheet-foot">
          {can.edit && dirty && (
            <button className="btn btn-accent" disabled={anyBusy} onClick={() => save()}>
              {busy === 'save' ? <span className="spinner" /> : 'Save changes'}
            </button>
          )}
          {can.approve && (
            <button className={`btn ${dirty ? 'btn-outline' : 'btn-accent'}`} disabled={anyBusy} onClick={approve}>
              {busy === 'approve' ? <span className="spinner" />
                : future ? `Approve for ${whenLong(post.scheduled_at)}` : 'Approve & post'}
            </button>
          )}
          {can.resolve && (
            <>
              <button className="btn btn-accent" disabled={anyBusy} onClick={() => resolve(false)}>
                {busy === 'check' ? <span className="spinner" /> : `Check ${name}`}
              </button>
              <button className="btn btn-outline" disabled={anyBusy} onClick={() => resolve(true)}>
                {busy === 'force' ? <span className="spinner" /> : 'It’s live'}
              </button>
            </>
          )}
          {can.postNow && !can.approve && (
            <button className={`btn ${dirty ? 'btn-outline' : post.status === 'failed' ? 'btn-accent' : 'btn-outline'}`}
                    disabled={anyBusy} onClick={postNow}>
              {busy === 'post' ? <span className="spinner" /> : post.status === 'failed' ? 'Try again now' : 'Post now'}
            </button>
          )}
          {can.unskip && (
            <button className="btn btn-accent" disabled={anyBusy} onClick={unskip}>
              {busy === 'unskip' ? <span className="spinner" /> : 'Restore'}
            </button>
          )}
          {can.skip && (
            <button className="btn btn-ghost danger sheet-foot-end" disabled={anyBusy} onClick={skip}>
              {busy === 'skip' ? <span className="spinner" /> : 'Skip this post'}
            </button>
          )}
          {!can.edit && !can.skip && !can.unskip && (
            <button className="btn btn-outline sheet-foot-end" onClick={onClose}>Close</button>
          )}
        </footer>
      </aside>
    </div>
  );
}
