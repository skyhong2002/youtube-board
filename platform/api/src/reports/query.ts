import { SEARCH_MAX_LENGTH } from '../../../shared/report-limits.js';
import { sql, type SQL } from 'drizzle-orm';
export type Query = Record<string, unknown>;
export class BadQuery extends Error {
    constructor(message = 'Invalid report query.') { super(message); }
}
export class NotFound extends Error {
    constructor() { super('Requested record was not found.'); }
}
export function positiveId(value: unknown): number {
    const str = String(value ?? '');
    if (!/^\d+$/.test(str) || !Number.isSafeInteger(Number(str)) || Number(str) < 1)
        throw new BadQuery('ID must be a positive integer.');
    return Number(str);
}
export function videoId(value: unknown): string {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(value))
        throw new BadQuery('Invalid YouTube video ID.');
    return value;
}
export function page(query: Query): {
    limit: number;
    offset: number;
} {
    const limit = bounded(query.limit, 50, 1, 200), offset = bounded(query.offset, 0, 0, 100000);
    return { limit, offset };
}
export function bounded(value: unknown, fallback: number, min: number, max: number): number {
    if (value === undefined)
        return fallback;
    if (typeof value !== 'string' || !/^\d+$/.test(value))
        throw new BadQuery('Expected a nonnegative integer query value.');
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < min || n > max)
        throw new BadQuery(`Value must be between ${min} and ${max}.`);
    return n;
}
export function dateFilter(value: unknown): string | null {
    if (value === undefined)
        return null;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)
        throw new BadQuery('Expected a valid YYYY-MM-DD date.');
    return value;
}
export function idList(value: unknown): number[] {
    if (value === undefined || value === '')
        return [];
    if (typeof value !== 'string' || value.length > 256)
        throw new BadQuery('Invalid tag ID list.');
    return [...new Set(value.split(',').map(positiveId))];
}
export function tagFilter(query: Query): SQL {
    const all = idList(query.tagid), any = idList(query.or), not = idList(query.not);
    const parts: SQL[] = [sql `1=1`];
    for (const id of all)
        parts.push(sql `COALESCE(n.tags, '') LIKE ${`%[${id}]%`}`);
    if (any.length)
        parts.push(sql `(${sql.join(any.map(id => sql `COALESCE(n.tags, '') LIKE ${`%[${id}]%`}`), sql ` OR `)})`);
    for (const id of not)
        parts.push(sql `COALESCE(n.tags, '') NOT LIKE ${`%[${id}]%`}`);
    return sql.join(parts, sql ` AND `);
}
export function search(value: unknown): string | null {
    if (value === undefined || value === '')
        return null;
    if (typeof value !== 'string' || value.length > SEARCH_MAX_LENGTH)
        throw new BadQuery(`Search text must be at most ${SEARCH_MAX_LENGTH} characters.`);
    // '=' escape avoids SQL mode-dependent backslash behavior.
    return `%${value.replace(/[=%_]/g, m => '=' + m)}%`;
}
export function mergeTagId(value: unknown, required: number): string { return [...new Set([required, ...idList(value)])].sort((a, b) => a - b).join(','); }
/** Bind cursor filters by effective set membership, independent of input order. */
export function normalizedIdList(value:unknown):number[]{return idList(value).sort((a,b)=>a-b);}

/** Exact anonymous publication bounds used by ranked-pool evidence links. */
export function utcPublicationWindow(since:unknown,until:unknown,now:Date){
 if((since===undefined||since==='')&&(until===undefined||until===''))return null;
 const valid=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.000Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
 if(!valid(since)||!valid(until)||Date.parse(since)>=Date.parse(until)||Date.parse(until)>now.getTime()||Date.parse(until)-Date.parse(since)>90*86400000)throw new BadQuery('Expected a complete past half-open UTC publication window.');
 return {since,until};
}
