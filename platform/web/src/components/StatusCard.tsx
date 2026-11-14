import type { ReactNode } from 'react';
import StatusShortcuts from './StatusShortcuts';

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
            {shortcuts && <StatusShortcuts/>}
        </div>
    );
}

export const statusSecondary = 'inline-flex min-h-11 items-center rounded-md border border-zinc-300 px-4 text-sm text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800';
