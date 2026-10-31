// GA4 and Search Console aggregates for the public 本站流量 page (/observe), ported from tag.observe.tw
// (app/src/jobs/analytics-job.ts). site.analytics.sync (hourly) re-reads a trailing window — GA keeps processing for
// about three days, Search Console lags two to three — and replaces those days, so late data and vanished items settle.
// site.analytics.live (every two minutes) replaces the last 30 minutes from GA's Realtime API.
//
// Only aggregates are read, with read-only scopes: totals, page paths, default channel groups, device categories,
// custom-event counts and Web Vitals ratings from GA (hostname youtube.observe.tw only); clicks, impressions and position
// per day and per page from Search Console. Never search queries, page titles (GA only receives a fixed title) or
// anything per user. Nothing is logged but counts.
import { randomUUID } from 'node:crypto';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { connectDatabase, withWriterLock } from './database.js';
import { assertExecute, executionPolicy } from './policy.js';
import { googleClient, googleConfigFromEnv, type GoogleConfig, type GoogleFetch } from './google-analytics.js';
import { SITE_HOST, TRACKED_EVENTS, VITAL_NAMES, VITAL_RATINGS, shiftDay, sitePath, taipeiDay } from '../../shared/site-analytics.js';

export const SITE_ANALYTICS_SYNC_JOB = 'site.analytics.sync';
export const SITE_ANALYTICS_SYNC_COMMAND = 'site:analytics:sync';
export const SITE_ANALYTICS_LIVE_JOB = 'site.analytics.live';
export const SITE_ANALYTICS_LIVE_COMMAND = 'site:analytics:live';
export const siteAnalyticsCommands: Record<string, string> = { [SITE_ANALYTICS_SYNC_COMMAND]: SITE_ANALYTICS_SYNC_JOB, [SITE_ANALYTICS_LIVE_COMMAND]: SITE_ANALYTICS_LIVE_JOB };
export const BACKFILL_DAYS = 90, GA_REFRESH_DAYS = 7, GSC_REFRESH_DAYS = 10;
const GA_PAGE_SIZE = 100000, GA_MAX_ROWS = 1000000, GSC_PAGE_SIZE = 25000, GSC_MAX_ROWS = 500000, INSERT_BATCH = 500;

export interface MetricRow { day: string; source: 'ga' | 'gsc' | 'rt' | 'meta'; metric: string; item: string; value: number }

export function validateSiteAnalyticsArguments(args: string[]) {
  const job = siteAnalyticsCommands[args[0] ?? ''];
  if (!job || args.length > 2 || args.slice(1).some(arg => arg !== '--execute')) throw new Error('Invalid site analytics command');
  return { job, execute: args.length === 2 };
}

