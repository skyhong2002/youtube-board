'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LIVE_NEWS_SCOPE } from '@/lib/site-nav';

/** Where a reader can go when this page cannot show data. The first four match the gateway's static
 * public/errors/unavailable.html; the last stands in when the reader is already in one of them. */
export const STATUS_SHORTCUTS = [
    { href: '/keywords', label: '熱門標籤排行' },
    { href: `/live/current?${LIVE_NEWS_SCOPE}`, label: '即時直播' },
    { href: '/ai/days', label: '每日公共議題' },
    { href: '/channels', label: '頻道來源' },
    { href: '/videos', label: '最新影片' },
] as const;

/** The section a shortcut leads to: its first path segment (「/live/current?…」 → 「/live」). */
const section = (href: string) => '/' + (href.split('?')[0]!.split('/')[1] ?? '');

/** The four shortcuts outside the section the reader is in, so a failed page never suggests itself. */
export function statusShortcuts(pathname: string | null) {
    const here = pathname ? section(pathname) : null;
    return STATUS_SHORTCUTS.filter((item) => section(item.href) !== here).slice(0, 4);
}

export default function StatusShortcuts() {
    const items = statusShortcuts(usePathname());
    return (
        <nav className="mt-6 text-center" aria-label="其他頁面">
            <p className="mb-2 text-[13px] text-zinc-500 dark:text-zinc-400">也可以先看</p>
            <ul className="m-0 flex list-none flex-wrap justify-center gap-2 p-0">
                {items.map((item) => (
                    <li key={item.href}><Link className="inline-flex min-h-11 items-center rounded-full bg-zinc-100 px-4 text-sm text-zinc-800 hover:bg-brand-50 hover:text-brand-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-brand-950 dark:hover:text-brand-300" href={item.href}>{item.label}</Link></li>
                ))}
            </ul>
        </nav>
    );
}
