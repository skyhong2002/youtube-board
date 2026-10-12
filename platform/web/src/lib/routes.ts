export interface ReportRoute {
    title: string;
    description: string;
    family: string;
    kind: string;
    id?: string;
    condition?: string;
    apiPath: string;
    query?: Record<string, string>;
}
/** Forms that edit a path date submit to its undated sibling. Paths are already
 * canonical URI-encoded strings; do not decode opaque names a second time. */
export function reportFilterPath(path:string,route:Pick<ReportRoute,'apiPath'|'query'>):string|undefined{
    if(/^\/live\/days\/\d{4}-\d{2}-\d{2}$/.test(path))return '/live/days';
    const mayor=path.match(/^(\/mayor\/cities\/[^/]+\/people\/[^/]+)\/days\/\d{4}-\d{2}-\d{2}$/);
    return mayor?.[1]??(route.query?`/${route.apiPath}`:undefined);
}
const descriptions: Record<string, string> = {
    live: "以最近取得的直播觀測呈現同時在線人數，各直播的觀眾可能重複。",
    ai: "以來源影片為基礎的 AI 輔助整理；分類與摘要需搭配原始來源閱讀。",
    channels: "查看頻道的收錄影片、公開統計與歷次觀測。",
    tags: "頻道分類用於組織觀測來源，與新聞共同標籤詞彙分開維護。",
    keywords: "從關鍵字探索影片與討論；比對結果不代表事件因果或立場。",
    groups: "依既有頻道群組比較觀測結果。",
    mayor: "比較地方公共人物的影片與議題觀測。",
    videos: "觀看數與互動數為取得當時的公開觀測值。",
    comments: "觀測範圍內的公開留言。",
};
/** Next16.3 passes URI-encoded dynamic values to server pages (getDynamicParam).
 * Decode exactly once at the page boundary (metadata is already decoded), never inside resolveRoute: a literal
 * term "%41" arrives as "%2541" and must stay "%41", not become "A". */
export function decodeReportSegments(encoded: string[]): string[] | null {
    try { const decoded=encoded.map(segment => decodeURIComponent(segment)); return decoded.some(segment=>!segment||segment==='.'||segment==='..')?null:decoded; }
    catch { return null; }
}