const gaDay = (v: string) => `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
const finite = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : 0; };

/** Sum views per (day, path) across encodings and trailing slashes; users take the max (a lower bound, never double-counted). */
export function pageRows(rows: Array<{ day: string; path: string; views: number; users: number }>): MetricRow[] {
  const pages = new Map<string, { day: string; path: string; views: number; users: number }>();
  for (const r of rows) {
    const path = sitePath(r.path);
    if (!path) continue;
    const id = `${r.day} ${path}`, p = pages.get(id) ?? { day: r.day, path, views: 0, users: 0 };
    p.views += r.views; p.users = Math.max(p.users, r.users);
    pages.set(id, p);
  }
  return [...pages.values()].flatMap(p => [
    { day: p.day, source: 'ga' as const, metric: 'page_views', item: p.path, value: p.views },
    { day: p.day, source: 'ga' as const, metric: 'page_users', item: p.path, value: p.users },
  ]);
}

/** One row per primary key: values of a repeated key are summed (users keep the maximum). */
export function mergeRows(rows: MetricRow[]): MetricRow[] {
  const out = new Map<string, MetricRow>();
  for (const r of rows) {
    const id = [r.day, r.source, r.metric, r.item].join('\u0000'), prev = out.get(id);
    if (!prev) out.set(id, { ...r });
    else prev.value = r.metric === 'page_users' || r.metric === 'position' ? Math.max(prev.value, r.value) : prev.value + r.value;
  }
  return [...out.values()];
}

type GaRow = { day: string; dims: string[]; values: number[] };
export async function fetchGa(google: GoogleFetch, propertyId: string, start: string, end: string): Promise<MetricRow[]> {
  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}`;
  const host = { filter: { fieldName: 'hostName', stringFilter: { matchType: 'EXACT', value: SITE_HOST } } };
  const report = async (dimensions: string[], metrics: string[], filter?: object): Promise<GaRow[]> => {
    const out: GaRow[] = [];
    for (let offset = 0; ; offset += GA_PAGE_SIZE) {
      const r = await google(`${url}:runReport`, {
        dateRanges: [{ startDate: start, endDate: end }],
        dimensions: ['date', ...dimensions].map(name => ({ name })),
        metrics: metrics.map(name => ({ name })),
        dimensionFilter: filter ? { andGroup: { expressions: [host, filter] } } : host,
        limit: GA_PAGE_SIZE, offset,
      });
      const rows = (r?.rows ?? []) as Array<{ dimensionValues: { value: string }[]; metricValues: { value: string }[] }>;
      for (const row of rows) out.push({ day: gaDay(String(row.dimensionValues[0]?.value ?? '')), dims: row.dimensionValues.slice(1).map(d => String(d.value ?? '')), values: row.metricValues.map(m => finite(m.value)) });
      const total = finite(r?.rowCount);
      if (rows.length < GA_PAGE_SIZE || offset + rows.length >= total) break;
      if (offset + GA_PAGE_SIZE >= GA_MAX_ROWS) throw new Error('GA report exceeds the row cap');
    }
    return out.filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.day));
  };
  const out: MetricRow[] = [];
  for (const r of await report([], ['screenPageViews', 'sessions', 'activeUsers']))
    (['views', 'sessions', 'users'] as const).forEach((metric, i) => out.push({ day: r.day, source: 'ga', metric, item: '', value: r.values[i] ?? 0 }));
  // Paths only: GA's page title is the fixed site name (SiteAnalytics), so it is never requested.
  const pages = await report(['pagePath'], ['screenPageViews', 'activeUsers']);
  out.push(...pageRows(pages.map(r => ({ day: r.day, path: r.dims[0] ?? '', views: r.values[0] ?? 0, users: r.values[1] ?? 0 }))));
  for (const [metric, dimension] of [['channel', 'sessionDefaultChannelGroup'], ['device', 'deviceCategory']] as const)
    for (const r of await report([dimension], ['sessions'])) out.push({ day: r.day, source: 'ga', metric, item: (r.dims[0] ?? '').slice(0, 64), value: r.values[0] ?? 0 });
  const events = { filter: { fieldName: 'eventName', inListFilter: { values: [...TRACKED_EVENTS] } } };
  for (const r of await report(['eventName'], ['eventCount'], events))
    if ((TRACKED_EVENTS as readonly string[]).includes(r.dims[0] ?? '')) out.push({ day: r.day, source: 'ga', metric: 'event', item: r.dims[0]!, value: r.values[0] ?? 0 });
  // Web Vitals ratings need the event-scoped custom dimensions metric_name and metric_rating registered in GA.
  const meta = await google(`${url}/metadata`);
  const dims = new Set(((meta?.dimensions ?? []) as Array<{ apiName?: string }>).map(d => d.apiName));
  if (dims.has('customEvent:metric_name') && dims.has('customEvent:metric_rating')) {
    const vitals = { filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: 'web_vital' } } };
    for (const r of await report(['customEvent:metric_name', 'customEvent:metric_rating'], ['eventCount'], vitals))
      if ((VITAL_NAMES as readonly string[]).includes(r.dims[0] ?? '') && (VITAL_RATINGS as readonly string[]).includes(r.dims[1] ?? ''))
        out.push({ day: r.day, source: 'ga', metric: 'vital', item: `${r.dims[0]}:${r.dims[1]}`, value: r.values[0] ?? 0 });
  }
  return mergeRows(out);
}

/** A domain property (sc-domain:observe.tw) also covers sibling subdomains; restrict every query to this site's pages. */
export function gscHostFilter(siteUrl: string) {
  return siteUrl.startsWith('sc-domain:')
    ? { dimensionFilterGroups: [{ filters: [{ dimension: 'page', operator: 'includingRegex', expression: `^https?://${SITE_HOST.replaceAll('.', '\\.')}/` }] }] }
    : {};
}

