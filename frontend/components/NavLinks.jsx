'use client';

import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/', label: 'Connections' },
  { href: '/create', label: 'Create Post' },
  { href: '/history', label: 'History' },
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
