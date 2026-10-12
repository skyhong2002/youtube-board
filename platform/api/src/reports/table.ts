import { sql, type SQL } from 'drizzle-orm';
import type { ReportData, ReportColumn, ReportCell, ReportValue } from '../report-contracts.js';
import { page, bounded, dateFilter, idList, BadQuery, type Query } from './query.js';
import { taipeiDate, object, list, text } from './normalize.js';
import type {ChannelIdentity} from './channel-identity.js';
export type Register = (path: string, handler: (params: Record<string, string>, query: Query, channel?:ChannelIdentity) => Promise<unknown>) => unknown;
export function table(title: string, columns: ReportColumn[], rows: Record<string, ReportValue | ReportCell>[], query: Query = {}, extra: Partial<ReportData> = {}): ReportData { const { limit, offset } = page(query); return { title, columns, rows: rows.slice(offset, offset + limit), total: rows.length, limit, offset, ...extra }; }
export function range(query: Query, clock: () => Date, defaultDays = 7, maxDays = 366) {
    const days = bounded(query.days, defaultDays, 1, maxDays), today = bounded(query.today, 0, 0, 3650);
    const to = dateFilter(query.to) ?? taipeiDate(new Date(+clock() - today * 86400000)), from = dateFilter(query.from) ?? new Date(Date.parse(to) - (days - 1) * 86400000).toISOString().slice(0, 10);
    if (from > to || Date.parse(to) - Date.parse(from) > (maxDays - 1) * 86400000)
        throw new BadQuery(`Date range must be ordered and no longer than ${maxDays} days.`);
    const dates: string[] = [];
    for (let at = Date.parse(from); at <= Date.parse(to); at += 86400000)
        dates.push(new Date(at).toISOString().slice(0, 10));
    return { from, to, dates };
}
export function cacheFilters(query: Query): SQL { return sql `COALESCE(tagid,'')=${idList(query.tagid).sort((a, b) => a - b).join(',')} AND COALESCE(tag_or,'')=${idList(query.or).sort((a, b) => a - b).join(',')} AND COALESCE(tag_not,'')=${idList(query.not).sort((a, b) => a - b).join(',')}`; }
export {weights} from './weights.js';
export function link(value: string, href: string): {
    value: string;
    href: string;
} { return { value, href }; }
