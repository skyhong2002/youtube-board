const number = new Intl.NumberFormat("zh-TW");
export function count(value: number | null | undefined) {
    return value === null || value === undefined || !Number.isFinite(value)
        ? "—"
        : number.format(value);
}
export function compact(value: number | null | undefined) {
    if (value == null || !Number.isFinite(value)) return "—";
    if (Math.abs(value) >= 1e8)
        return `${number.format(Math.round(value / 1e6) / 100)} 億`;
    if (Math.abs(value) >= 1e4)
        return `${number.format(Math.round(value / 100) / 100)} 萬`;
    return number.format(value);
}
/** Taipei date-time as 「2026/10/21 上午05:01」 (date only: 「2026/10/21」). Built from numeric parts:
 * Node's and browsers' ICU data put different spaces into zh-TW output, which broke hydration. */
export function dateTime(value: string | null | undefined, dateOnly = false) {
    if (!value) return "未記錄";
    const date = new Date(
        /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00+08:00` : value,
    );
    if (!Number.isFinite(date.getTime())) return "未記錄";
    const p = Object.fromEntries(taipeiParts.formatToParts(date).map((part) => [part.type, part.value]));
    const day = `${p.year}/${p.month}/${p.day}`;
    if (dateOnly) return day;
    const hour = Number(p.hour);
    return `${day} ${hour < 12 ? "上午" : "下午"}${String(hour % 12 || 12).padStart(2, "0")}:${p.minute}`;
}
const taipeiParts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
/** Taipei calendar date (YYYY-MM-DD) for a date-only value or an ISO instant such as the API's UTC `...Z` timestamps. */
export function taipeiCalendarDate(value: string | null | undefined): string {
    if (!value) return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) return "";
    const time = Date.parse(value);
    return Number.isFinite(time) ? new Date(time + 8 * 3600000).toISOString().slice(0, 10) : "";
}
export function youtubeUrl(value: string): string | undefined {
    try {
        const url = new URL(value);
        return url.protocol === "https:" &&
            ["youtube.com", "www.youtube.com", "youtu.be"].includes(
                url.hostname,
            )
            ? url.href
            : undefined;
    } catch {
        return undefined;
    }
}
/** Joins sentences that may already end in 。；; etc. with one 「；」 and a final 「。」,
 * so no 「。；」 appears. Text inside each sentence is kept as is; blanks are dropped. */
export function joinSentences(items: readonly string[]) {
    const parts = items.map((item) => item.trim().replace(/[。；;，,、\s]+$/u, "")).filter(Boolean);
    return parts.length ? `${parts.join("；")}。` : "";
}
export function first(value: string | string[] | undefined) {
    return Array.isArray(value) ? value[0] : value;
}
/** Dense table form, 24-hour Taipei time: 「10/21 05:01」; the caller keeps dateTime() in a title. */
export function shortDateTime(value: string | null | undefined) {
    if (!value) return "—";
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "—";
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date).map((part) => [part.type, part.value]));
    return `${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
}
