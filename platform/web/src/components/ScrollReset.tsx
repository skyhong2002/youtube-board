'use client';
import { usePathname } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef } from 'react';

// Next 16.3 keeps the old scroll position when a link leads into a child of
// the current page (/topic/ → /topic/tvbs/54356/), so a shorter page opens at
// its bottom. Scroll to the top whenever the path changes, except on back and
// forward (the browser restores those) and on links to an anchor.
export default function ScrollReset() {
  const pathname = usePathname();
  const previous = useRef(pathname);
  const traversed = useRef<string | null>(null);

  useEffect(() => {
    const onPopState = () => {
      traversed.current = window.location.pathname;
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useLayoutEffect(() => {
    if (previous.current === pathname) return;
    previous.current = pathname;
    const isTraversal = traversed.current === window.location.pathname;
    traversed.current = null;
    if (isTraversal || window.location.hash) return;
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}
