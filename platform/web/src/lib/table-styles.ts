/**
 * Shared classes for data tables so every table behaves the same on phones.
 *
 * Two layouts:
 *  - Wide tables (many numeric columns): wrap in <TableScroller>, keep the first
 *    column sticky with `lead` + `leadBox`, and let the rest scroll sideways.
 *    On phones the lead column is capped at ~9.5rem, and once the user scrolls
 *    sideways it collapses to ~5.5rem (icon plus a few characters) with
 *    `leadExtra` marks hidden, so the viewport goes to the data.
 *  - Text tables with two or three columns (docs, parameter lists): add
 *    `stack` to the <table> and `data-label` to each <td>; below the `sm`
 *    breakpoint rows stack vertically with the heading printed before each cell.
 */
export const table = {
  /** Base cell padding; phones get a little less horizontal room. */
  cell: 'px-2 py-2 sm:px-3',
  /** Right-aligned number cell. */
  num: 'px-2 py-2 text-right tabular-nums sm:px-3',
  /** Row hover; colours follow the scroller's card / plain tone. */
  row: 'group hover:bg-(--table-hover-bg)',
  /** Sticky first column of a body row. */
  lead: 'table-lead sticky left-0 z-10 bg-(--table-bg) px-2 py-2 group-hover:bg-(--table-hover-bg) sm:px-3',
  /** Sticky first column of the header or footer row. */
  leadHead: 'table-lead sticky left-0 z-10 bg-(--table-head-bg) px-2 py-2 sm:px-3',
  /** Caps the lead column on phones and collapses it further once the table
   *  is scrolled sideways (see globals.css); put the cell's content inside it. */
  leadBox: 'table-lead-box min-w-0',
  /** Secondary marks in the lead cell (flags, badges, schedules); hidden while scrolled on phones. */
  leadExtra: 'table-lead-extra',
  /** Text that must fit on one line inside `leadBox`. */
  leadText: 'min-w-0 max-w-full truncate',
  /** Stacked layout for narrow text tables; pair with `data-label` on cells. */
  stack: 'table-stack',
} as const;
