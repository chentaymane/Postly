'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { NavIcon } from '../../../components/BrandIcons';

const EMPTY = {
  name: '', description: '', benefits: '', url: '', image_url: '',
  price: '', tags: '', enabled: true,
};

function ProductCard({ p, isNext, onChanged }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(p);
  const [busy, setBusy] = useState(null);

  async function patch(body) {
    setBusy('save');
    await fetch(`/api/products/${p.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setBusy(null);
    setOpen(false);
    onChanged('Saved');
  }

  async function remove() {
    if (!confirm(`Remove "${p.name}"? Posts already made about it are kept.`)) return;
    setBusy('delete');
    await fetch(`/api/products/${p.id}`, { method: 'DELETE' });
    onChanged('Removed');
  }

  async function toggle() {
    setBusy('toggle');
    await fetch(`/api/products/${p.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !p.enabled }),
    });
    setBusy(null);
    onChanged(p.enabled ? `${p.name} paused — skipped by the rotation` : `${p.name} back in the rotation`);
  }

  return (
    <div className={`prod-card${p.enabled ? '' : ' off'}`}>
      <div className="prod-main">
        {p.image_url ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img className="prod-thumb" src={p.image_url} alt="" />
        ) : (
          <span className="prod-thumb placeholder"><NavIcon name="inbox" size={20} /></span>
        )}

        <div className="prod-body">
          <div className="prod-head">
            <h3 className="prod-name">{p.name}</h3>
            {p.price && <span className="pill neutral">{p.price}</span>}
            {isNext && <span className="pill accent"><span className="dot" />Next in rotation</span>}
            {!p.enabled && <span className="pill neutral">Paused</span>}
          </div>
          {p.description && <p className="prod-desc">{p.description}</p>}
          <div className="prod-stats">
            <span><strong>{p.posts}</strong> post{p.posts === 1 ? '' : 's'}</span>
            <span><strong>{p.clicks}</strong> click{p.clicks === 1 ? '' : 's'}</span>
            {p.url && (
              <a className="mini-link" href={p.url} target="_blank" rel="noreferrer">View page ↗</a>
            )}
          </div>
        </div>

        <div className="prod-actions">
          <span className="prod-toggle" title={p.enabled ? 'In the rotation' : 'Paused'}>
            <button className={`switch${p.enabled ? ' on' : ''}`} onClick={toggle}
                    disabled={!!busy} role="switch" aria-checked={p.enabled}
                    aria-label={`${p.enabled ? 'Pause' : 'Resume'} ${p.name}`}>
              <span className="switch-knob" />
            </button>
          </span>
          <button className="btn btn-ghost btn-sm" onClick={() => { setDraft(p); setOpen(!open); }}
                  aria-expanded={open}>
            {open ? 'Close' : 'Edit'}
          </button>
        </div>
      </div>

      {open && (
        <div className="prod-edit">
          <div className="field-row">
            <div className="field">
              <label>Name</label>
              <input value={draft.name || ''} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </div>
            <div className="field">
              <label>Price</label>
              <input value={draft.price || ''} placeholder="$6"
                     onChange={(e) => setDraft({ ...draft, price: e.target.value })} />
            </div>
          </div>
          <div className="field">
            <label>What is it?</label>
            <textarea rows={2} value={draft.description || ''}
                      placeholder="32 sea-creature pages for ages 4-8"
                      onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          </div>
          <div className="field">
            <label>Why does someone buy this one?</label>
            <textarea rows={2} value={draft.benefits || ''}
                      placeholder="Keeps a child busy a whole afternoon; prints at home"
                      onChange={(e) => setDraft({ ...draft, benefits: e.target.value })} />
          </div>
          <div className="field">
            <label>Link</label>
            <input value={draft.url || ''} placeholder="https://…"
                   onChange={(e) => setDraft({ ...draft, url: e.target.value })} />
            <p className="hint">Posts about this product link straight here, not to your homepage.</p>
          </div>
          <div className="field">
            <label>Image</label>
            <input value={draft.image_url || ''} placeholder="https://… (optional)"
                   onChange={(e) => setDraft({ ...draft, image_url: e.target.value })} />
          </div>
          <div className="field">
            <label>Themes</label>
            <input value={draft.tags || ''} placeholder="ocean, animals, ages 4-8"
                   onChange={(e) => setDraft({ ...draft, tags: e.target.value })} />
          </div>
          <div className="auto-actions">
            <button className="btn btn-accent" disabled={busy === 'save'}
                    onClick={() => patch(draft)}>
              {busy === 'save' ? <span className="spinner" /> : 'Save'}
            </button>
            <button className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn btn-ghost danger" style={{ marginLeft: 'auto' }}
                    disabled={!!busy} onClick={remove}>
              Remove product
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ProductsPage() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState(EMPTY);
  const [importUrl, setImportUrl] = useState('');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const router = useRouter();

  const load = useCallback((message) => {
    if (message) { setToast(message); setTimeout(() => setToast(null), 3500); }
    fetch('/api/products', { cache: 'no-store' })
      .then((r) => { if (r.status === 401) { router.push('/login'); return null; } return r.json(); })
      .then((d) => { if (!d) return; setProducts(d.products || []); setLoading(false); });
  }, [router]);

  useEffect(() => { load(); }, [load]);

  // Reading the page fills the form. Typing twenty books in by hand is the
  // chore that means the catalogue never gets filled at all.
  async function runImport() {
    setBusy('import'); setError(null);
    const res = await fetch('/api/products', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ import_url: importUrl }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) { setError(json.error || 'could not read that page'); return; }
    setDraft({ ...EMPTY, ...json.draft });
    setAdding(true);
  }

  async function save() {
    setBusy('save'); setError(null);
    const res = await fetch('/api/products', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    });
    setBusy(null);
    if (!res.ok) { setError('could not save that'); return; }
    setDraft(EMPTY); setImportUrl(''); setAdding(false);
    load('Added to the rotation');
  }

  const active = products.filter((p) => p.enabled).length;

  return (
    <>
      <div className="page-head">
        <div className="head-row">
          <div>
            <h1>Products</h1>
            <p>
              What your posts are actually about. Automations work through this list
              one item at a time, so a catalogue of twenty becomes twenty different posts.
            </p>
          </div>
          <button className="btn btn-accent" onClick={() => { setDraft(EMPTY); setAdding(!adding); }}>
            {adding ? 'Close' : 'Add product'}
          </button>
        </div>
      </div>

      {toast && <div className="toast" role="status">{toast}</div>}

      {adding && (
        <section className="panel">
          <p className="panel-title">Add a product</p>

          <div className="field">
            <label htmlFor="imp">Paste a product link and let Postly read it</label>
            <div className="key-form">
              <input id="imp" value={importUrl} placeholder="https://yourshop.com/your-book"
                     onChange={(e) => setImportUrl(e.target.value)} />
              <button className="btn btn-outline" disabled={!importUrl || busy === 'import'}
                      onClick={runImport}>
                {busy === 'import' ? <span className="spinner" /> : 'Read page'}
              </button>
            </div>
            <p className="hint">
              Fills in the name, description and image from the page. Check it and correct
              anything that came out wrong — or just fill the form in yourself.
            </p>
          </div>

          {error && <div className="notice err"><span className="notice-body">{error}</span></div>}

          <div className="field-row">
            <div className="field">
              <label>Name</label>
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                     placeholder="Ocean Friends Colouring Book" />
            </div>
            <div className="field">
              <label>Price</label>
              <input value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })}
                     placeholder="$6" />
            </div>
          </div>
          <div className="field">
            <label>What is it?</label>
            <textarea rows={2} value={draft.description}
                      onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                      placeholder="32 sea-creature pages for ages 4-8" />
          </div>
          <div className="field">
            <label>Why does someone buy this one?</label>
            <textarea rows={2} value={draft.benefits}
                      onChange={(e) => setDraft({ ...draft, benefits: e.target.value })}
                      placeholder="Keeps a child busy a whole afternoon; prints at home as often as you like" />
          </div>
          <div className="field">
            <label>Link</label>
            <input value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                   placeholder="https://…" />
          </div>
          <div className="field">
            <label>Themes</label>
            <input value={draft.tags} onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
                   placeholder="ocean, animals, ages 4-8" />
          </div>

          <div className="auto-actions">
            <button className="btn btn-accent" disabled={!draft.name || busy === 'save'} onClick={save}>
              {busy === 'save' ? <span className="spinner" /> : 'Add to rotation'}
            </button>
            <button className="btn btn-ghost" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </section>
      )}

      {loading ? (
        <div className="skeleton-stack">
          <div className="skeleton" style={{ height: 120 }} />
          <div className="skeleton" style={{ height: 120 }} />
        </div>
      ) : products.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon"><NavIcon name="inbox" size={26} /></span>
          <p className="empty-title">No products yet</p>
          <p>
            Without these, posts can only talk about your business in general and every
            link goes to your homepage. Add your books and each post becomes about one of
            them, with a link that lands on it.
          </p>
          <button className="btn btn-accent" onClick={() => setAdding(true)}>Add your first</button>
        </div>
      ) : (
        <>
          <p className="hint" style={{ marginBottom: 'var(--s4)' }}>
            {active} of {products.length} in the rotation. Each new post is about the one used
            least so far, so every product gets its turn. Switch one off to leave it out.
          </p>
          <div className="prod-list">
            {products.map((p) => (
              <ProductCard key={p.id} p={p} onChanged={load}
                           isNext={p.enabled && p.id === products.find((x) => x.enabled)?.id} />
            ))}
          </div>
        </>
      )}
    </>
  );
}
