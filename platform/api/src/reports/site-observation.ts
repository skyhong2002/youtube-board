// Public GA4 / Search Console aggregates for 本站流量 (/observe), read from ts_site_metrics, which the cache worker's
// site.analytics.sync / site.analytics.live jobs fill (jobs/src/site-analytics-cli.ts). Ported from tag.observe.tw
// app/src/v1/site-observation.ts; the web process never touches Google credentials.
import { sql, type SQL } from 'drizzle-orm';
import { DataQueryFailed, DataSourceUnavailable, type Reader } from '../db/client.js';
import { BadQuery, type Query } from './query.js';
import type { Register } from './table.js';
import {
  CONTENT_PATH_REGEXP, DEFAULT_OBSERVATION_DAYS, LIVE_STALE_MS, OBSERVATION_DAYS, VITAL_NAMES, pageKind, pageTitle, shiftDay, taipeiDay, type ObservationDays, type PageKind,
} from '../../../shared/site-analytics.js';

export interface ObservedPage { path: string; kind: PageKind; title: string; views: number }
export interface SearchPage { path: string; kind: PageKind; title: string; clicks: number; impressions: number }
export interface Share { name: string; value: number }
export interface SiteObservation {
  updatedAt: string | null;
  live: { fetchedAt: string; activeUsers: number; views: number; perMinute: number[] } | null;
  days: ObservationDays; start: string; end: string; trackingSince: string | null;
  traffic: { daily: Array<{ date: string; views: number; sessions: number; users: number }>; views: number; sessions: number; channels: Share[]; devices: Share[]; events: Share[] } | null;
  pages: ObservedPage[]; content: ObservedPage[];
  search: { daily: Array<{ date: string; clicks: number; impressions: number; position: number }>; clicks: number; impressions: number; position: number | null; pages: SearchPage[] } | null;
  vitals: Array<{ name: string; good: number; needsImprovement: number; poor: number }> | null;
}

export function observationDays(query: Query): ObservationDays {
  const raw = query.days;
  if (raw === undefined) return DEFAULT_OBSERVATION_DAYS;
  const days = typeof raw === 'string' && /^\d{1,2}$/.test(raw) ? Number(raw) : NaN;
  if (!(OBSERVATION_DAYS as readonly number[]).includes(days)) throw new BadQuery('days must be 7, 28 or 90.');
  return days as ObservationDays;
}

const round = (n: number, digits = 0) => Math.round(n * 10 ** digits) / 10 ** digits;
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
/** Every day from start to end, so charts show quiet days as zero instead of skipping them. */
export function dayRange(start: string, end: string) {
  const days: string[] = [];
  for (let d = start; d <= end; d = shiftDay(d, 1)) days.push(d);
  return days;
}
const list = (values: readonly (string | number)[]) => sql.join(values.map(v => sql`${v}`), sql`,`);
const notProvisioned = (error: unknown) => error instanceof DataQueryFailed && error.driverCode === 'ER_NO_SUCH_TABLE' || error instanceof DataSourceUnavailable && error.cause === 'ER_TABLEACCESS_DENIED_ERROR';

/** The last 30 minutes from site.analytics.live, oldest minute first; null when missing or stale. */
export function liveObservation(rows: Array<{ metric: string; item: string; value: number }>, now: Date): SiteObservation['live'] {
  const get = (metric: string) => rows.find(r => r.metric === metric && r.item === '')?.value;
  const fetchedAt = get('fetched_at');
  if (!fetchedAt || now.getTime() - fetchedAt > LIVE_STALE_MS || fetchedAt > now.getTime() + 60e3) return null;
  const perMinute = Array.from({ length: 30 }, (_, i) => rows.find(r => r.metric === 'minute_views' && r.item === String(29 - i).padStart(2, '0'))?.value ?? 0);
  return { fetchedAt: new Date(fetchedAt).toISOString(), activeUsers: get('active_users') ?? 0, views: get('views') ?? 0, perMinute };
}

