import { publishedReportRow, unknownViewMeta } from '../reports/cache-lineage.js';
import { BadQuery } from '../reports/query.js';
import { sql } from 'drizzle-orm';
import type { Reader, Row } from '../db/client.js';
import { channelReport } from './channel.js';
import { bound, cacheWhere, channelIds, counts, date, dateQuery, decode, dict, filters, int, legacyRawCounts, meta, nonempty, obj, payload, php, remap, str, time, txt, weighted, wrapped, type Q } from './common.js';
const selectionKeys=(f:ReturnType<typeof filters>)=>({tagid:f.tagid.join(',')||null,tag_or:f.or.join(',')||null,tag_not:f.not.join(',')||null});
const cachePayload = (result: Row, source: string, extra: Row) => payload(result, source, { ...extra, blocked_reason: nonempty(result) ? null : 'local cache row is missing or empty; legacy generation is intentionally not run' });
export async function tagReport(db: Reader, name: string, q: Q, now: Date): Promise<unknown> {
    if (name === 'tags_list' || name === 'api_tag') {
        const rows = await db.rows(sql `SELECT tag_id,tag_name FROM urt_tag ORDER BY tag_id`), result = dict<string>();
        for (const r of rows)
            result[int(r.tag_id)] = str(r.tag_name);
        return name === 'api_tag' ? php(result) : payload(php(result), 'urt_tag');
    }
    if (name === 'tags_index') {
        const limit = bound(q, 'limit', 500, 5000), sort = q.sort === 'num' ? 'hours_count' : ['max_count', 'hours_count', 'max_hours', 'weight'].includes(str(q.sort)) ? str(q.sort) : 'weight', rows = await db.rows(sql `SELECT * FROM tags WHERE no_tag IS NULL OR no_tag<1 ORDER BY pk LIMIT 10000`), values = rows.map(r => { const h = int(r.hours_count), m = int(r.max_count), max = str(r.max_hours, time(now)), elapsed = Math.abs(+now - Date.parse(max.replace(' ', 'T') + '+08:00')) / 86400000, period = Number.isFinite(elapsed) ? Math.max(1 / 24, elapsed) : Infinity, weight = h > 1 && m > 1 ? Math.sqrt(Math.max(0, Math.log(h) / period * Math.log(m) * 100)) : 0; return { pk: int(r.pk), tag: str(r.tag), ctime: str(r.ctime), mtime: str(r.mtime), max_count: m, hours_count: h, max_hours: max, no_tag: r.no_tag == null ? null : int(r.no_tag), weight: Math.round(weight * 1000) / 1000 }; });
        const uniqueValues = [...new Map(values.map(r => [r.tag, r])).values()];
        uniqueValues.sort((a, b) => sort === 'max_hours' ? str(b.max_hours).localeCompare(str(a.max_hours)) : Number(obj(b)[sort]) - Number(obj(a)[sort]));
        return payload(php(Object.fromEntries(uniqueValues.slice(0, limit).map(r => [r.tag, r]))), 'tags', { sort, limit });
    }
    if (name === 'tags_all') {
        const r = await publishedReportRow(db,'urt_show_data',{data_name:'tags_all'},(await db.rows(sql `SELECT * FROM urt_show_data WHERE data_name='tags_all' LIMIT 1`))[0]), result = remap(r?.the_result, ['result', 'tags_all', 'data'], ['tag', 'keyword', 'name']);
        return payload(result, 'urt_show_data.tags_all', { mtime: r?.mtime ?? null, cache_window:r?._cacheWindow??null, ...unknownViewMeta([r]), blocked_reason: nonempty(result) ? null : 'local tags_all cache is empty; legacy force mode is intentionally not run' });
    }
    if (name === 'video_tags' || name === 'video_tags_title') {
        const titleOnly = name === 'video_tags_title', table = titleOnly ? 'urt_show_video_tag_title' : 'urt_show_video_tag', pk = Math.max(0, int(q.pk, 17)), vid = txt(q, 'videoId'), v = (await db.rows(sql `SELECT * FROM urt_video WHERE ${vid ? sql `BINARY videoId=BINARY ${vid}` : sql `pk=${pk}`} LIMIT 1`))[0], c = v ? (await db.rows(sql `SELECT tags_json FROM ${sql.identifier(table)} WHERE pk_video=${v.pk} LIMIT 1`))[0] : undefined, cached = decode(c?.tags_json), info = { pk: int(v?.pk, pk), videoId: str(v?.videoId, vid) };
        if (nonempty(cached))
            return payload(cached, table + '.tags_json', info);
        const result = dict<number>(), text = v ? ' ' + str(v.title) + (titleOnly ? '' : ' ' + str(v.title) + ' ' + str(v.description)) : '';
        if (text.trim()) {
            const words = await db.rows(sql `SELECT tag FROM tags WHERE no_tag IS NULL OR no_tag<1`), lengths: Record<string, number> = dict();
            for (const r of words) {
                const s = str(r.tag);
                if (s && text.includes(s)) {
                    result[s] = text.split(s).length - 1;
                    lengths[s] = [...s].length;
                }
            }
            const ordered = Object.keys(lengths).sort((a, b) => lengths[b]! - lengths[a]!);
            for (let i = 0; i < ordered.length; i++)
                for (let j = i + 1; j < ordered.length; j++) {
                    const a = ordered[i]!, b = ordered[j]!;
                    if (a.includes(b))
                        result[b] = (result[b] ?? 0) - (result[a] ?? 0);
                }
        }
        return payload(Object.fromEntries(Object.entries(result).filter(([, n]) => n > 0).sort(([, a], [, b]) => b - a)), 'tags table computed real-time YouTube dashboard', { cache_table: table, ...info, title_only: titleOnly });
    }
    if (name === 'channels_list') {
        const f = filters(q), ids = await channelIds(db, q), rows = ids.length ? await db.rows(sql `SELECT * FROM urt_channel WHERE u_id IN (${sql.join(ids.map(id => sql `${id}`), sql `,`)}) ORDER BY viewCount DESC LIMIT ${bound(q, 'limit', 1000, 1000)}`) : [];
        return { result: rows.map(row => legacyRawCounts(row, 'urt_channel')), time: time(now), count_channels: rows.length, meta: meta('urt_channel + urt_count', rows.length > 0, { filters: f }) };
    }
    if (name === 'channel_videos' || name === 'channels_videos') {
        const multi = name === 'channels_videos', f = filters(q), uid = Math.max(0, int(q.u_id)), ids = multi ? await channelIds(db, q) : uid > 0 ? [uid] : [], hours = bound(q, 'hours', multi ? 72 : 24, 8760), min = Math.max(0, int(q.min, 100)), limit = bound(q, 'limit', 1000, 1000), start = time(now, -hours * 3600000), rows = ids.length ? await db.rows(sql `SELECT * FROM urt_video WHERE u_id IN (${sql.join(ids.map(id => sql `${id}`), sql `,`)}) AND publishedAt>=${start} AND ${min > 0 ? sql `viewCount>=${min}` : sql `(viewCount>=0 OR viewCount IS NULL)`} ORDER BY viewCount DESC,publishedAt DESC LIMIT ${limit}`) : [];
        let comments = 0;
        if (int(q.comments) > 0 && rows.length) {
            const cs = await db.rows(sql `SELECT * FROM urt_comment WHERE (pageToken IS NULL OR pageToken='') AND BINARY videoId IN (${sql.join(rows.map(r => sql `BINARY ${r.videoId}`), sql `,`)})`), map = new Map(cs.map(r => [r.videoId, r]));
            for (const r of rows) {
                const c = map.get(r.videoId), result = php(decode(c?.comments_json));
                comments += Object.keys(result).length;
                r.comments = { result, authors: php(decode(c?.authors_json)), latest_time: c?.latest_time ?? null, updated: c?.mtime ?? null, videoId: r.videoId ?? null };
            }
        }
        return { result: rows.map(row => legacyRawCounts(row, 'urt_video')), time: time(now), comments_count: comments, hours, start_time: start, min, count_videos: rows.length, meta: meta(multi ? 'urt_video + urt_count' : 'urt_video by channel', rows.length > 0, multi ? { filters: f } : {}) };
    }
    if (name === 'api_tag_log') {
        const f = filters(q), limit = bound(q, 'limit', 1000, 1000), ids = f.tagid.length || f.or.length || f.not.length ? await channelIds(db, q) : [], result = dict<Row>();
        if (ids.length > 500)
            throw new BadQuery('Legacy tag history is limited to 500 channels; narrow the classification filters.');
        const logs = ids.length ? await db.rows(sql `SELECT * FROM urt_log WHERE u_id IN (${sql.join(ids.map(id => sql `${id}`), sql `,`)}) ORDER BY themonth`) : [];
        const byChannel = new Map<number, Row[]>();
        for (const row of logs) {
            const id = int(row.u_id);
            const bucket = byChannel.get(id) ?? [];
            bucket.push(row);
            byChannel.set(id, bucket);
        }
        for (const uid of ids) {
            const log = await channelReport(db, { u_id: String(uid), limit: String(limit) }, now, false, { logs: byChannel.get(uid) ?? [] });
            for (const [d, r] of Object.entries(log.result)) {
                const out = result[d] ??= { count: 0, videos: 0, orig: 0, pred: 0, moving: 0 };
                out.count = int(out.count) + 1;
                for (const k of ['videos', 'orig', 'pred', 'moving'])
                    out[k] = int(out[k]) + int(r[k]);
            }
        }
        return payload(Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b))), 'urt_count.tags + urt_log.thedata', { tag: txt(q, 'tag'), filters: f, limit, count_channels: ids.length });
    }
    const f = filters(q, true), cw = cacheWhere(q);
    if (name === 'tags_day' || name === 'tags_video') {
        const days = bound(q, 'days', 3, 365), r = await publishedReportRow(db,'urt_show_tag_cloud',{...selectionKeys(f),days},(await db.rows(sql `SELECT * FROM urt_show_tag_cloud WHERE days=${days} AND tags_count>0 AND ${cw} ORDER BY pk DESC LIMIT 1`))[0]);
        return cachePayload(weighted(r?.tags_result), 'urt_show_tag_cloud', { filters: f, days, counts: { channels: int(r?.count_channels), videos: int(r?.count_videos), tags: int(r?.count_tags), tags_count: int(r?.tags_count) }, mtime: r?.mtime ?? null, cache_window:r?._cacheWindow??null, ...unknownViewMeta([r]) });
    }
    if (name === 'tags_relation_date') {
        const tag = txt(q, 'tag', '蔡英文'), d = dateQuery(q, 'date', date(now, -1)), r = await publishedReportRow(db,'urt_show_video_tag_date',{the_date:d,tag},(await db.rows(sql `SELECT * FROM urt_show_video_tag_date WHERE the_date=${d} AND BINARY tag=BINARY ${tag} LIMIT 1`))[0]);
        return { ...counts(r), result: php(weighted(r?.tags_json)), videos: php(weighted(r?.videos_json)), meta: meta('urt_show_video_tag_date', !!r, { tag, date: d, mtime: r?.mtime ?? null, cache_window:r?._cacheWindow??null }) };
    }
    if (name === 'tag_tags_days') {
        const tag = txt(q, 'tag', '柯文哲'), days = bound(q, 'days', 3, 365), r = await publishedReportRow(db,'urt_show_tag_cloud_tag',{...selectionKeys(f),tag,days},(await db.rows(sql `SELECT * FROM urt_show_tag_cloud_tag WHERE BINARY tag=BINARY ${tag} AND days=${days} AND ${cw} LIMIT 1`))[0]), result = wrapped(r?.tags_result, ['tags_result', 'tags', 'result', 'data']);
        return { result, time: r?.mtime ?? null, ...counts(r, ['count_channels', 'count_videos', 'count_tags', 'tags_count']), videos: php(wrapped(r?.videos_json, ['videos_json', 'videos', 'result', 'data'])), meta: meta('urt_show_tag_cloud_tag', !!r && nonempty(result), { filters: f, tag, days, ...unknownViewMeta([r]) }) };
    }
    const tag = txt(q, 'tag', '蔡英文'), days = bound(q, 'days', 60, 1095), month = /^\d{4}-\d{2}-01$/.test(str(q.month)) && str(q.month) >= '2010-01-01' ? str(q.month) : date(now).slice(0, 7) + '-01', from = date(now, -days).slice(0, 7) + '-01', to = date(now).slice(0, 7) + '-01', sourceRows = await db.rows(sql `SELECT * FROM urt_show_tag_month WHERE BINARY tag=BINARY ${tag} AND ${cw} AND ${name === 'tag_month' ? sql `the_month=${month}` : sql `the_month BETWEEN ${from} AND ${to}`} ${name === 'tag_month' ? sql `LIMIT 1` : sql `ORDER BY the_month`}`), rows=(await Promise.all(sourceRows.map(row=>publishedReportRow(db,'urt_show_tag_month',{...selectionKeys(f),the_month:str(row.the_month).slice(0,10),tag},row)))).filter((row):row is Row=>!!row), result = dict<unknown>();
    for (const r of rows)
        Object.assign(result, remap(r.tags_result, ['tags_result', 'period', 'daily', 'result', 'data'], ['date', 'the_date']));
    return cachePayload(result, name === 'tag_month' ? 'urt_show_tag_month' : 'urt_show_tag_month period', name === 'tag_month' ? { filters: f, tag, month, count_videos: int(rows[0]?.count_videos), total_views: int(rows[0]?.total_views), mtime: rows[0]?.mtime ?? null } : { filters: f, tag, days, from_month: from, to_month: to });
}
