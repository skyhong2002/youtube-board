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
