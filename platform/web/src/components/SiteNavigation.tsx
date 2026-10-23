'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { NAV_GROUPS } from '@/lib/site-nav';
import NavPending from './NavPending';

export default function SiteNavigation({variant}:{variant:'desktop'|'mobile'}) {
  const navigationId='site-navigation-'+variant;
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        toggle.current?.focus();
      }
    };
    const desktop = window.matchMedia('(min-width: 1024px)');
    const resize = () => {
      if (desktop.matches) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    desktop.addEventListener('change', resize);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
      desktop.removeEventListener('change', resize);
    };
  }, [open]);
  return (
    <div ref={container}>
      <button
        ref={toggle}
        type="button"
        aria-label={open ? '關閉導覽選單' : '開啟導覽選單'}
        aria-expanded={open}
        aria-controls={navigationId}
        onClick={() => setOpen((value) => !value)}
        className="flex h-10 w-10 items-center justify-center rounded-md text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800 lg:hidden"
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d={open ? 'M6 6l12 12M6 18L18 6' : 'M4 6h16M4 12h16M4 18h16'} />
        </svg>
      </button>
      {/* Desktop: one row with a thin rule between groups. Mobile menu: one row per group, its label on the left. */}
      <nav
        id={navigationId}
        className={`${open ? 'flex' : 'hidden'} absolute inset-x-0 top-full flex-col gap-3 border-b border-zinc-200 bg-white p-3 text-sm shadow-lg dark:border-zinc-800 dark:bg-zinc-950 lg:static lg:flex lg:flex-row lg:items-center lg:gap-0 lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none lg:dark:bg-transparent`}
        aria-label="主要導覽"
      >
        {NAV_GROUPS.map((group) => (
          <div
            key={group.label}
            className="flex items-start gap-2 lg:items-center lg:gap-0 lg:border-l lg:border-zinc-200 lg:pl-1 lg:not-first:ml-1 lg:first:border-l-0 lg:first:pl-0 dark:lg:border-zinc-800"
          >
            <p className="w-12 shrink-0 pt-2.5 text-xs leading-5 text-zinc-500 lg:hidden dark:text-zinc-400">{group.label}</p>
            <div className="flex flex-wrap gap-1">
              {group.links.map(({ href, short }) => {
                // A link may carry a default scope (直播: the original menu's news-and-politics tags); match its path.
                const base = href.split('?')[0]!;
                const exact = pathname === base || pathname === base+'/';
                const current = exact || pathname.startsWith(base+'/') || (base === '/keywords' && ['/vocabulary','/compare/titles'].some(p=>pathname.startsWith(p))) || (base === '/live/current' && pathname.startsWith('/live/')) || (base === '/ai/days' && ['/ai/','/events'].some(p=>pathname.startsWith(p)));
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setOpen(false)}
                    aria-current={current ? (exact ? 'page' : 'location') : undefined}
                    className={`flex min-h-10 items-center justify-center whitespace-nowrap rounded-md px-3 transition-colors [-webkit-tap-highlight-color:transparent] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:bg-brand-100 has-data-pending:bg-brand-50 has-data-pending:text-brand-800 dark:active:bg-brand-900 dark:has-data-pending:bg-brand-950 dark:has-data-pending:text-brand-300 ${
                      current
                        ? 'bg-brand-50 font-semibold text-brand-800 dark:bg-brand-950 dark:text-brand-300'
                        : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'
                    }`}
                  >
                    {short}
                    <NavPending />
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
    </div>
  );
}
