'use client';
import { useEffect, useRef } from 'react';

/** Placed inside a scrolling tab row: once, scrolls the row (never the page) so its current tab is in view. */
export default function TabRowScroll() {
    const marker = useRef<HTMLSpanElement>(null);
    useEffect(() => {
        const row = marker.current?.parentElement, current = row?.querySelector<HTMLElement>('[aria-current="page"]');
        if (!row || !current || row.scrollWidth <= row.clientWidth) return;
        const right = current.offsetLeft - row.offsetLeft + current.offsetWidth;
        if (right > row.clientWidth - 24) row.scrollLeft = Math.max(0, right - row.clientWidth + 48);
    }, []);
    return <span ref={marker} hidden />;
}
