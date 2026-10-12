'use client';

import { type ReactNode, useEffect, useRef, useState } from 'react';

type ScrollX = 'none' | 'start' | 'middle' | 'end';

/**
 * Horizontal scroll container for wide tables. Marks where the table is
 * scrolled to (data-scroll-x) so the sticky lead column can cast a shadow and
 * the right edge fades while more columns are hidden. `card` draws the usual
 * rounded border and switches the colour tokens to the card tone.
 *
 * The header row follows the page down a long table. CSS sticky cannot do it
 * (a sideways scroller is a vertical scroll container too), so the header is
 * translated by a scroll-driven animation on the page's own scroll timeline:
 * the compositor moves it, so it keeps up with however fast the page scrolls.
 * Script only measures where the table sits; browsers without scroll timelines
 * fall back to moving the header on scroll events. */
export default function TableScroller({
  children,
  card = false,
  label = '可左右捲動的表格',
  className = '',
  footer,
  startAtEnd = false,
}: {
  children: ReactNode;
  card?: boolean;
  label?: string;
  className?: string;
  /** Rendered inside the card below the scrolling area, e.g. a "show more" link. */
  footer?: ReactNode;
  /** Open scrolled to the right edge, for time axes whose newest columns are last. */
  startAtEnd?: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  const [scroll, setScroll] = useState<ScrollX>();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (startAtEnd) el.scrollLeft = el.scrollWidth;
    const update = () => {
      const max = el.scrollWidth - el.clientWidth;
      setScroll(max <= 1 ? 'none' : el.scrollLeft <= 1 ? 'start' : el.scrollLeft >= max - 1 ? 'end' : 'middle');
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => {
      el.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, [startAtEnd]);
  useEffect(() => {
    const head = ref.current?.querySelector('thead');
    const tableEl = head?.closest('table');
    if (!head || !tableEl) return;
    // globals.css drops every animation under reduced motion, so the header follows by script there.
    const timeline =
      CSS.supports('animation-timeline: scroll()') && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const offset = () => document.querySelector('[data-site-header]')?.getBoundingClientRect().height ?? 0;
    let start = 0;
    let travel = 0;
    const measure = () => {
      start = tableEl.getBoundingClientRect().top + window.scrollY - offset();
      travel = Math.max(0, tableEl.offsetHeight - head.offsetHeight);
      head.style.setProperty('--head-start', `${start}px`);
      head.style.setProperty('--head-end', `${start + travel}px`);
      head.style.setProperty('--head-travel', `${travel}px`);
    };
    const follow = () => {
      head.style.transform = `translateY(${Math.min(Math.max(0, window.scrollY - start), travel)}px)`;
    };
    measure();
    head.classList.add(timeline ? 'table-head-follow' : 'table-head-shift');
    const observer = new ResizeObserver(() => {
      measure();
      if (!timeline) follow();
    });
    observer.observe(tableEl);
    observer.observe(document.body);
    if (!timeline) {
      follow();
      window.addEventListener('scroll', follow, { passive: true });
    }
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', follow);
      head.classList.remove('table-head-follow', 'table-head-shift');
      head.style.transform = '';
    };
  }, []);
  return (
    <div
      className={`table-frame relative ${card ? 'table-card overflow-hidden rounded-xl border border-zinc-300 bg-white dark:border-zinc-800 dark:bg-zinc-900' : ''} ${className}`}
    >
      <div className="relative">
      {/* Keyboard users can focus the region to scroll it sideways. */}
      <section
        ref={ref}
        aria-label={scroll && scroll!=='none'?label:undefined}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: Scrollable table region needs keyboard access.
        tabIndex={scroll && scroll!=='none'?0:undefined}
        data-scroll-x={scroll}
        // Keep absolutely positioned screen-reader text inside this scrollport.
        className="table-scroller relative overflow-x-auto"
      >
        {children}
      </section>
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-y-0 right-0 w-10 bg-linear-to-l from-(--table-bg) transition-opacity ${scroll === 'start' || scroll === 'middle' ? 'opacity-100' : 'opacity-0'}`}
      />
      </div>
      {footer}
    </div>
  );
}
