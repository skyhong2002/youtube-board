import { sql, type SQL } from 'drizzle-orm';
import type { Reader, Row } from '../db/client.js';
import { taipeiSql } from '../reports/normalize.js';
export type Q = Record<string, unknown>;
// Only SQL integer count columns returned as raw rows by these legacy readers.
// mysql2 deliberately returns BIGINT as strings; retain that lossless value when
// it cannot be represented exactly as a JavaScript JSON number.
const rawCountColumns = {
    urt_channel: ['viewCount', 'commentCount', 'subscriberCount', 'videoCount'],
    urt_video: ['viewCount', 'likeCount', 'dislikeCount', 'favoriteCount', 'commentCount'],
    urt_video_live_log_tvbs: ['max_current'],
} as const;
const minSafeCount = BigInt(Number.MIN_SAFE_INTEGER);
const maxSafeCount = BigInt(Number.MAX_SAFE_INTEGER);
export function legacyRawCounts(row: Row, table: keyof typeof rawCountColumns): Row {
    const result = { ...row };
    for (const column of rawCountColumns[table]) {
        if (!Object.hasOwn(result, column)) continue;
        const value = result[column];
        if (typeof value !== 'string' || !/^-?\d+$/.test(value)) continue;
        const integer = BigInt(value);
        if (integer >= minSafeCount && integer <= maxSafeCount) result[column] = Number(integer);
    }
    return result;
}
export const str = (v: unknown, fallback = ''): string => typeof v === 'string' ? v : fallback;
export const int = (v: unknown, fallback = 0): number => v === undefined ? fallback : typeof v === 'boolean' ? v ? 1 : 0 : Number.isFinite(Number.parseFloat(String(v))) ? Math.trunc(Number.parseFloat(String(v))) : 0;
export const bound = (q: Q, k: string, d: number, max: number, min = 1) => Math.max(min, Math.min(max, int(q[k], d)));
export const txt = (q: Q, k: string, d = '') => str(q[k], d).trim() || d;
export const obj = (v: unknown): Row => v !== null && typeof v === 'object' ? v as Row : {};
export function decode(v: unknown): Row {
    try {
        return obj(typeof v === 'string' ? JSON.parse(v) : null);
    }
    catch {
        return {};
    }
}
export const nonempty = (v: unknown) => Object.keys(obj(v)).length > 0;
export const php = (v: Row): Row | never[] => nonempty(v) ? v : [];
export const dict = <T>(): Record<string, T> => Object.create(null) as Record<string, T>;
export const time = (now: Date, offset = 0) => taipeiSql(new Date(+now + offset));
export const date = (now: Date, offset = 0) => time(now, offset * 86400000).slice(0, 10);
export const addDay = (day: string, n: number) => new Date(Date.parse(day + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
export function dateQuery(q: Q, k: string, fallback: string, min = '2010-01-01', ceiling?: string) { const v = str(q[k], fallback); return /^\d{4}-\d{2}-\d{2}$/.test(v) && v >= min ? ceiling && v > ceiling ? ceiling : v : fallback; }
export function boundedDate(v: unknown, fallback: string, min: string) { const s = str(v, fallback); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s < min ? min : s > fallback ? fallback : s : fallback; }
export function ids(v: unknown, sorted = false): number[] { const values = Array.isArray(v) ? v : str(v).split(','); const out = [...new Set(values.map(x => int(x)).filter(x => x > 0 && Number.isSafeInteger(x)))]; return sorted ? out.sort((a, b) => a - b) : out; }
export function filters(q: Q, sorted = false) { const f = { tagid: ids(q.tagid, sorted), or: ids(q.or, sorted), not: ids(q.not, sorted) }; return sorted ? { ...f, tagid_string: f.tagid.join(','), or_string: f.or.join(','), not_string: f.not.join(',') } : { ...f, limit: bound(q, 'limit', 1000, 1000) }; }
export function cacheWhere(q: Q): SQL { const f = filters(q, true); return sql.join([['tagid', f.tagid], ['tag_or', f.or], ['tag_not', f.not]].map(([column, values]) => { const c = sql.identifier(column as string), value = (values as number[]).join(','); return value ? sql `${c}=${value}` : sql `(${c} IS NULL OR ${c}='')`; }), sql ` AND `); }
export function channelWhere(q: Q, column = 'tags'): SQL {
    const f = filters(q), c = sql.identifier(column), clauses: SQL[] = [sql `1=1`];
    for (const id of f.tagid)
        clauses.push(sql `${c} LIKE ${'%[' + id + ']%'}`);
    for (const id of f.not)
        clauses.push(sql `${c} NOT LIKE ${'%[' + id + ']%'}`);
    if (f.or.length)
        clauses.push(sql `(${sql.join(f.or.map(id => sql `${c} LIKE ${'%[' + id + ']%'}`), sql ` OR `)})`);
    return sql.join(clauses, sql ` AND `);
}
export async function channelIds(db: Reader, q: Q) { return (await db.rows(sql `SELECT u_id,tags FROM urt_count WHERE ${channelWhere(q)}`)).map(r => int(r.u_id)); }
export const meta = (source: string, available: boolean, extra: Row = {}) => ({ ...extra, available, source, realtime_dashboard: true });
export const payload = (result: unknown, source: string, extra: Row = {}) => ({ result, meta: meta(source, nonempty(result), extra) });
export function wrapped(v: unknown, keys: string[]) {
    const d = decode(v);
    for (const k of keys)
        if (d[k] && typeof d[k] === 'object')
            return obj(d[k]);
    return d;
}
export function weighted(v: unknown, cloud = false) {
    const d = wrapped(v, cloud ? ['keywords_json', 'keywords', 'tags_result', 'tags_video', 'tags_views', 'tags', 'result', 'data'] : ['tags_json', 'videos_json', 'tags_result', 'tags_video', 'tags_views', 'tags', 'videos', 'result', 'data']), out = dict<unknown>();
    for (const [k, val] of Object.entries(d)) {
        if (val && typeof val === 'object') {
            const r = obj(val), name = String(r.tag ?? r.keyword ?? r.word ?? (!cloud ? (r.videoId ?? r.video_id ?? r.id) : undefined) ?? k), count = r.count ?? r.weight ?? r.score ?? r.value ?? (!cloud ? r.views : undefined);
            if (name && count !== undefined && count !== null)
                out[name] = count;
        }
        else if (!Array.isArray(d))
            out[k] = val;
    }
    return out;
}
export function remap(v: unknown, wrappers: string[], names: string[]) {
    const d = wrapped(v, wrappers), out = dict<unknown>();
    for (const [k, val] of Object.entries(d)) {
        if (val && typeof val === 'object') {
            const r = { ...obj(val) }, name = String(names.map(n => r[n]).find(x => x !== null && x !== undefined) ?? k);
            for (const n of names)
                delete r[n];
            if (name)
                out[name] = r;
        }
        else if (!Array.isArray(d))
            out[k] = val;
    }
    return out;
}
export const counts = (r: Row | undefined, keys = ['count_channels', 'count_videos', 'count_tags']) => Object.fromEntries(keys.map(k => [k, int(r?.[k])]));
/** Numeric tests match PHP is_numeric; hexadecimal strings are not measurements. */
export const numeric = (v: unknown): boolean => (typeof v === 'number' || typeof v === 'string' && /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(v.trim())) && Number.isFinite(Number(v));
export const scalarString = (v: unknown) => typeof v === 'boolean' ? v ? '1' : '' : String(v);
/** Keep original object-key order where first-topic/first-period-PK selection is semantic.
 * JSON.parse validates syntax first; this scanner only records root value spans.
 */
export function orderedJsonValues(raw: unknown, wrappers: string[] = []): unknown[] {
    if (typeof raw !== 'string')
        return [];
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        return [];
    }
    if (!parsed || typeof parsed !== 'object')
        return [];
    if (Array.isArray(parsed))
        return parsed;
    const source = raw.trim(), entries = new Map<string, string>();
    let i = 1;
    const whitespace = () => { while (/\s/.test(source[i] ?? '') && i < source.length)
        i++; };
    const quotedEnd = (start: number) => { let p = start + 1; while (p < source.length) {
        if (source[p] === '\\')
            p += 2;
        else if (source[p++] === '"')
            return p;
    } return p; };
    while (i < source.length - 1) {
        whitespace();
        if (source[i] === '}')
            break;
        const endKey = quotedEnd(i), key = JSON.parse(source.slice(i, endKey)) as string;
        i = endKey;
        whitespace();
        i++;
        whitespace();
        const start = i;
        let depth = 0;
        while (i < source.length) {
            const c = source[i];
            if (c === '"') {
                i = quotedEnd(i);
                continue;
            }
            if (c === '{' || c === '[')
                depth++;
            else if (c === '}' || c === ']') {
                if (!depth)
                    break;
                depth--;
            }
            else if (c === ',' && !depth)
                break;
            i++;
        }
        entries.set(key, source.slice(start, i));
        if (source[i] === ',')
            i++;
        else
            break;
    }
    for (const key of wrappers)
        if (entries.has(key) && obj(parsed)[key] && typeof obj(parsed)[key] === 'object')
            return orderedJsonValues(entries.get(key));
    return [...entries.values()].map(value => JSON.parse(value));
}
