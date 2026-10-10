'use client';

import { useEffect, useRef, useState } from 'react';
import { NavIcon } from './BrandIcons';

// A "⋯" button holding the actions a card rarely needs. Every action used to
// sit on the card as its own button, so the one people came for was lost
// among the ones they almost never use.
//
// items: [{ label, onClick, danger?, disabled? }]
export default function Menu({ items, label = 'More actions' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="menu" ref={ref}>
      <button type="button" className="btn btn-ghost btn-sm menu-trigger" aria-label={label}
              aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <NavIcon name="more" size={18} />
      </button>
      {open && (
        <div className="menu-list" role="menu">
          {items.filter(Boolean).map((item) => (
            <button key={item.label} type="button" role="menuitem"
                    className={`menu-item${item.danger ? ' danger' : ''}`}
                    disabled={item.disabled}
                    onClick={() => { setOpen(false); item.onClick(); }}>
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
