'use client';

import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/', label: 'Connections' },
  { href: '/create', label: 'Create' },
  { href: '/review', label: 'Review' },
  { href: '/automations', label: 'Automations' },
  { href: '/history', label: 'History' },
  { href: '/settings', label: 'Settings' },
];

export default function NavLinks() {
  const pathname = usePathname();
  return (
    <>
      {LINKS.map((l) => (
        <a
          key={l.href}
          href={l.href}
          className={`navlink${pathname === l.href ? ' active' : ''}`}
          aria-current={pathname === l.href ? 'page' : undefined}
        >
          {l.label}
        </a>
      ))}
    </>
  );
}
