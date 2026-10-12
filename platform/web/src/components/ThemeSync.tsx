'use client';

import { useEffect } from 'react';

// The inline script in layout.tsx sets data-theme before first paint. If React
// ever regenerates the root on a hydration mismatch, that attribute is wiped and
// the page falls back to light; this re-applies the same resolution afterwards.
export default function ThemeSync() {
  useEffect(() => {
    const el = document.documentElement;
    if (el.dataset.theme === 'dark' || el.dataset.theme === 'light') return;
    try {
      const saved = localStorage.getItem('theme');
      el.dataset.theme =
        saved === 'dark' || saved === 'light' ? saved : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch {
      el.dataset.theme = 'light';
    }
  }, []);
  return null;
}
