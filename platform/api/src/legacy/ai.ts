import { dailyLineage } from '../reports/ai-lineage.js';
import { sql } from 'drizzle-orm';
import type { Reader, Row } from '../db/client.js';
import { addDay, date, decode, dict, int, meta, nonempty, obj, payload, php, numeric, scalarString, orderedJsonValues, str, time, txt, wrapped, type Q } from './common.js';
const cond = (value: unknown, fallback = 'all') => /^[a-zA-Z0-9_-]{1,40}$/.test(str(value)) ? str(value) : fallback;
const validDate = (value: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(str(value)) ? str(value) : null;
const title = (v: unknown) => {
    const r = obj(v);
    for (const k of ['標題', '議題', 'title', 'topic'])
        if (r[k] !== undefined && r[k] !== null && typeof r[k] !== 'object')
            return scalarString(r[k]).trim();
    return '';
};
const topics = (v: unknown) => orderedJsonValues(v, ['events', '事件', 'topics', '議題', 'result', 'data']);
const strings = (v: unknown) => [...new Set(Object.values(obj(v)).filter(x => ['string', 'number', 'boolean'].includes(typeof x)).map(x => scalarString(x).trim()).filter(Boolean))];
export async function aiReport(db: Reader, name: string, q: Q, now: Date): Promise<unknown> {
    if (name === 'api_comment') {
        const vid = txt(q, 'videoId', 'azzXesons8Q'), r = (await db.rows(sql `SELECT * FROM urt_comment WHERE BINARY videoId=BINARY ${vid} AND (pageToken IS NULL OR pageToken='') LIMIT 1`))[0];
        return { result: decode(r?.comments_json), authors: decode(r?.authors_json), latest_time: r?.latest_time ?? null, updated: r?.mtime ?? null, videoId: vid, meta: meta('urt_comment', !!r, { log_write_skipped: 'legacy urt_log_api insert is handled by Laravel ingestion jobs', blocked_reason: r ? null : 'local urt_comment has no row for this video' }) };
    }
    const condition = cond(q.condition), type = cond(q.type, 'oneday'), conditionWhere = condition === 'all' ? sql `(condition_type IS NULL OR condition_type='all')` : sql `condition_type=${condition}`, pk = int(q.pk);
    let r: Row | undefined;
    if (pk > 0)
        r = (await db.rows(sql `SELECT * FROM urt_ai_date WHERE pk=${pk} LIMIT 1`))[0];
    else {
        let d = validDate(q.date);
        if (!d && name !== 'api_topic') {
            const latest = (await db.rows(sql `SELECT MAX(date_from) AS d FROM urt_ai_date WHERE del_flag IS NULL AND data_type IN ('todate','oneday') AND ${conditionWhere}`))[0];
            d = str(latest?.d).slice(0, 10) || null;
        }
        d ??= date(now);
        const from = validDate(q.from) ?? d, to = validDate(q.to) ?? d;
        r = (await db.rows(sql `SELECT * FROM urt_ai_date WHERE del_flag IS NULL AND date_from=${from + ' 00:00:00'} AND date_to=${to + ' 23:59:59'} AND ${conditionWhere} ORDER BY pk DESC LIMIT 1`))[0];
    }
    if (!r)
        return payload({}, name === 'ai_day' ? 'urt_ai_date' : name === 'api_topic' ? 'urt_ai_date topic' : 'urt_ai_date event', name === 'api_topic' ? { condition, type } : { condition });
    const channelId = dict<string>();
    for (const [k, v] of Object.entries(decode(r.channel_id)))
        if (numeric(k) && v !== null && ['string', 'number', 'boolean'].includes(typeof v))
            channelId[int(k)] = scalarString(v);
    if (name === 'ai_day') {
        const lineage = await dailyLineage(db, r);
        if (lineage) {
            for (const k of Object.keys(channelId))
                delete channelId[k];
            for (const [id, title] of lineage.channels)
                channelId[id] = title;
        }
        const ids = Object.keys(channelId).map(Number), rows = !lineage && ids.length ? await db.rows(sql `SELECT u_id,result_json FROM urt_channel_ai WHERE u_id IN (${sql.join(ids.map(id => sql `${id}`), sql `,`)}) AND date_from=${r.date_from} AND date_to=${r.date_to} AND del_flag IS NULL ORDER BY pk DESC`) : [], channel = dict<unknown>();
        if (lineage)
            for (const [id, source] of lineage.sources)
                channel[id] = typeof source.result_json === 'string' ? decode(source.result_json) : source.result_json;
        for (const c of rows)
            if (!Object.hasOwn(channel, String(c.u_id)))
                channel[String(c.u_id)] = decode(c.result_json);
        return { result: decode(r.result_json), channel: php(channel), channel_id: php(channelId), time: time(now), date: str(r.date_from).slice(0, 10), from: str(r.date_from).slice(0, 10), to: str(r.date_to).slice(0, 10), meta: meta(lineage?.state === 'immutable-snapshot' ? 'urt_ai_date + ts_ai_runs immutable source snapshot' : lineage ? 'urt_ai_date (lineage snapshot unavailable)' : 'urt_ai_date + urt_channel_ai', true, { ...(lineage ? { lineage: { state: lineage.state, runId: lineage.runId }, projection_complete: lineage.state === 'immutable-snapshot', blocked_reason: lineage.state === 'immutable-snapshot' ? null : 'immutable daily source snapshot is unavailable' } : {}), pk: int(r.pk), condition: r.condition_type || condition, data_type: r.data_type ?? null }) };
    }
    if (name === 'api_topic') {
        const video = decode(r.video_json), cached = decode(r.data_json), hasCache = nonempty(video) && nonempty(cached), used = hasCache && int(q.force) < 1, topic = dict<unknown>();
        if (!used)
            for (const t of topics(r.result_json)) {
                const s = title(t), a = obj(t), media = obj(a['媒體事件'] ?? a.media_events ?? a.mediaEvents);
                if (s)
                    topic[s] = { '媒體數': Object.keys(media).length, '影片數': Object.values(media).reduce<number>((n, v) => n + Object.keys(obj(v)).length, 0), videos: {}, '關鍵字': {}, '關鍵字次數': {}, '人物': {}, '標籤': {} };
            }
        return { result: { video: used ? video : {}, topic: used ? cached : topic, channel_id: php(channelId), raw: decode(r.result_json) }, response_time: time(now), cache_time: r.mtime ?? null, pk: int(r.pk), meta: meta(used ? 'urt_ai_date.data_json/video_json' : 'urt_ai_date.result_json derived real-time YouTube dashboard', true, { condition: r.condition_type || condition, type, cache_writeback_skipped: !used, cache_available: hasCache, cache_builder: 'reports:ai-topic:build' }) };
    }
    const current = str(r.date_to).slice(0, 10), event = txt(q, 'event') || title(topics(r.result_json)[0]), total = int((await db.rows(sql `SELECT COUNT(*) AS n FROM urt_ai_period`))[0]?.n), match = dict<string[]>(), pks = dict<string>();
    pks[current] = String(r.pk);
    let last = [event], lastPk = String(r.pk);
    if (event)
        match[current] = last;
    if (event)
        for (let offset = 0; offset < 60; offset++) {
            const to = addDay(current, -offset), from = addDay(current, -offset - 1), period = (await db.rows(sql `SELECT * FROM urt_ai_period WHERE DATE(date_from)=${from} AND DATE(date_to)=${to} AND del_flag IS NULL AND condition_type=${r.condition_type || 'all'} ORDER BY pk DESC LIMIT 1`))[0];
            if (!period)
                break;
            const hits: string[] = [];
            for (const pair of Object.values(decode(period.result_json))) {
                const p = obj(pair), after = strings(p[to]), before = strings(p[from]);
                if (before.length && after.some(x => last.includes(x)))
                    hits.push(...before);
            }
            if (!hits.length)
                break;
            last = [...new Set(hits)];
            match[from] = last;
            for (const id of strings(orderedJsonValues(period.data_json)))
                if (id !== lastPk) {
                    pks[from] = id;
                    lastPk = id;
                    break;
                }
        }
    const prefetch = Object.hasOwn(q, 'prefetch'), result: Row = { match, pk: pks }, m: Row = meta('urt_ai_date' + (total > 0 ? ' + urt_ai_period' : ''), !!event, { pk: int(r.pk), event, condition: r.condition_type || condition, history_available: total > 0, period_rows: total, blocked_reason: !event ? 'missing event name' : total === 0 ? 'local urt_ai_period has no rows, so legacy multi-day event tracing is unavailable' : Object.keys(match).length > 1 ? null : 'local urt_ai_period has no matching previous-day event chain for this event' });
    if (prefetch) {
        result.keyword = { date: {}, meta: {} };
        m.prefetch = { keyword_shells: 'empty', topic_cache_source: 'urt_ai_date.data_json/video_json', topic_cache_builder: 'reports:ai-topic:build' };
    }
    return { result, meta: m };
}
