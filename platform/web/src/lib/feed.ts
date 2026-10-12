import type { VideoRow } from "../../../api/src/contracts";
import { youtubeUrl } from "./format";
export function xml(value: string) {
    return value
        .toWellFormed()
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "")
        .replace(
            /[<>&"']/g,
            (char) =>
                ({
                    "<": "&lt;",
                    ">": "&gt;",
                    "&": "&amp;",
                    '"': "&quot;",
                    "'": "&apos;",
                })[char]!,
        );
}
export function videoFeed({
    rows,
    title,
    link,
    updatedAt,
    fixture,
}: {
    rows: VideoRow[];
    title: string;
    link: string;
    updatedAt: string | null;
    fixture: boolean;
}) {
    const date = (value: string | null) =>
        value && Number.isFinite(Date.parse(value))
            ? new Date(value).toUTCString()
            : null;
    const built = date(updatedAt);
    return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${xml(title)}${fixture ? "（開發驗證資料）" : ""}</title><link>${xml(link)}</link><description>觀測範圍內的 YouTube 影片；不代表全站影片。${fixture ? "此環境使用合成驗證資料。" : ""}</description><language>zh-TW</language>${built ? `<lastBuildDate>${xml(built)}</lastBuildDate>` : ""}${rows.map((row) => `<item><title>${xml(row.title)}</title><link>${xml(youtubeUrl(row.youtubeUrl) || link)}</link><guid isPermaLink="false">youtube:${xml(row.id)}</guid><description>${xml(`${row.channelTitle}：${row.description.slice(0, 600)}`)}</description>${date(row.publishedAt) ? `<pubDate>${xml(date(row.publishedAt)!)}</pubDate>` : ""}</item>`).join("")}</channel></rss>`;
}

export function feedOrigin(
    configured: string | undefined,
    production: boolean,
    requestUrl: string,
    host: string | null,
    allowedHosts: string[],
): string | null {
    try {
        if (configured) {
            const url = new URL(configured);
            return ["http:", "https:"].includes(url.protocol) &&
                !url.username &&
                !url.password
                ? url.origin
                : null;
        }
        if (production || !host) return null;
        const url = new URL(`${new URL(requestUrl).protocol}//${host}`);
        return allowedHosts.includes(url.hostname) &&
            !url.username &&
            !url.password
            ? url.origin
            : null;
    } catch {
        return null;
    }
}
