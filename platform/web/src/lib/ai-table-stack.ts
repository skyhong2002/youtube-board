/** Phone layout shared by the AI hour and period tables: below `sm` the header row is hidden and
 * each row becomes a card — the row number in the margin, the event on its own line, then the
 * short values flowing inline (each printing its column heading from `data-label`) and the chip
 * lists on full lines. From `sm` up the table is unchanged. */
export const aiStack={
 table:'max-sm:block',
 head:'max-sm:hidden',
 body:'max-sm:block',
 row:'max-sm:relative max-sm:flex max-sm:flex-wrap max-sm:items-baseline max-sm:gap-x-3 max-sm:gap-y-1.5 max-sm:py-3 max-sm:pl-10 max-sm:pr-3',
 /** The row number, in the card's left margin beside the event. */
 index:'max-sm:absolute max-sm:left-3 max-sm:top-3 max-sm:border-0 max-sm:p-0 max-sm:text-left max-sm:font-semibold',
 /** The event cell (or a thumbnail): a full line under no label. */
 lead:'max-sm:block max-sm:basis-full max-sm:min-w-0 max-sm:border-0 max-sm:p-0',
 /** A labelled short value, inline with its neighbours. */
 field:'max-sm:inline-flex max-sm:min-w-0 max-sm:items-baseline max-sm:gap-x-1.5 max-sm:border-0 max-sm:p-0 max-sm:text-left max-sm:before:text-xs max-sm:before:text-zinc-500 max-sm:before:content-[attr(data-label)] dark:max-sm:before:text-zinc-400',
 /** Added to a labelled field holding chips or a sentence, so it takes a full line and wraps. */
 wide:'max-sm:flex max-sm:basis-full max-sm:flex-wrap max-sm:gap-y-1',
 /** Added to a cell with nothing to show, so the phone card leaves it out instead of printing a labelled dash. */
 empty:'max-sm:hidden',
} as const;