export async function fetchGsc(google: GoogleFetch, siteUrl: string, start: string, end: string): Promise<MetricRow[]> {
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const query = async (dimensions: string[]) => {
    const rows: Array<{ keys?: string[]; clicks?: number; impressions?: number; position?: number }> = [];
    for (let startRow = 0; ; startRow += GSC_PAGE_SIZE) {
      // Dimensions are only date and page: search queries are never requested.
      const r = await google(url, { startDate: start, endDate: end, type: 'web', dataState: 'all', dimensions, rowLimit: GSC_PAGE_SIZE, startRow, ...gscHostFilter(siteUrl) });
      const page = (r?.rows ?? []) as typeof rows;
      rows.push(...page);
      if (page.length < GSC_PAGE_SIZE) return rows;
      if (startRow + GSC_PAGE_SIZE >= GSC_MAX_ROWS) throw new Error('Search Console report exceeds the row cap');
    }
  };
  const day = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
  const out: MetricRow[] = [];
  for (const r of await query(['date'])) {
    const d = day(r.keys?.[0]);
    if (!d) continue;
    out.push(
      { day: d, source: 'gsc', metric: 'clicks', item: '', value: finite(r.clicks) },
      { day: d, source: 'gsc', metric: 'impressions', item: '', value: finite(r.impressions) },
      { day: d, source: 'gsc', metric: 'position', item: '', value: finite(r.position) },
    );
  }
  for (const r of await query(['date', 'page'])) {
    const d = day(r.keys?.[0]), path = sitePath(String(r.keys?.[1] ?? ''));
    if (!d || !path) continue;
    out.push({ day: d, source: 'gsc', metric: 'page_clicks', item: path, value: finite(r.clicks) }, { day: d, source: 'gsc', metric: 'page_impressions', item: path, value: finite(r.impressions) });
  }
  return mergeRows(out);
}

