import { canonicalVideoThumbnail } from '../../../shared/media-assets.js';
import type { ChannelRow, ChannelTag, VideoRow } from '../contracts.js';
import type { Row } from '../db/client.js';
export function integer(value: unknown): number | null {
    if (value === null || value === undefined || value === '')
        return null;
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : null;
}
export function text(value: unknown): string { return typeof value === 'string' ? value : ''; }
export function object(value: unknown): Row {
    if (typeof value === 'string') {
        try {
            return object(JSON.parse(value));
        }
        catch {
            return {};
        }
    }
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
}
export function list(value: unknown): unknown[] {
    if (typeof value === 'string') {
        try {
            return list(JSON.parse(value));
        }
        catch {
            return [];
        }
    }
    return Array.isArray(value) ? value : [];
}
export function strings(value: unknown): string[] { return list(value).filter((v): v is string => typeof v === 'string' && v.trim() !== '').map(v => v.trim()); }
export function pickText(row: Row, keys: string[]): string {
    for (const key of keys)
        if (text(row[key]).trim())
            return text(row[key]).trim();
    return '';
}
export function pickStrings(row: Row, keys: string[]): string[] {
    const flatten = (v: unknown): string[] => Array.isArray(v) ? v.flatMap(flatten) : v && typeof v === 'object' ? Object.values(v).flatMap(flatten) : typeof v === 'string' && v.trim() ? [v.trim()] : typeof v === 'number' && Number.isFinite(v) ? [String(v)] : [];
    for (const key of keys)
        if (row[key] !== undefined && row[key] !== null)
            return [...new Set(flatten(row[key]))];
    return [];
}
/** Older AI providers sometimes wrapped an array in a result key or a Markdown JSON fence. */
export function aiItems(value: unknown): unknown[] {
    let decoded = value;
    if (typeof decoded === 'string') {
        const raw = decoded.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
        try {
            decoded = JSON.parse(raw);
        }
        catch {
            return [];
        }
    }
    for (let depth = 0; depth < 5; depth++) {
        if (Array.isArray(decoded))
            return decoded;
        const row = object(decoded), key = ['events', '事件', 'topics', '議題', 'result', 'data'].find(k => row[k] && typeof row[k] === 'object');
        if (!key)
            return Object.values(row);
        decoded = row[key];
    }
    return [];
}
export function timestamp(value: unknown): string | null {
    const str = text(value);
    if (!str || str.startsWith('0000'))
        return null;
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/.test(str))
        return str.replace(' ', 'T') + '+08:00';
    if (/^\d{4}-\d{2}-\d{2}$/.test(str))
        return str + 'T00:00:00+08:00';
    return Number.isFinite(Date.parse(str)) ? new Date(str).toISOString() : null;
}
export function latest(...values: unknown[]): string | null {
    return values.map(timestamp).filter((v): v is string => v !== null).sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
}
export function taipeiDate(date: Date): string { return new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 10); }
export function taipeiSql(date: Date): string { return new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 19).replace('T', ' '); }
export function tagIds(value: unknown): number[] { return [...new Set([...text(value).matchAll(/\[(\d+)\]/g)].map(v => Number(v[1])).filter(v => v > 0))]; }
export function tags(value: unknown, names: Map<number, string>): ChannelTag[] {
    return tagIds(value).map(id => ({ id, name: names.get(id) ?? String(id), kind: 'channel' }));
}
export function channel(row: Row, names: Map<number, string>): ChannelRow {
    const week=integer(row.view_week),month=integer(row.view_month),videos=integer(row.video_week),estimate=integer(row.views_pred_month);
    const gap=estimate===null||month===null?null:estimate-month;
    const growth=week===null||month===null||month<=0?null:((week-month/4)/month)*25;

    return { id: integer(row.u_id) ?? 0, youtubeId: text(row.youtube_id), title: text(row.title) || '頻道名稱待補',
        avatar: null, thumbnail: null, description: text(row.description) || null,
        publishedAt: timestamp(row.publishedAt), youtubeUrl: `https://www.youtube.com/channel/${encodeURIComponent(text(row.youtube_id))}`,
        views: integer(row.viewCount), subscribers: integer(row.subscriberCount), videoCount: integer(row.videoCount),
        weeklyViews: integer(row.view_week), monthlyViews: integer(row.view_month), weeklySubscribers: integer(row.sub_week),
        weeklyVideos: videos, monthlySubscribers: integer(row.sub_month), monthlyVideos: integer(row.video_month),
        estimatedWeeklyViews: integer(row.views_pred_week), estimatedMonthlyViews: estimate,
        monthlyEstimateGap: gap!==null&&Number.isSafeInteger(gap)?gap:null,
        legacyGrowthPercent: growth!==null&&Number.isFinite(growth)?growth:null,
        averageWeeklyViewsPerVideo: week!==null&&videos!==null&&videos>0?Math.floor(week/videos):null,
        updatedAt: latest(row.mtime, row.stime, row.ctime, row.count_mtime), tags: tags(row.tags, names) };
}
export function video(row: Row): VideoRow {
    return { id: text(row.videoId), channelId: integer(row.u_id) ?? 0, youtubeChannelId: text(row.channelId),
        channelTitle: text(row.channelTitle) || '頻道名稱待補', title: text(row.title) || '影片標題待補', description: text(row.description),
        channelAvatar: null, thumbnail: canonicalVideoThumbnail(text(row.videoId)), publishedAt: timestamp(row.publishedAt), views: integer(row.viewCount),
        likes: integer(row.likeCount), comments: integer(row.commentCount), updatedAt: latest(row.mtime, row.ctime),
        youtubeUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(text(row.videoId))}` };
}
