'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

// Eight destinations do not fit a phone, and a row that scrolls sideways hides
// the ones at the end. The day-to-day pages stay visible; setup pages live
// behind a menu on desktop and the whole set behind a drawer on mobile.
const PRIMARY = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/create', label: 'Create' },
  { href: '/review', label: 'Review' },
  { href: '/automations', label: 'Automations' },
];

const SECONDARY = [
  { href: '/', label: 'Connections' },
  { href: '/history', label: 'History' },
  { href: '/settings/keys', label: 'API keys' },
  { href: '/settings', label: 'Settings' },
];

const ALL = [...PRIMARY, ...SECONDARY];

export default function NavLinks() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuRef = useRef(null);

  const isActive = (href) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

  // Close the desktop menu on an outside click or Escape — a dropdown that
  // traps the user is worse than no dropdown.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e) => { if (!menuRef.current?.contains(e.target)) setMenuOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  // Route changes should always leave the navigation closed.
  useEffect(() => { setMenuOpen(false); setDrawerOpen(false); }, [pathname]);

  // A drawer over the page must not let the page behind it scroll.
  useEffect(() => {
    document.body.style.overflow = drawerOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [drawerOpen]);

  return (
    <>
      {/* desktop */}
      <div className="nav-desktop">
        {PRIMARY.map((l) => (
          <a key={l.href} href={l.href}
             className={`navlink${isActive(l.href) ? ' active' : ''}`}
             aria-current={isActive(l.href) ? 'page' : undefined}>
            {l.label}
          </a>
        ))}

        <div className="nav-menu" ref={menuRef}>
          <button className={`navlink nav-more${SECONDARY.some((l) => isActive(l.href)) ? ' active' : ''}`}
                  onClick={() => setMenuOpen((v) => !v)}
                  aria-expanded={menuOpen} aria-haspopup="menu">
            More
            <svg width="10" height="7" viewBox="0 0 12 8" aria-hidden="true"
                 className={`chev${menuOpen ? ' up' : ''}`}>
              <path d="M1 1.5 6 6.5l5-5" fill="none" stroke="currentColor"
                    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {menuOpen && (
            <div className="nav-dropdown" role="menu">
              {SECONDARY.map((l) => (
                <a key={l.href} href={l.href} role="menuitem"
                   className={`nav-dropitem${isActive(l.href) ? ' active' : ''}`}>
                  {l.label}
                </a>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* mobile */}
      <button className="nav-burger" onClick={() => setDrawerOpen(true)}
              aria-label="Open menu" aria-expanded={drawerOpen}>
        <span /><span /><span />
      </button>

      {drawerOpen && (
        <div className="drawer-scrim" onClick={() => setDrawerOpen(false)}>
          <nav className="drawer" onClick={(e) => e.stopPropagation()} aria-label="Main">
            <div className="drawer-head">
              <span className="drawer-title">Menu</span>
              <button className="drawer-close" onClick={() => setDrawerOpen(false)}
                      aria-label="Close menu">×</button>
            </div>
            {ALL.map((l) => (
              <a key={l.href} href={l.href}
                 className={`drawer-link${isActive(l.href) ? ' active' : ''}`}
                 aria-current={isActive(l.href) ? 'page' : undefined}>
                {l.label}
              </a>
            ))}
          </nav>
        </div>
      )}
    </>
  );
}