/** Titles from the dashboard's own tables for the content pages listed (GA titles are the fixed site name). */
async function pageNames(reader: Reader, paths: string[]): Promise<Map<string, string>> {
  const ids = (re: RegExp) => [...new Set(paths.flatMap(p => { const m = re.exec(p); return m ? [m[1]!] : []; }))].slice(0, 100);
  const videos = ids(/^\/(?:live\/)?videos\/([A-Za-z0-9_-]{11})(?:\/|$)/), channels = ids(/^\/channels\/(\d{1,15})(?:\/|$)/).map(Number);
  const categories = ids(/^\/tags\/(\d{1,9})\//).map(Number), topics = ids(/^\/ai\/events\/(\d{1,15})(?:\/|$)/).map(Number);
  const names = new Map<string, string>();
  const add = (kind: string, rows: Array<Record<string, unknown>>) => { for (const r of rows) { const title = str(r.title).trim(); if (title) names.set(`${kind}:${str(r.id)}`, title); } };
  const read = async (query: SQL) => reader.rows(query, { operation: 'other' });
  if (videos.length) add('video', (await read(sql`SELECT videoId AS id,LEFT(title,200) AS title FROM urt_video WHERE videoId IN (${list(videos)}) ORDER BY pk DESC LIMIT 500`))
    .filter(r => videos.includes(str(r.id))).filter((r, i, all) => all.findIndex(o => str(o.id) === str(r.id)) === i));
  if (channels.length) add('channel', await read(sql`SELECT u_id AS id,LEFT(title,200) AS title FROM urt_channel WHERE u_id IN (${list(channels)}) LIMIT 100`));
  if (categories.length) add('category', await read(sql`SELECT tag_id AS id,LEFT(tag_name,200) AS title FROM urt_tag WHERE tag_id IN (${list(categories)}) LIMIT 100`));
  if (topics.length) add('topic', await read(sql`SELECT pk AS id,LEFT(event_name,200) AS title FROM urt_ai_event WHERE pk IN (${list(topics)}) AND del_flag IS NULL LIMIT 100`));
  return names;
}

function empty(days: ObservationDays, start: string, end: string): SiteObservation {
  return { updatedAt: null, live: null, days, start, end, trackingSince: null, traffic: null, pages: [], content: [], search: null, vitals: null };
}

export async function siteObservation(reader: Reader, days: ObservationDays, now = new Date()): Promise<SiteObservation> {
  const end = taipeiDay(now), start = shiftDay(end, 1 - days);
  const rows = async (query: SQL) => reader.rows(query, { operation: 'other' });
  let state;
  try {
    state = await rows(sql`SELECT source,metric,item,value FROM ts_site_metrics WHERE source IN ('rt','meta')`);
  } catch (error) {
    // Only a missing table or grant means "not provisioned yet"; outages still fail the request.
    if (notProvisioned(error)) return empty(days, start, end);
    throw error;
  }
  const realtime = state.filter(r => r.source === 'rt').map(r => ({ metric: str(r.metric), item: str(r.item), value: num(r.value) }));
  const synced = state.find(r => r.source === 'meta' && r.metric === 'synced_at');
  const base = { ...empty(days, start, end), updatedAt: synced ? new Date(num(synced.value)).toISOString() : null, live: liveObservation(realtime, now) };
  const [first] = await rows(sql`SELECT DATE_FORMAT(MIN(CASE WHEN source='ga' THEN day END),'%Y-%m-%d') AS ga,DATE_FORMAT(MIN(day),'%Y-%m-%d') AS any_day FROM ts_site_metrics WHERE source IN ('ga','gsc')`);
  if (!first?.any_day) return base;
  const trackingSince = first.ga ? str(first.ga) : null;
  const inRange = sql`day BETWEEN ${start} AND ${end}`;
  const totals = await rows(sql`SELECT DATE_FORMAT(day,'%Y-%m-%d') AS day,source,metric,value FROM ts_site_metrics WHERE ${inRange} AND item='' AND source IN ('ga','gsc') AND metric IN ('views','sessions','users','clicks','impressions','position')`);
  const byDay = (source: string) => {
    const map = new Map<string, Record<string, number>>();
    for (const r of totals.filter(r => r.source === source)) map.set(str(r.day), { ...map.get(str(r.day)), [str(r.metric)]: num(r.value) });
    return map;
  };
  const breakdown = async (metric: string, limit = 20): Promise<Share[]> =>
    (await rows(sql`SELECT item,SUM(value) AS total FROM ts_site_metrics WHERE ${inRange} AND source='ga' AND metric=${metric} GROUP BY item ORDER BY total DESC,item LIMIT ${limit}`))
      .map(r => ({ name: str(r.item), value: num(r.total) }));
  const topPages = async (source: string, metric: string, content: boolean, limit: number) =>
    (await rows(sql`SELECT item,SUM(value) AS total FROM ts_site_metrics WHERE ${inRange} AND source=${source} AND metric=${metric}${content ? sql` AND item REGEXP ${CONTENT_PATH_REGEXP}` : sql``} GROUP BY item ORDER BY total DESC,item LIMIT ${limit}`))
      .map(r => ({ path: str(r.item), value: num(r.total) }));

  let traffic: SiteObservation['traffic'] = null;
  const [pages, content] = await Promise.all([topPages('ga', 'page_views', false, 20), topPages('ga', 'page_views', true, 10)]);
  if (trackingSince && trackingSince <= end) {
    const ga = byDay('ga');
    const daily = dayRange(trackingSince > start ? trackingSince : start, end).map(date => ({ date, views: ga.get(date)?.views ?? 0, sessions: ga.get(date)?.sessions ?? 0, users: ga.get(date)?.users ?? 0 }));
    const [channels, devices, events] = await Promise.all([breakdown('channel'), breakdown('device'), breakdown('event')]);
    traffic = { daily, views: daily.reduce((n, d) => n + d.views, 0), sessions: daily.reduce((n, d) => n + d.sessions, 0), channels, devices, events };
  }

  const gsc = byDay('gsc');
  let searchPages: Array<{ path: string; value: number }> = [], impressionsByPage = new Map<string, number>();
  if (gsc.size) {
    searchPages = await topPages('gsc', 'page_clicks', false, 10);
    if (searchPages.length) impressionsByPage = new Map((await rows(sql`SELECT item,SUM(value) AS total FROM ts_site_metrics WHERE ${inRange} AND source='gsc' AND metric='page_impressions' AND item IN (${list(searchPages.map(p => p.path))}) GROUP BY item`)).map(r => [str(r.item), num(r.total)]));
  }
  const names = await pageNames(reader, [...pages, ...content, ...searchPages].map(p => p.path));
  const titled = (list: Array<{ path: string; value: number }>): ObservedPage[] => list.map(p => ({ path: p.path, kind: pageKind(p.path), title: pageTitle(p.path, names), views: p.value }));

  let search: SiteObservation['search'] = null;
  if (gsc.size) {
    const daily = [...gsc].sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, clicks: v.clicks ?? 0, impressions: v.impressions ?? 0, position: round(v.position ?? 0, 1) }));
    const clicks = daily.reduce((n, d) => n + d.clicks, 0), impressions = daily.reduce((n, d) => n + d.impressions, 0);
    search = {
      daily, clicks, impressions,
      // Impression-weighted, as Search Console's own overview computes it.
      position: impressions ? round(daily.reduce((n, d) => n + d.position * d.impressions, 0) / impressions, 1) : null,
      pages: titled(searchPages).map(({ views, ...p }) => ({ ...p, clicks: views, impressions: impressionsByPage.get(p.path) ?? 0 })),
    };
  }

  const vitalRows = await breakdown('vital', 20);
  const vitals = vitalRows.length ? VITAL_NAMES.map(name => {
    const of = (rating: string) => vitalRows.find(r => r.name === `${name}:${rating}`)?.value ?? 0;
    return { name, good: of('good'), needsImprovement: of('needs-improvement'), poor: of('poor') };
  }) : null;

  return { ...base, trackingSince, traffic, pages: titled(pages), content: titled(content), search, vitals };
}

/** Same answer for a minute per period, like the page's own revalidation: a reload storm does not re-aggregate. */
export function createSiteObservation(reader: Reader, clock: () => Date, ttlMs = 60e3) {
  const cache = new Map<ObservationDays, { at: number; value: Promise<SiteObservation> }>();
  return (days: ObservationDays) => {
    const now = clock(), hit = cache.get(days);
    if (hit && now.getTime() - hit.at < ttlMs && now.getTime() >= hit.at) return hit.value;
    const value = siteObservation(reader, days, now);
    cache.set(days, { at: now.getTime(), value });
    value.catch(() => { if (cache.get(days)?.value === value) cache.delete(days); });
    return value;
  };
}

export function registerSiteObservation(register: Register, reader: Reader, clock: () => Date) {
  const read = createSiteObservation(reader, clock);
  register('/site-observation', (_p, q) => read(observationDays(q)));
}
