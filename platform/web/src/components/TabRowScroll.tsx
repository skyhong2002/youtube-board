'use client';
import { useEffect, useRef } from 'react';

/** Placed inside a scrolling tab row: scrolls the row (never the page) once so its current tab is in
 * view, and keeps data-fade on the row up to date so .scroll-fade fades the edge(s) it continues past. */
export default function TabRowScroll() {
    const marker = useRef<HTMLSpanElement>(null);
    useEffect(() => {
        const row = marker.current?.parentElement;
        if (!row) return;
        const current = row.querySelector<HTMLElement>('[aria-current="page"]');
        if (current && row.scrollWidth > row.clientWidth) {
            const right = current.offsetLeft - row.offsetLeft + current.offsetWidth;
            if (right > row.clientWidth - 24) row.scrollLeft = Math.max(0, right - row.clientWidth + 48);
        }
        const update = () => {
            const more = row.scrollWidth - row.clientWidth;
            const start = row.scrollLeft > 2, end = row.scrollLeft < more - 2;
            row.dataset.fade = more <= 2 ? '' : start && end ? 'both' : end ? 'end' : start ? 'start' : '';
        };
        update();
        row.addEventListener('scroll', update, { passive: true });
        const observer = new ResizeObserver(update);
        observer.observe(row);
        return () => { row.removeEventListener('scroll', update); observer.disconnect(); };
    }, []);
    return <span ref={marker} hidden />;
}
