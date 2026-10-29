"use client";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import TableScroller from "./TableScroller";

export type LiveSortValue = number | string | null;
export interface LiveSortColumn { key: string; label: string; numeric?: boolean; text?: boolean; className?: string; hint?: string }
export interface LiveSortRow { key: string; values: Record<string, LiveSortValue>; card: ReactNode; cells: ReactNode }
export type Sort = { key: string; descending: boolean };
/** Unknown values stay last in both directions; ties keep the incoming (viewer ranking) order. */
export function sortLiveRows<T extends Pick<LiveSortRow, "values">>(rows: T[], sort: Sort | null): T[] {
    if (!sort) return rows;
    return rows.map((row, index) => ({ row, index })).sort((a, b) => {
        const x = a.row.values[sort.key] ?? null, y = b.row.values[sort.key] ?? null;
        if (x === null || y === null) return x === y ? a.index - b.index : x === null ? 1 : -1;
        const order = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "zh-Hant-TW");
        return (sort.descending ? -order : order) || a.index - b.index;
    }).map(({ row }) => row);
}

/** Sorts the listed live rows in the browser, as the legacy DataTables did; `complete` loads every
 * remaining row before a custom sort. */
export function LiveSortable({ columns, rows, rowClassName, tableClassName, complete }: { columns: LiveSortColumn[]; rows: LiveSortRow[]; rowClassName: string; tableClassName: string; complete?: string }) {
    const [sort, setSort] = useState<Sort | null>(null);
    const ordered = sortLiveRows(rows, sort);
    const choose = (key: string) => {
        const item = columns.find((entry) => entry.key === key);
        if (!item) return;
        setSort((current) => current?.key === key ? { key, descending: !current.descending } : { key, descending: !item.text });
    };
    const arrow = (key: string) => sort?.key === key ? (sort.descending ? "▼" : "▲") : "↕";
    return <>
        <div className="mb-3 flex items-center gap-2 text-sm sm:hidden">
            <label className="flex flex-1 items-center gap-2">排序
                <select className="min-h-10 flex-1 rounded-full border border-zinc-300 bg-white px-3 dark:border-zinc-700 dark:bg-zinc-950" value={sort?.key ?? ""} onChange={(event) => event.target.value ? choose(event.target.value) : setSort(null)}>
                    <option value="">同時在線排名</option>
                    {columns.filter((item) => item.key !== "rank").map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
                </select>
            </label>
            {sort && <button type="button" className="min-h-10 rounded-full border border-zinc-300 px-3 dark:border-zinc-700" onClick={() => setSort({ ...sort, descending: !sort.descending })}>{sort.descending ? "高到低 ▼" : "低到高 ▲"}</button>}
        </div>
        {sort && complete && <LoadAll href={complete}/>}
        <ul aria-label="直播觀測清單" className="m-0 list-none space-y-3 p-0 sm:hidden">
            {ordered.map((row) => <li key={row.key} className="min-w-0 rounded-xl border border-zinc-300 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">{row.card}</li>)}
        </ul>
        <TableScroller label="直播觀測表，可左右捲動" className="hidden sm:block">
        <table className={tableClassName}>
            <thead>
                <tr>
                    {columns.map((item) => <th key={item.key} className={item.className} aria-sort={sort?.key === item.key ? (sort.descending ? "descending" : "ascending") : undefined}>
                        <button type="button" title={item.hint} onClick={() => choose(item.key)} className={`relative cursor-pointer hover:text-zinc-900 dark:hover:text-zinc-100 ${sort?.key === item.key ? "text-zinc-900 dark:text-zinc-100" : ""}`}>
                            {/* The arrow sits in the cell padding so sortable headers keep the table's widths. */}
                            {item.label}<span aria-hidden="true" className={`absolute top-1/2 -translate-y-1/2 text-[9px] ${item.numeric ? "-left-2.5" : "-right-2.5"} ${sort?.key === item.key ? "" : "opacity-40"}`}>{arrow(item.key)}</span>
                        </button>
                    </th>)}
                </tr>
            </thead>
            <tbody>
                {ordered.map((row) => <tr key={row.key} className={rowClassName}>{row.cells}</tr>)}
            </tbody>
        </table>
        </TableScroller>
    </>;
}
/** Mounted once a reader sorts a partly loaded list: replaces the page with every row, keeping the sort state. */
function LoadAll({ href }: { href: string }) {
    const router = useRouter();
    const [, startTransition] = useTransition();
    useEffect(() => { startTransition(() => router.replace(href, { scroll: false })); }, [href, router]);
    return <p className="mb-2 text-sm text-zinc-500" role="status">載入全部直播後排序…</p>;
}
