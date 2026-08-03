'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { NavIcon } from './BrandIcons';

// Grouped rather than ranked: the day-to-day pages and the setup pages are
// different kinds of work, and a flat list of eight made every visit a search.
const GROUPS = [
  {
    label: 'Publish',
    links: [
      { href: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
      { href: '/create', label: 'Create', icon: 'create' },
      { href: '/review', label: 'Review', icon: 'review' },
      { href: '/automations', label: 'Automations', icon: 'automation' },
    ],
  },
  {
    label: 'Setup',
    links: [
      { href: '/', label: 'Connections', icon: 'link' },
      { href: '/history', label: 'History', icon: 'history' },
      { href: '/settings/keys', label: 'API keys', icon: 'key' },
      { href: '/settings', label: 'Settings', icon: 'settings' },
    ],
  },
];

const ALL = GROUPS.flatMap((g) => g.links);

function isActive(pathname, href) {
  if (href === '/') return pathname === '/';
  // /settings must not light up while /settings/keys is open.
  if (href === '/settings') return pathname === '/settings';
  return pathname.startsWith(href);
}

function Link({ link, pathname, badge }) {
  const active = isActive(pathname, link.href);
  return (
    <a href={link.href}
       className={`navlink${active ? ' active' : ''}`}
       aria-current={active ? 'page' : undefined}>
      <NavIcon name={link.icon} />
      {link.label}
      {badge > 0 && <span className="nav-badge">{badge}</span>}
    </a>
  );
}

// Desktop sidebar navigation.
export function SidebarNav({ badges = {} }) {
  const pathname = usePathname();
  return (
    <>
      {GROUPS.map((group) => (
        <div className="nav-group" key={group.label}>
          <p className="nav-label">{group.label}</p>
          {group.links.map((l) => (
            <Link key={l.href} link={l} pathname={pathname} badge={badges[l.href]} />
          ))}
        </div>
      ))}
    </>
  );
}

// Mobile drawer, opened from the top bar.
export function DrawerNav({ badges = {} }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const closeRef = useRef(null);

  useEffect(() => { setOpen(false); }, [pathname]);

  // A drawer over the page must not let the page behind it scroll, and Escape
  // must always get the user out of it.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <>
      <button className="nav-burger" onClick={() => setOpen(true)}
              aria-label="Open menu" aria-expanded={open}>
        <span /><span /><span />
      </button>

      {open && (
        <div className="drawer-scrim" onClick={() => setOpen(false)}>
          <nav className="drawer" onClick={(e) => e.stopPropagation()} aria-label="Main">
            <div className="drawer-head">
              <span className="nav-label" style={{ padding: 0 }}>Menu</span>
              <button className="drawer-close" ref={closeRef} onClick={() => setOpen(false)}
                      aria-label="Close menu">×</button>
            </div>
            {GROUPS.map((group) => (
              <div className="nav-group" key={group.label}>
                <p className="nav-label">{group.label}</p>
                {group.links.map((l) => (
                  <Link key={l.href} link={l} pathname={pathname} badge={badges[l.href]} />
                ))}
              </div>
            ))}
          </nav>
        </div>
      )}
    </>
  );
}

export default SidebarNav;
export { ALL as NAV_LINKS };
