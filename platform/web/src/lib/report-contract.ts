import { numericAiDailyEventId } from "./routes";

export type {
    ReportValue,
    ReportCell,
    ReportColumn,
    ReportSeries,
    ReportData,
} from "../../../api/src/report-contracts";
export function safeReportHref(value: string | undefined): string | undefined {
    if (!value || /[\u0000-\u001f\\]/.test(value)) return undefined;
    if (value.startsWith("/") && !value.startsWith("//")) return value;
    try {
        const url = new URL(value);
        return url.protocol === "https:" && !url.username && !url.password
            ? url.href
            : undefined;
    } catch {
        return undefined;
    }
}

/** Numeric daily-event reports require the event query. Next's optimistic tree
 * prefetch drops queries; disable background prefetch only for these links.
 * Click URLs remain unchanged and other links retain Next's automatic policy. */
export function reportLinkPrefetch(href: string): false | undefined {
    if (!href || /[\u0000-\u001f\\]/.test(href)) return undefined;
    try {
        const url = new URL(href, "https://youtube.observe.tw");
        if (url.origin !== "https://youtube.observe.tw" || url.username || url.password)
            return undefined;
        return numericAiDailyEventId(url.pathname) !== null ? false : undefined;
    } catch {
        return undefined;
    }
}
