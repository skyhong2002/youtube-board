'use client';

import Link from 'next/link';
import AccountMenu from './AccountMenu';
import { usePathname } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import NavPending, { LinkClickPending, NavPendingContext, NavProgressBar } from './NavPending';
import SiteNavigation from './SiteNavigation';
import SiteSearch, { SiteSearchFromUrl } from './SiteSearch';
import ThemeToggle from './ThemeToggle';
import Wordmark from './Wordmark';

// The wordmark lights up and sinks on press, then pulses (with the header's loading
// bar) until the home page arrives, so a tap never looks ignored. The press state is
// held in React because iOS Safari does not apply :active to a quick tap.
function HomeLink({ searchOpen, revealed }: { searchOpen: boolean; revealed: boolean }) {
  const [pressed, setPressed] = useState(false);
  const release = useRef<number>(undefined);
  function press() {
    window.clearTimeout(release.current);
    setPressed(true);
  }
  function unpress() {
    release.current = window.setTimeout(() => setPressed(false), 180);
  }
  useEffect(() => () => window.clearTimeout(release.current), []);
  return (
    <Link
      href="/"
      aria-label="有影儀表板 首頁"
      onPointerDown={press}
      onPointerUp={unpress}
      onPointerCancel={unpress}
      onPointerLeave={unpress}
      className={`${searchOpen ? 'hidden lg:block' : ''} ${revealed ? 'max-w-48 px-2' : 'invisible max-w-0 px-0 opacity-0'} -ml-2 shrink-0 overflow-hidden rounded-md py-1.5 transition-[max-width,opacity,background-color,transform] duration-300 [-webkit-tap-highlight-color:transparent] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 has-data-pending:animate-pulse has-data-pending:bg-brand-50 has-data-pending:text-brand-800 dark:has-data-pending:bg-brand-950 dark:has-data-pending:text-brand-300 ${
        pressed ? 'scale-95 bg-brand-100 text-brand-800 dark:bg-brand-900 dark:text-brand-200' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'
      }`}
    >
      <Wordmark className="h-8 w-auto" />
      <NavPending />
    </Link>
  );
}

export default function SiteHeader() {
  const pathname=usePathname();
  const mastheadId=pathname==='/'?'home-masthead':undefined;
  const [pendingSources,setPendingSources]=useState<Set<string>>(()=>new Set());
  const setNavPending=useCallback((source:string,pending:boolean)=>setPendingSources(previous=>{if(previous.has(source)===pending)return previous;const next=new Set(previous);if(pending)next.add(source);else next.delete(source);return next;}),[]);
  const [searchOpen, setSearchOpen] = useState(false);
  // When the page opens with its own big site mark (the home masthead), the header's
  // wordmark stays hidden until that mark scrolls out of view, so only one logo shows.
  const [revealed, setRevealed] = useState(!mastheadId);
  useEffect(() => {
    if (!mastheadId) {setRevealed(true);return;}
    const mark = document.getElementById(mastheadId);
    if (!mark) {
      setRevealed(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => setRevealed(!entry.isIntersecting), { rootMargin: '-56px 0px 0px 0px' });
    observer.observe(mark);
    return () => observer.disconnect();
  }, [mastheadId]);
  // While the wordmark is hidden, phones show the search box in the space it
  // would take instead of a bare bar; it folds back into an icon once the
  // wordmark returns. An explicit open outlives that.
  // Report pages have their own search field. Keep the header compact there;
  // the explicit search button still opens the global title/description search.
  const autoSearch = !revealed && !searchOpen;
  const searchToggle = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (searchOpen) searchInput.current?.focus();
  }, [searchOpen]);
  function closeSearch() {
    setSearchOpen(false);
    searchToggle.current?.focus();
  }
  return (
    <NavPendingContext value={setNavPending}>
      <header
        data-site-header
        className="sticky top-0 z-30 border-b border-zinc-300 bg-white/80 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80"
      >
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-2 lg:gap-3">
          <HomeLink searchOpen={searchOpen} revealed={revealed} />
          <div className="hidden lg:block"><SiteNavigation variant="desktop" /></div>
          <div className={`ml-auto flex min-w-0 items-center gap-1 lg:w-44 lg:flex-none ${searchOpen || autoSearch ? 'flex-1' : ''}`}>
            <button
              ref={searchToggle}
              type="button"
              aria-label={searchOpen ? '關閉影片搜尋' : '搜尋影片'}
              aria-expanded={searchOpen}
              aria-controls="header-search"
              onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
              className={`${autoSearch ? 'hidden' : 'flex'} h-10 w-8 shrink-0 items-center justify-center rounded-md text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800 lg:hidden`}
            >
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                {searchOpen ? (
                  <path d="m6 6 12 12M6 18 18 6" />
                ) : (
                  <>
                    <circle cx="10.5" cy="10.5" r="6.5" />
                    <path d="m16 16 5 5" />
                  </>
                )}
              </svg>
            </button>
            <div id="header-search" className={`${searchOpen || autoSearch ? 'block' : 'hidden'} min-w-0 flex-1 lg:block`}>
              <Suspense fallback={<SiteSearch inputRef={searchInput} onEscape={closeSearch} />}>
                <SiteSearchFromUrl inputRef={searchInput} onEscape={closeSearch} />
              </Suspense>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <ThemeToggle /><AccountMenu />
          </div>
          <div className="lg:hidden"><SiteNavigation variant="mobile" /></div>
        </div>
        <Suspense fallback={null}>
          <LinkClickPending />
        </Suspense>
        <NavProgressBar pending={pendingSources.size>0} />
      </header>
    </NavPendingContext>
  );
}
