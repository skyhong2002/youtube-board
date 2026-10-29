/** Adapted from tag.observe.tw's ranking, tag and event pages; data semantics stay local. */
export const reportStyle={
 panel:'rounded-xl border border-zinc-300 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900',
 note:'my-3 rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm leading-relaxed text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400',
 /** Filter rows sit open on the page, like the legacy site; only charts keep a card. */
 form:'my-4 flex flex-wrap items-end gap-3 text-sm',
 label:'flex min-w-0 flex-col gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400',
 input:'min-h-11 max-w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 focus:border-brand-600 focus:outline-2 focus:outline-offset-2 focus:outline-brand-600 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100',
 button:'inline-flex min-h-11 items-center justify-center rounded-md bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700',
 primary:'inline-flex min-h-11 items-center justify-center rounded-md bg-brand-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-800 hover:text-white dark:bg-brand-600 dark:hover:bg-brand-700',
 link:'text-brand-700 hover:underline dark:text-brand-400',
 tag:'inline-flex rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
} as const;