/** GA Realtime: active users and views over the last 30 minutes and views per minute. Totals only: no pages or titles. */
export async function fetchRealtime(google: GoogleFetch, propertyId: string, now: Date): Promise<MetricRow[]> {
  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runRealtimeReport`;
  const value = (row: { metricValues?: { value: string }[] } | undefined, i: number) => finite(row?.metricValues?.[i]?.value ?? 0);
  const [total, minutes] = await Promise.all([
    google(url, { metrics: [{ name: 'activeUsers' }, { name: 'screenPageViews' }] }),
    google(url, { dimensions: [{ name: 'minutesAgo' }], metrics: [{ name: 'screenPageViews' }] }),
  ]);
  const day = taipeiDay(now);
  const out: MetricRow[] = [
    { day, source: 'rt', metric: 'fetched_at', item: '', value: now.getTime() },
    { day, source: 'rt', metric: 'active_users', item: '', value: value(total?.rows?.[0], 0) },
    { day, source: 'rt', metric: 'views', item: '', value: value(total?.rows?.[0], 1) },
  ];
  for (const row of (minutes?.rows ?? []) as Array<{ dimensionValues?: { value: string }[]; metricValues?: { value: string }[] }>) {
    const ago = Number(row.dimensionValues?.[0]?.value);
    if (Number.isInteger(ago) && ago >= 0 && ago < 30) out.push({ day, source: 'rt', metric: 'minute_views', item: String(ago).padStart(2, '0'), value: value(row, 0) });
  }
  return mergeRows(out);
}

/** Delete-then-insert in one InnoDB transaction, so readers see either the old or the new rows of the window. */
async function replaceRows(db: Connection, assertOwnership: () => Promise<void>, where: string, params: unknown[], rows: MetricRow[]) {
  await assertOwnership();
  await db.beginTransaction();
  try {
    await db.query(`DELETE FROM ts_site_metrics WHERE ${where}`, params);
    for (let i = 0; i < rows.length; i += INSERT_BATCH)
      await db.query('INSERT INTO ts_site_metrics(day,source,metric,item,value) VALUES ?', [rows.slice(i, i + INSERT_BATCH).map(r => [r.day, r.source, r.metric, r.item, r.value])]);
    await assertOwnership();
    await db.commit();
  } catch (error) { await db.rollback().catch(() => {}); throw error; }
}

export interface RunOptions { now?: () => Date; assertOwnership?: () => Promise<void> }
export async function runSiteAnalyticsSync(db: Connection, config: GoogleConfig, google: GoogleFetch, { now = () => new Date(), assertOwnership = async () => {} }: RunOptions = {}) {
  const today = taipeiDay(now()), summary: Record<string, { start: string; end: string; rows: number; backfill: boolean }> = {};
  for (const [source, refresh] of [['ga', GA_REFRESH_DAYS], ['gsc', GSC_REFRESH_DAYS]] as const) {
    const [present] = await db.query<RowDataPacket[]>('SELECT 1 AS present FROM ts_site_metrics WHERE source=? LIMIT 1', [source]);
    const backfill = present.length === 0, start = shiftDay(today, -(backfill ? BACKFILL_DAYS : refresh));
    const rows = source === 'ga' ? await fetchGa(google, config.propertyId, start, today) : await fetchGsc(google, config.siteUrl, start, today);
    await replaceRows(db, assertOwnership, 'source=? AND day BETWEEN ? AND ?', [source, start, today], rows);
    summary[source] = { start, end: today, rows: rows.length, backfill };
  }
  // The page's 更新於: the report principal reads this table but not ts_job_runs.
  const finished = now();
  await replaceRows(db, assertOwnership, "source='meta' AND metric='synced_at'", [], [{ day: taipeiDay(finished), source: 'meta', metric: 'synced_at', item: '', value: finished.getTime() }]);
  return summary;
}

export async function runSiteAnalyticsLive(db: Connection, config: GoogleConfig, google: GoogleFetch, { now = () => new Date(), assertOwnership = async () => {} }: RunOptions = {}) {
  const rows = await fetchRealtime(google, config.propertyId, now());
  await replaceRows(db, assertOwnership, "source='rt'", [], rows);
  const get = (metric: string) => rows.find(r => r.metric === metric)?.value ?? 0;
  return { activeUsers: get('active_users'), views: get('views'), minutes: rows.filter(r => r.metric === 'minute_views').length };
}

export interface SiteAnalyticsDeps { connect?: (env: NodeJS.ProcessEnv) => Promise<Connection>; google?: (config: GoogleConfig) => GoogleFetch; now?: () => Date }
export async function executeSiteAnalyticsWorkflow(args: string[], env: NodeJS.ProcessEnv, scheduled = false, deps: SiteAnalyticsDeps = {}) {
  const input = validateSiteAnalyticsArguments(args);
  // A dry run neither connects nor calls Google.
  if (!input.execute) return { mode: 'dry-run', workflow: input.job, configured: googleConfigFromEnv(env) !== null, externalCalls: 0, writes: 0 };
  assertExecute(input.job, executionPolicy(env, 'execute', scheduled));
  const config = googleConfigFromEnv(env);
  // Not configured is a normal state (local, preview, or before the service account is granted): skip, never fail.
  if (!config) return { workflow: input.job, status: 'skipped', reason: 'google-access-not-configured' };
  const google = (deps.google ?? (c => googleClient(c)))(config), now = deps.now ?? (() => new Date());
  const db = await (deps.connect ?? connectDatabase)(env);
  try {
    return await withWriterLock(db, input.job, async assertOwnership => {
      if (input.job === SITE_ANALYTICS_LIVE_JOB) return { workflow: input.job, status: 'completed', ...(await runSiteAnalyticsLive(db, config, google, { now, assertOwnership })) };
      const executionKey = randomUUID();
      await assertOwnership();
      await db.execute('INSERT INTO ts_job_runs(job_key,execution_key,status) VALUES(?,?,?)', [input.job, executionKey, 'running']);
      try {
        const summary = await runSiteAnalyticsSync(db, config, google, { now, assertOwnership });
        await db.execute('UPDATE ts_job_runs SET status=?,result=? WHERE job_key=? AND execution_key=?', ['completed', JSON.stringify(summary), input.job, executionKey]);
        return { workflow: input.job, status: 'completed', executionKey, ...summary };
      } catch (error) {
        await db.execute('UPDATE ts_job_runs SET status=?,result=? WHERE job_key=? AND execution_key=?', ['failed', JSON.stringify({ error: 'site-analytics-sync-failed' }), input.job, executionKey]).catch(() => {});
        throw error;
      }
    });
  } finally { await db.end(); }
}

export async function handleSiteAnalyticsCli(args: string[], env: NodeJS.ProcessEnv) {
  if (!Object.hasOwn(siteAnalyticsCommands, args[0] ?? '')) return false;
  console.log(JSON.stringify(await executeSiteAnalyticsWorkflow(args, env))); return true;
}
