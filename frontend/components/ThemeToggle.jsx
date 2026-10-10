'use client';

import { useEffect, useState } from 'react';
import { NavIcon } from './BrandIcons';

const KEY = 'postly-theme';

// Light/dark switch. The stored choice is applied before first paint by the
// inline script in the root layout; this only keeps the button in sync and
// writes the user's choice back.
export default function ThemeToggle({ labeled = false }) {
  const [theme, setTheme] = useState(null);

  useEffect(() => {
    const stored = localStorage.getItem(KEY);
    if (stored === 'dark' || stored === 'light') { setTheme(stored); return; }
    setTheme(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  }, []);

  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(KEY, next); } catch { /* private mode */ }
  }

  // Render nothing until the real theme is known, so the icon never shows the
  // wrong state for a frame.
  if (!theme) return <span className={`theme-toggle${labeled ? ' labeled' : ''}`} aria-hidden="true" />;

  const target = theme === 'dark' ? 'light' : 'dark';
  return (
    <button className={`theme-toggle${labeled ? ' labeled' : ''}`} onClick={toggle} type="button"
            aria-label={`Switch to ${target} theme`} title={`Switch to ${target} theme`}>
      <NavIcon name={theme === 'dark' ? 'sun' : 'moon'} size={17} />
      {labeled && <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>}
    </button>
  );
}
