'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import type { Ref } from 'react';
import { SEARCH_MAX_LENGTH } from '../../../shared/report-limits';

// The site's one search box, in the header. On the results page (/videos) it
// holds the current query, so a fresh title/description search starts
// in the same place. Report-specific filters remain in the report form.

export const isSearchPage = (pathname: string | null) => pathname === '/videos' || pathname === '/videos/';

type Props = { inputRef?: Ref<HTMLInputElement>; onEscape?: () => void };

export default function SiteSearch({ inputRef, onEscape, q = '' }: Props & { q?: string }) {
  return (
    <search aria-label="影片搜尋" className="w-full">
      <form
        action="/videos"
        className="flex min-w-0 items-center rounded-md border border-zinc-300 bg-zinc-50 focus-within:border-brand-600 dark:border-zinc-700 dark:bg-zinc-900"
      >
        <input
          key={q}
          ref={inputRef}
          defaultValue={q}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {event.preventDefault();event.stopPropagation();onEscape?.();}
          }}
          name="q"
          type="search"
          aria-label="搜尋影片標題與描述"
          placeholder="搜尋影片"
          maxLength={SEARCH_MAX_LENGTH}
          required
          className="min-w-0 flex-1 bg-transparent py-2 pl-3 text-base text-zinc-900 outline-none dark:text-zinc-100 lg:text-sm"
        />
        <button
          type="submit"
          aria-label="搜尋"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-zinc-600 hover:text-brand-700 focus-visible:outline-brand-600 dark:text-zinc-400 dark:hover:text-brand-400"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <circle cx="10.5" cy="10.5" r="6.5" />
            <path d="m16 16 5 5" />
          </svg>
        </button>
      </form>
    </search>
  );
}

/** SiteSearch filled from the URL on the results page. Reads search params,
 *  so it must sit inside a Suspense boundary (SiteSearch is the fallback). */
export function SiteSearchFromUrl(props: Props) {
  const pathname = usePathname();
  const params = useSearchParams();
  if (!isSearchPage(pathname)) return <SiteSearch {...props} />;
  return <SiteSearch {...props} q={params.get('q') ?? ''} />;
}
