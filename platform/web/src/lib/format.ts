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
export function dateTime(value: string | null | undefined, dateOnly = false) {
    if (!value) return "未記錄";
    const date = new Date(
        /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00+08:00` : value,
    );
    if (!Number.isFinite(date.getTime())) return "未記錄";
    return new Intl.DateTimeFormat("zh-TW", {
        timeZone: "Asia/Taipei",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        ...(dateOnly ? {} : { hour: "2-digit", minute: "2-digit" }),
    }).format(date);
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
export function first(value: string | string[] | undefined) {
    return Array.isArray(value) ? value[0] : value;
}
