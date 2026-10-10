'use client';

import { usePathname } from 'next/navigation';

// Settings is one place with two parts. They were two separate entries in the
// sidebar, which made "where do I change my keys?" a search.
const TABS = [
  { href: '/settings', label: 'Brand & voice' },
  { href: '/settings/keys', label: 'API keys' },
];

export default function SettingsTabs() {
  const pathname = usePathname();
  return (
    <nav className="tabs" aria-label="Settings sections">
      {TABS.map((t) => {
        const active = pathname === t.href;
        return (
          <a key={t.href} href={t.href} className={`tab${active ? ' active' : ''}`}
             aria-current={active ? 'page' : undefined}>
            {t.label}
          </a>
        );
      })}
    </nav>
  );
}
