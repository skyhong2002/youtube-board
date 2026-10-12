import { publishedLiveTagCache } from '../reports/cache-lineage.js';
import { sql } from 'drizzle-orm';
import type { Reader, Row } from '../db/client.js';
import { bound, boundedDate, cacheWhere, channelWhere, counts, date, decode, dict, filters, int, legacyRawCounts, meta, numeric, nonempty, obj, payload, php, str, time, txt, wrapped, type Q } from './common.js';
export function period(q: Q, now: Date, defaultDate?: string) {
    const today = date(now), min = '2022-11-19';
    if (txt(q, 'from')) {
        const pair = [boundedDate(q.from, today, min), boundedDate(q.to, today, min)].sort();
        return { date: pair[1]!, from: pair[0]!, to: pair[1]!, is_range: true };
    }
    return { date: boundedDate(q.date ?? defaultDate, today, min), from: null, to: null, is_range: false };
}
const periodWhere = (p: ReturnType<typeof period>) => p.is_range ? sql `the_date BETWEEN ${p.from} AND ${p.to}` : sql `the_date=${p.date}`;
export function hourly(v: unknown) {
    const out = dict<number>();
    for (const [t, val] of Object.entries(decode(v))) {
        const m = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(t);
        if (!m || Number(m[1]) > 23 || Number(m[2]) > 59 || Number(m[3] ?? 0) > 59 || !numeric(val))
            continue;
        const n = Number(val);
        if (!Number.isFinite(n))
            continue;
        out[m[1]!] = Math.max(out[m[1]!] ?? 0, Math.trunc(n));
    }
    return out;
}
export async function liveReport(db: Reader, name: string, q: Q, now: Date): Promise<unknown> {
    if (name === 'api_live_tag_date') {
        const d = boundedDate(q.date, date(now), '2010-01-01'), f = filters(q, true), r = (await publishedLiveTagCache(db, await db.rows(sql `SELECT * FROM urt_show_live_tag_date WHERE the_date=${d} AND ${cacheWhere(q)} LIMIT 1`), {tagid:f.tagid.join(','),or:f.or.join(','),not:f.not.join(',')}))[0], unwrap = (v: unknown) => php(wrapped(v, ['tags_views', 'tags_video', 'all_result', 'hour_result', 'videos_result', 'views', 'videos', 'all', 'hour', 'data', 'result']));
        return { result: { views: unwrap(r?.tags_views), videos: unwrap(r?.tags_video), all: unwrap(r?.all_result), hour: unwrap(r?.hour_result), data: unwrap(r?.videos_result) }, meta: meta('urt_show_live_tag_date cache', !!r, { date: d, filters: f, counts: { channels: int(r?.count_channels), videos: int(r?.count_videos), tags: int(r?.count_tags), total_views: int(r?.total_views) }, mtime: r?.mtime ?? null,cache_window:r?._cacheWindow??null }) };
    }
    const table = name === 'live_tvbs' ? 'urt_video_live_log_tvbs' : 'urt_video_live_log';
    let def: string | undefined;
    if (name === 'live_tvbs' || name === 'live_date') {
        const r = (await db.rows(sql `SELECT MAX(the_date) AS d FROM ${sql.identifier(table)}`))[0];
        def = str(r?.d).slice(0, 10) || undefined;
    }
    const p = period(q, now, def);
    if (name === 'api_live_day') {
        const vid = txt(q, 'videoId', 'V1p33hqPrUk'), rows = await db.rows(sql `SELECT the_date,log_json FROM urt_video_live_log WHERE BINARY videoId=BINARY ${vid} AND ${periodWhere(p)} ORDER BY the_date`), out = dict<unknown>();
        for (const r of rows)
            out[str(r.the_date).slice(0, 10)] = php(decode(r.log_json));
        return { result: out, meta: meta('urt_video_live_log', rows.length > 0, { videoId: vid, period: p }) };
    }
    if (name === 'video_live') {
        const vid = txt(q, 'videoId', '_QbRXRnHMVY'), d = boundedDate(q.date, date(now), '2022-11-19'), r = (await db.rows(sql `SELECT concurrentViewers FROM urt_video_live WHERE BINARY videoId=BINARY ${vid} LIMIT 1`))[0], l = (await db.rows(sql `SELECT * FROM urt_video_live_log WHERE BINARY videoId=BINARY ${vid} AND the_date=${d} LIMIT 1`))[0], vals = Object.values(decode(l?.log_json)).map(v => int(v)), max = l?.max_current == null ? Math.max(0, ...vals) : int(l.max_current), fmt = (v: number) => v.toLocaleString('en-US');
        return `<head>\n<meta http-equiv="refresh" content="300">\n</head>\n<body>\n目前：${fmt(int(r?.concurrentViewers))} 人，最高：${fmt(max)} 人\n<script type="text/javascript">var myvalues = [${vals.slice(-24).join(',')}];</script>\n<span class="stream"></span>\n</body>\n`;
    }
    if (name === 'csv_live_line') {
        const vid = txt(q, 'videoId', 'quwqlazU-c8'), limit = bound(q, 'limit', 100, 1000), rows = await db.rows(sql `SELECT the_date,log_json FROM urt_video_live_log WHERE BINARY videoId=BINARY ${vid} ORDER BY the_date`), hours = dict<number>();
        let last = '2022-11-01 00:00:00';
        for (const r of rows) {
            for (const [h, v] of Object.entries(hourly(r.log_json))) {
                const key = str(r.the_date).slice(0, 10) + ' ' + h + ':00:00';
                hours[key] = Math.max(hours[key] ?? 0, v);
                if (key > last)
                    last = key;
            }
        }
        return Array.from({ length: limit + 1 }, (_, i) => { const t = new Date(Date.parse(last.replace(' ', 'T') + '+08:00') - (limit - i) * 3600000), s = time(t); return '"' + s + '",' + (hours[s] ?? '') + '\n'; }).join('');
    }
    const rows = await db.rows(sql `SELECT * FROM ${sql.identifier(table)} WHERE ${periodWhere(p)} ${name === 'live_date' ? sql `AND u_id IN (SELECT u_id FROM urt_count WHERE ${channelWhere(q)})` : sql ``}`);
    if (name === 'live_tvbs') {
        const result = dict<Row>();
        for (const r of rows)
            result[str(r.videoId)] = legacyRawCounts(r, 'urt_video_live_log_tvbs');
        return { result, time: time(now), date: p.date, count_videos: Object.keys(result).length, meta: meta(table, rows.length > 0, { period: p }) };
    }
    const hours = dict<Record<string, number>>(), byVideo = new Map<string, Row>();
    for (const r of rows) {
        const id = str(r.videoId), d = str(r.the_date).slice(0, 10);
        for (const [h, v] of Object.entries(hourly(r.log_json))) {
            const key = name === 'api_live_hour' ? d + ' ' + h : h;
            (hours[key] ??= dict())[id] = Math.max(hours[key]![id] ?? 0, v);
        }
        if (!byVideo.has(id) || int(r.max_current) > int(byVideo.get(id)?.max_current))
            byVideo.set(id, r);
    }
    const sortedHours = Object.fromEntries(Object.entries(hours).sort(([a], [b]) => a.localeCompare(b)));
    if (name === 'api_live_hour')
        return payload(sortedHours, 'urt_video_live_log derived real-time YouTube dashboard', { period: p });
    if (name === 'api_live_date' && !rows.length && !p.is_range && !['1', 'true', 'on', 'yes'].includes(str(q.force))) {
        const c = (await db.rows(sql `SELECT * FROM urt_show_live_date WHERE the_date=${p.date} LIMIT 1`))[0], cached = decode(c?.return_json);
        if (cached.result && typeof cached.result === 'object')
            return { ...cached, meta: meta('urt_show_live_date.return_json', true, { period: p, mtime: c?.mtime ?? null, cache_role: 'imported_historical_fallback' }) };
    }
    const vids = [...byVideo.keys()], display = vids.length ? await db.rows(sql `SELECT * FROM urt_show_video_live WHERE BINARY videoId IN (${sql.join(vids.map(v => sql `BINARY ${v}`), sql `,`)})`) : [], dm = new Map(display.map(r => [str(r.videoId), r])), videos: Row[] = [];
    for (const [id, r] of byVideo) {
        const v = { ...(dm.get(id) ?? { videoId: id, u_id: int(r.u_id), title: id }), max_current: int(r.max_current) };
        videos.push(name === 'live_date' ? { ...v, the_date: str(r.the_date).slice(0, 10), live_log: php(decode(r.log_json)) } : v);
    }
    if (name === 'live_date') {
        if (int(q.sorting) > 0)
            videos.sort((a, b) => int(b.max_current) - int(a.max_current));
        const result = videos.slice(0, bound(q, 'limit', 1000, 1000));
        return { result, time: time(now), date: p.date, from: p.from, to: p.to, count_videos: result.length, meta: meta('urt_video_live_log', result.length > 0, { period: p }) };
    }
    const uids = [...new Set([...byVideo.values()].map(r => int(r.u_id)).filter(v => v > 0))], channels = uids.length ? await db.rows(sql `SELECT u_id,tags FROM urt_count WHERE u_id IN (${sql.join(uids.map(id => sql `${id}`), sql `,`)})`) : [], tags = new Map(channels.map(r => [int(r.u_id), str(r.tags)])), max = dict<number>(), count = dict<number>();
    for (const r of byVideo.values()) {
        for (const id of new Set([...(tags.get(int(r.u_id)) ?? '').matchAll(/\[(\d+)\]/g)].map(m => int(m[1])).filter(v => v > 0))) {
            max[id] = (max[id] ?? 0) + int(r.max_current);
            count[id] = (count[id] ?? 0) + 1;
        }
    }
    videos.sort((a, b) => int(b.max_current) - int(a.max_current));
    return { result: { tag: { max: php(max), count: php(count) }, video: videos, hour: php(sortedHours) }, meta: meta('urt_video_live_log derived real-time YouTube dashboard', videos.length > 0, { period: p }) };
}
