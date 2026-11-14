'use client';

import Link from 'next/link';
import AccountMenu from './AccountMenu';
import { usePathname } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import NavPending, { LinkClickPending, NavPendingContext, NavProgressBar, SlowNavigationHint } from './NavPending';
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
      data-home-link={revealed ? undefined : 'hidden'}
      onPointerDown={press}
      onPointerUp={unpress}
      onPointerCancel={unpress}
      onPointerLeave={unpress}
      className={`${searchOpen ? 'hidden lg:block' : ''} ${revealed ? '' : 'invisible opacity-0'} -ml-2 max-w-48 shrink-0 overflow-hidden rounded-md px-2 py-1.5 transition-[opacity,visibility,background-color,transform] duration-300 motion-reduce:transition-none [-webkit-tap-highlight-color:transparent] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 has-data-pending:animate-pulse ${
        pressed ? 'scale-95 bg-brand-100 text-brand-800 dark:bg-brand-900 dark:text-brand-200' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'
      }`}
    >
      <Wordmark className="h-8 w-auto" />
      <NavPending />
    </Link>
  );
}

export default function SiteHeader() {
  const [pendingSources,setPendingSources]=useState<Set<string>>(()=>new Set());
  const setNavPending=useCallback((source:string,pending:boolean)=>setPendingSources(previous=>{if(previous.has(source)===pending)return previous;const next=new Set(previous);if(pending)next.add(source);else next.delete(source);return next;}),[]);
  const [searchOpen, setSearchOpen] = useState(false);
  // On the home page the masthead (#home-masthead) already shows the big site mark, so the bar's
  // wordmark waits until that mark scrolls under the header, fades in, and hides again back at the top.
  // It keeps its width while hidden, so the desktop nav never shifts; reduced motion skips the fade.
  // Every other page shows it from the start. Phones keep search behind the icon either way.
  const masthead = usePathname() === '/' ? 'home-masthead' : null;
  const [revealed, setRevealed] = useState(!masthead);
  useEffect(() => {
    if (!masthead) { setRevealed(true); return; }
    // Arriving from another page, home may still be loading: keep the wordmark (it pulses as the
    // click's feedback) until the masthead is in the DOM, then follow the masthead.
    const visible = new IntersectionObserver(([entry]) => setRevealed(!entry!.isIntersecting), { rootMargin: '-56px 0px 0px 0px' });
    const attach = () => { const mark = document.getElementById(masthead); if (mark) visible.observe(mark); return !!mark; };
    let waiting: MutationObserver | null = null;
    if (!attach()) {
      setRevealed(true);
      waiting = new MutationObserver(() => { if (attach()) { waiting?.disconnect(); waiting = null; } });
      waiting.observe(document.body, { childList: true, subtree: true });
    }
    return () => { visible.disconnect(); waiting?.disconnect(); };
  }, [masthead]);
  const autoSearch = false;
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
        {/* Without scripts nothing would ever reveal the hidden wordmark, so it simply shows. */}
        {!revealed && <noscript dangerouslySetInnerHTML={{ __html: '<style>[data-home-link]{visibility:visible!important;opacity:1!important}</style>' }} />}
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
        <SlowNavigationHint pending={pendingSources.size>0} />
      </header>
    </NavPendingContext>
  );
}
