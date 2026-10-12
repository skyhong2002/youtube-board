import { sql } from 'drizzle-orm';
import type { Reader, Row } from '../db/client.js';
import { addDay, bound, date, decode, dict, int, meta, numeric, obj, type Q } from './common.js';
export function channelWeek(day: string, includeYear = false) { const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7)); const number = Math.ceil(((+d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7); return includeYear ? `${d.getUTCFullYear()}-${number}` : String(number); }
export function channelMetric(point: Row, keys: string[]): number | null {
    for (const key of keys) { const value=point[key]; if (numeric(value)) return Math.trunc(Number(value)); }
    return null;
}
const weekday = (day: string) => new Date(day + 'T00:00:00Z').getUTCDay();
const median = (a: number[]) => { a.sort((x, y) => x - y); return a.length ? (a[Math.floor((a.length - 1) / 2)]! + a[Math.floor(a.length / 2)]!) / 2 : 0; };
export async function channelReport(db: Reader, q: Q, now: Date, prediction = false, prefetched?: {
    logs: Row[];
    channel?: Row;
    yearWeekKeys?: boolean;
}) {
    const uid = bound(q, 'u_id', 2, Number.MAX_SAFE_INTEGER), limit = bound(q, 'limit', prediction ? 60 : 365, prediction ? 365 : 1095), today = date(now);
    const rows = prefetched?.logs ?? await db.rows(sql `SELECT * FROM urt_log WHERE u_id=${uid} ${prediction ? sql `ORDER BY pk DESC LIMIT 4` : sql `ORDER BY themonth`}`);
    const dates = dict<{
        view: number | null;
        video: number | null;
    }>();
    let invalid = 0, unusable = 0;
    for (const r of rows) {
        if (typeof r.thedata !== 'string' || !r.thedata.trim()) {
            unusable++;
            continue;
        }
        let raw: unknown;
        try {
            raw = JSON.parse(r.thedata);
        }
        catch {
            invalid++;
            continue;
        }
        let usable = false;
        for (const [d, v] of Object.entries(obj(raw))) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !v || typeof v !== 'object')
                continue;
            const p = obj(v);
            dates[d] = { view: channelMetric(p, ['view', 'total_views']), video: channelMetric(p, ['video', 'videos']) };
            usable ||= dates[d]!.view !== null || dates[d]!.video !== null;
        }
        if (!usable)
            unusable++;
    }
    const week = (day:string) => channelWeek(day, prefetched?.yearWeekKeys ?? false);
    const pred = dict<number>(), weeks = dict<Record<number, number>>(), weekSum = dict<number>(), weekCount = dict<number>();
    for (let i = limit + 30; i >= 0; i--) {
        const d = addDay(today, -i), y = addDay(d, -1), t = addDay(d, -2), value = (dates[d]?.view ?? 0) - (dates[y]?.view ?? 0);
        if (!(value < 0 || value > 10000000 || !dates[y]?.view || dates[y]?.view === dates[t]?.view || !dates[t]?.view))
            pred[d] = value;
    }
    for (let i = limit + 30; i >= 0; i--) {
        const d = addDay(today, -i), v = pred[d] ?? 0;
        if (v <= 0)
            continue;
        const w = week(d);
        weekSum[w] = (weekSum[w] ?? 0) + v;
        weekCount[w] = (weekCount[w] ?? 0) + 1;
        (weeks[w] ??= {})[weekday(d)] = v;
    }
    const ratios = Array.from({ length: 7 }, (_, day) => {
        const vals: number[] = [];
        for (let i = 1; i <= 12; i++) {
            const w = week(addDay(today, -i * 7));
            if (weekCount[w] === 7 && (weekSum[w] ?? 0) > 0)
                vals.push(Number(((weeks[w]?.[day] ?? 0) / weekSum[w]!).toFixed(4)));
        }
        return median(vals);
    }), sum = ratios.reduce((a, b) => a + b, 0);
    if (sum > 0) {
        for (let i = 0; i < 7; i++)
            ratios[i] = ratios[i]! / sum;
        for (let i = limit + 14; i >= 0; i--) {
            const d = addDay(today, -i);
            if ((pred[d] ?? 0) > 0)
                continue;
            const known = weeks[week(d)] ?? {}, med = Object.keys(known).reduce((s, k) => s + ratios[Number(k)]!, 0), total = Object.values(known).reduce((a, b) => a + b, 0);
            pred[d] = med > 0 ? Math.trunc(total / med * ratios[weekday(d)]!) : 0;
        }
    }
    const result = dict<Row>();
    for (let i = limit; i >= 0; i--) {
        const d = addDay(today, -i), y = addDay(d, -1), p = dates[d], prev = dates[y];
        result[d] = { videos: p?.video != null && prev?.video != null ? p.video - prev.video : 0, orig: p?.view != null && prev?.view != null ? p.view - prev.view : 0, pred: pred[d] ?? 0, moving: Math.ceil(Array.from({ length: 7 }, (_, j) => pred[addDay(d, -j)] ?? 0).reduce((a, b) => a + b, 0) / 7) };
    }
    const views = Object.values(dates).filter(p => p.view !== null).length, videos = Object.values(dates).filter(p => p.video !== null).length, available = prediction ? views >= 2 : views > 0 || videos > 0;
    const c = prefetched ? prefetched.channel : (await db.rows(sql `SELECT u_id,title,youtube_id FROM urt_channel WHERE u_id=${uid} LIMIT 1`))[0];
    const m = meta('urt_log.thedata', available, { u_id: uid, limit, log_rows: rows.length, invalid_log_rows: invalid, unusable_log_rows: unusable, valid_points: Object.keys(dates).length, view_points: views, video_points: videos, channel: c ? { ...c, u_id: int(c.u_id) } : null, blocked_reason: available ? null : !prediction && !rows.length ? 'local urt_log has no rows for this channel' : 'local urt_log has no usable rows for this channel' });
    if (!prediction)
        return { result, meta: m };
    const vals = Object.values(result).reverse();
    return { result, summary: { views_pred_week: vals.slice(0, 7).reduce((s, r) => s + int(r.pred), 0), views_pred_month: vals.slice(0, 29).reduce((s, r) => s + int(r.pred), 0) }, meta: { ...m, months_limit: 4, writeback_skipped: 'run reports:channel-predictions:build --execute for reviewed urt_count prediction writeback' } };
}
