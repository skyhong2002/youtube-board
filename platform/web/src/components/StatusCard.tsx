import Link from 'next/link';
import type { ReactNode } from 'react';
import { LIVE_NEWS_SCOPE } from '@/lib/site-nav';

/** Where a reader can go when this page cannot show data; the gateway's static
 * public/errors/unavailable.html lists the same four. */
export const STATUS_SHORTCUTS = [
    { href: '/keywords', label: '熱門標籤排行' },
    { href: `/live/current?${LIVE_NEWS_SCOPE}`, label: '即時直播' },
    { href: '/ai/days', label: '每日公共議題' },
    { href: '/channels', label: '頻道來源' },
] as const;

/** One look for every "this page cannot show its data" state: the in-page report failure, the client
 * error boundary and the gateway's static page share the red-topped card, a retry and a way elsewhere. */
export function StatusCard({ eyebrow, title, children, actions, shortcuts = true, role = 'alert', heading = 'h2' }: {
    eyebrow?: string;
    title: ReactNode;
    children?: ReactNode;
    actions?: ReactNode;
    shortcuts?: boolean;
    role?: 'alert' | 'status';
    heading?: 'h1' | 'h2';
}) {
    const Title = heading;
    return (
        <div className="mx-auto my-8 max-w-2xl">
            <section className="rounded-xl border border-t-4 border-zinc-200 border-t-brand-600 bg-white px-6 py-7 text-center sm:px-10 sm:py-9 dark:border-zinc-800 dark:border-t-brand-500 dark:bg-zinc-900" role={role}>
                {eyebrow && <p className="mb-2 text-[13px] font-semibold text-brand-700 dark:text-brand-400">{eyebrow}</p>}
                <Title className="m-0 text-xl font-bold tracking-tight text-balance text-zinc-900 dark:text-zinc-100">{title}</Title>
                {children && <div className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-pretty text-zinc-600 dark:text-zinc-400">{children}</div>}
                {actions && <div className="mt-5 flex flex-wrap items-center justify-center gap-3">{actions}</div>}
            </section>
            {shortcuts && (
                <nav className="mt-6 text-center" aria-label="其他頁面">
                    <p className="mb-2 text-[13px] text-zinc-500 dark:text-zinc-400">也可以先看</p>
                    <ul className="m-0 flex list-none flex-wrap justify-center gap-2 p-0">
                        {STATUS_SHORTCUTS.map((item) => (
                            <li key={item.href}><Link className="inline-flex min-h-11 items-center rounded-full bg-zinc-100 px-4 text-sm text-zinc-800 hover:bg-brand-50 hover:text-brand-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-brand-950 dark:hover:text-brand-300" href={item.href}>{item.label}</Link></li>
                        ))}
                    </ul>
                </nav>
            )}
        </div>
    );
}

export const statusSecondary = 'inline-flex min-h-11 items-center rounded-md border border-zinc-300 px-4 text-sm text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800';