/** Resolve already-decoded opaque path segments; encode only when building URLs. */
export function resolveRoute(segments: string[]): ReportRoute | null {
    const [family, id, section] = segments;
    const path = segments.map(encodeURIComponent).join("/");
    // Match route structure without treating an encoded slash inside a term as a separator.
    const full = path;
    const route = (
        title: string,
        kind = full,
        identifier?: string,
    ): ReportRoute => ({
        title,
        description: descriptions[family] || "",
        family,
        kind,
        id: identifier,
        apiPath: path,
    });
    if (/^channels\/\d+\/prompt$/.test(full) || /^ai\/days\/(?:prompt|\d{4}-\d{2}-\d{2}\/(?:[^/]+\/)?prompt)$/.test(full)) return route("提示詞預覽", "prompt-preview");
    if (full === "channels") return route("頻道觀測", "channels");
    if (full === "videos") return route("影片觀測", "videos");
    if (full === "tags/videos") return route("分類影片", "videos");
    if (full === "tags") return route("頻道分類", "tags");
    if (full === "keywords" || full === "vocabulary")
        return route("共同標籤詞彙", "vocabulary");
    if (/^ai\/days\/\d+\/events\/history$/.test(full)) return route("跨日來源脈絡", "extended");
    if (/^ai\/events\/\d+\/wall$/.test(full)) return route("議題來源影片牆", "live-wall");
    if (/^live\/walls\/(news|china|alternate)$/.test(full)) return route("四窗直播", "live-wall");
    if (full === "live/current") return route("即時直播觀測", "live");
    if (full === "ai/days") return route("每日公共議題", "ai-days");
    if (
        family === "ai" &&
        id === "days" &&
        /^\d{4}-\d{2}-\d{2}$/.test(section || "") &&
        (segments.length === 3 ||
            (segments.length === 4 && segments[3] !== "prompt"))
    )
        return {
            ...route("每日公共議題", "ai-days", section),
            condition: segments[3],
            apiPath: "ai/days",
        };
    if (
        family === "ai" &&
        id === "days" &&
        /^\d+$/.test(section || "") &&
        segments[3] === "events" &&
        segments.length === 4
    )
        return route("議題來源與分析", "ai-event", section);
    if (
        family === "ai" &&
        id === "events" &&
        segments.length === 3 &&
        /^\d+$/.test(section)
    )
        return route("議題來源與分析", "ai-event", section);
    if (family === "channels" && /^\d+$/.test(id || "")) {
        if (
            segments.length === 5 &&
            section === "ai" &&
            segments[3] === "days" &&
            /^\d{4}-\d{2}-\d{2}$/.test(segments[4])
        )
            return {
                ...route("頻道每日議題", "extended"),
                apiPath: `channels/${id}/ai/days`,
                query: { date: segments[4] },
            };
        if (segments.length === 2) return route("頻道觀測", "channel", id);
        if (segments.length === 3 && section === "videos")
            return route("頻道影片", "channel-videos", id);
        if (
            (segments.length === 3 &&
                [
                    "comments",
                    "cloud",
                    "trends",
                    "people",
                    "ai",
                    "prompt",
                ].includes(section)) ||
            (segments.length === 4 &&
                section === "ai" &&
                segments[3] === "days")
        )
            return route("頻道分析");
    }
    if (family === "videos" && id && segments.length === 2)
        return route("影片觀測", "video", id);
    if (
        family === "videos" &&
        id &&
        section === "analytics" &&
        segments.length === 3
    )
        return route("影片觀測分析", "video-analytics", id);
    if (
        family === "tags" &&
        /^\d+$/.test(id || "") &&
        ["channels", "videos"].includes(section) &&
        segments.length === 3
    )
        return route(
            section === "channels" ? "分類頻道" : "分類影片",
            `tag-${section}`,
            id,
        );
    if (
        family === "keywords" &&
        id &&
        section === "videos" &&
        segments.length === 3
    )
        return route(`「${id}」的影片`, "keyword-videos", id);
    // Only known public report patterns are admitted. Unknown URLs stay 404.
    const reportPatterns = [
        /^ai\/days\/(?:prompt|\d{4}-\d{2}-\d{2}\/(?:[^/]+\/)?prompt)$/,
        /^live\/(days(?:\/\d{4}-\d{2}-\d{2})?|periods|channels|hours|tags|continuous|trends\/daily|groups\/[^/]+\/hours|walls\/(news|china|alternate)|videos\/[^/]+\/trend)$/,
        /^ai\/(hours|periods|aspects|events\/\d+\/(people|wall|history))$/,
        /^tags\/(compare|cloud|comments|days|trends|videos|live\/videos|\d+\/(comments|cloud|days|trends|live\/videos))$/,
        /^keywords\/[^/]+\/(cloud|days|groups\/trends|live\/trends)$/,
        /^groups(?:\/[^/]+(?:\/(ranking|trends|live))?)?$/,
        /^mayor(?:\/cities\/[^/]+(?:\/people\/[^/]+(?:\/days\/\d{4}-\d{2}-\d{2})?)?)?$/,
        /^comments\/authors\/[^/]+$/,
    ];
    if (reportPatterns.some((pattern) => pattern.test(full))) {
        const title =
            {
                live: "直播歷史報表",
                ai: "AI 議題報表",
                tags: "分類報表",
                keywords: "關鍵字報表",
                groups: "頻道群組",
                mayor: "地方人物觀測",
                comments: "留言觀測",
            }[family] || "觀測報表";
        return route(title, "extended");
    }
    return null;
}
