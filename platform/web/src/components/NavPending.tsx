'use client';

import { useLinkStatus } from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { createContext, useContext, useEffect, useId } from 'react';

// Header links report their pending navigation here so one loading bar can run
// along the header's bottom edge, even when the link sat in the closed mobile menu.
export const NavPendingContext = createContext<(source:string,pending: boolean) => void>(() => {});

// Rendered inside a header <Link>. `data-pending` lets the link style itself with
// `has-data-pending:` while its page loads.
export default function NavPending() {
  const { pending } = useLinkStatus();
  const setPending = useContext(NavPendingContext);
  const source=useId();
  useEffect(() => {
    if (!pending) return;
    setPending(source,true);
    return () => setPending(source,false);
  }, [pending, setPending,source]);
  return <span hidden data-pending={pending || undefined} />;
}

// A tap that only opens a link's preview card (touch readers' stand-in for
// hover) marks its click here so the bar below doesn't start for it.
const previewClicks = new WeakSet<Event>();
export const markPreviewClick = (event: Event) => previewClicks.add(event);

const sameRoute = (a: URL, b: URL) => a.pathname.replace(/\/$/, '') === b.pathname.replace(/\/$/, '') && a.search === b.search;

// Links elsewhere on the page light the same bar: a plain left click on a
// same-site link starts it, and the new URL rendering stops it. External
// links, new tabs, downloads and same-page anchors are left alone; a timeout
// covers clicks that never change the URL (a link that redirects back here).
export function LinkClickPending() {
  const setPending = useContext(NavPendingContext);
  const source=useId();
  const route = `${usePathname()}?${useSearchParams()}`;
  // A new route ends the click's navigation.
  useEffect(() => setPending(source,false), [route, setPending,source]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      clearTimeout(timer);
      setPending(source,false);
    };
    function onClick(event: MouseEvent) {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest?.('a');
      const href = link?.getAttribute('href');
      if (!link || !href || link.hasAttribute('download') || link.hasAttribute('data-no-progress')) return;
      const target = link.getAttribute('target');
      if (target && target !== '_self') return;
      const here = new URL(window.location.href);
      const url = new URL(href, here);
      if (url.origin !== here.origin || sameRoute(url, here) || /\.(xml|json|pdf|csv)$/i.test(url.pathname)) return;
      // Wait until the link's own handlers have run: a preview tap marks the click.
      setTimeout(() => {
        if (previewClicks.has(event)) return;
        clearTimeout(timer);
        setPending(source,true);
        timer = setTimeout(stop, 15_000);
      });
    }
    // Capture still sees clicks whose handlers stop propagation; pageshow
    // clears a bar left over when the back button restores a cached page.
    document.addEventListener('click', onClick, true);
    window.addEventListener('pageshow', stop);
    return () => {
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('pageshow', stop);
      clearTimeout(timer);
    };
  }, [setPending,source]);
  return null;
}

export function NavProgressBar({ pending }: { pending: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute inset-x-0 -bottom-px h-0.5 overflow-hidden transition-opacity ${pending ? 'opacity-100' : 'opacity-0'}`}
    >
      <span className="nav-progress block h-full w-2/5 bg-brand-600 dark:bg-brand-400" />
    </span>
  );
}
