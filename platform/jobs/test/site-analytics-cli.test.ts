import { describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Connection } from 'mysql2/promise';
import {
  executeSiteAnalyticsWorkflow, fetchGa, fetchGsc, fetchRealtime, mergeRows, pageRows, runSiteAnalyticsLive, runSiteAnalyticsSync, validateSiteAnalyticsArguments, type MetricRow,
} from '../src/site-analytics-cli.js';
import { GOOGLE_SCOPES, googleClient, googleConfigFromEnv, type GoogleConfig } from '../src/google-analytics.js';
import { pageKind, pageTitle, sitePath } from '../../shared/site-analytics.js';

const config: GoogleConfig = { credentialsFile: '/run/secrets/google.json', propertyId: '558497452', siteUrl: 'https://youtube.observe.tw/' };
const NOW = new Date('2026-11-01T04:00:00Z'); // 12:00 Taipei
type Call = { url: string; body?: Record<string, any> };

/** Google answers by request shape; every call is recorded so tests can assert what was (never) asked. */
function fakeGoogle({ vitals = true, domainLeak = false } = {}) {
  const calls: Call[] = [];
  const ga = (dims: string[], values: string[][]) => ({ rowCount: values.length, rows: values.map(v => ({ dimensionValues: v.slice(0, dims.length).map(value => ({ value })), metricValues: v.slice(dims.length).map(value => ({ value })) })) });
  const google = async (url: string, body?: Record<string, any>) => {
    calls.push({ url, body });
    if (url.endsWith('/metadata')) return { dimensions: vitals ? [{ apiName: 'customEvent:metric_name' }, { apiName: 'customEvent:metric_rating' }] : [{ apiName: 'date' }] };
    if (url.endsWith(':runRealtimeReport'))
      return body?.dimensions ? { rows: [{ dimensionValues: [{ value: '0' }], metricValues: [{ value: '4' }] }, { dimensionValues: [{ value: '29' }], metricValues: [{ value: '1' }] }, { dimensionValues: [{ value: '31' }], metricValues: [{ value: '9' }] }] } : { rows: [{ metricValues: [{ value: '3' }, { value: '12' }] }] };
    if (url.endsWith(':runReport')) {
      const dims = (body!.dimensions as { name: string }[]).map(d => d.name).slice(1).join(',');
      if (dims === '') return ga(['date'], [['20261031', '120', '40', '30'], ['20261101', '10', '4', '3']]);
      if (dims === 'pagePath') return ga(['date', 'pagePath'], [
        ['20261031', '/videos/AbC_123xYz9', '30', '20'], ['20261031', '/videos/AbC_123xYz9/', '5', '4'], ['20261031', '/channels/42', '20', '9'],
        ['20261031', '/keywords/%E7%A7%81%E4%BA%BA/videos', '2', '1'], ['20261031', '/my/settings', '1', '1'], ['20261031', '/', '50', '25'],
      ]);
      if (dims === 'sessionDefaultChannelGroup') return ga(['date', 'x'], [['20261031', 'Organic Search', '25'], ['20261031', 'Direct', '15']]);
      if (dims === 'deviceCategory') return ga(['date', 'x'], [['20261031', 'mobile', '30'], ['20261031', 'desktop', '10']]);
      if (dims === 'eventName') return ga(['date', 'x'], [['20261031', 'open_original', '7'], ['20261031', 'page_view', '120']]);
      if (dims === 'customEvent:metric_name,customEvent:metric_rating') return ga(['date', 'a', 'b'], [['20261031', 'LCP', 'good', '9'], ['20261031', 'LCP', '(not set)', '3'], ['20261031', 'FID', 'good', '1']]);
      throw new Error('unexpected GA report ' + dims);
    }
    if (url.includes('/searchAnalytics/query')) {
      if (body!.dimensions.join() === 'date') return { rows: [{ keys: ['2026-10-30'], clicks: 3, impressions: 90, position: 7.25 }] };
      return { rows: [
        { keys: ['2026-10-30', 'https://youtube.observe.tw/channels/42'], clicks: 2, impressions: 40 },
        { keys: ['2026-10-30', 'https://youtube.observe.tw/channels/42/'], clicks: 1, impressions: 10 },
        ...(domainLeak ? [{ keys: ['2026-10-30', 'https://tag.observe.tw/eve/1/'], clicks: 50, impressions: 900 }] : []),
        { keys: ['2026-10-30', 'https://youtube.observe.tw/keywords/%E7%A7%81/videos'], clicks: 1, impressions: 5 },
      ] };
    }
    throw new Error('unexpected Google URL ' + url);
  };
  return { google, calls };
}

/** Just enough of a mysql2 connection over an in-memory ts_site_metrics and ts_job_runs. */
function fakeDb(initial: MetricRow[] = []) {
  let rows = initial.map(r => ({ ...r }));
  const runs: Array<{ status: string; result?: string }> = [], statements: string[] = [];
  let snapshot: typeof rows | null = null;
  const where = (sql: string, params: unknown[]) => (r: MetricRow) => {
    if (/source=\? AND day BETWEEN \? AND \?/.test(sql)) return r.source === params[0] && r.day >= String(params[1]) && r.day <= String(params[2]);
    if (/source='meta' AND metric='synced_at'/.test(sql)) return r.source === 'meta' && r.metric === 'synced_at';
    if (/source='rt'/.test(sql)) return r.source === 'rt';
    throw new Error('unexpected delete ' + sql);
  };
  const db = {
    async query(sql: string, params: unknown[] = []) {
      statements.push(sql);
      if (sql.includes('GET_LOCK') || sql.includes('IS_USED_LOCK')) return [[{ acquired: 1, owned: 1 }]];
      if (sql.includes('RELEASE_LOCK')) return [[]];
      if (sql.startsWith('SELECT 1 AS present')) return [rows.filter(r => r.source === params[0]).slice(0, 1).map(() => ({ present: 1 }))];
      if (sql.startsWith('DELETE FROM ts_site_metrics')) { const match = where(sql, params); rows = rows.filter(r => !match(r)); return [{ affectedRows: 0 }]; }
      if (sql.startsWith('INSERT INTO ts_site_metrics')) {
        for (const [day, source, metric, item, value] of params[0] as unknown[][]) {
          if (rows.some(r => r.day === day && r.source === source && r.metric === metric && r.item === item)) throw new Error('ER_DUP_ENTRY');
          rows.push({ day, source, metric, item, value } as MetricRow);
        }
        return [{ affectedRows: 1 }];
      }
      throw new Error('unexpected query ' + sql);
    },
    async execute(sql: string, params: unknown[]) {
      statements.push(sql);
      if (sql.startsWith('INSERT INTO ts_job_runs')) runs.push({ status: String(params[2]) });
      else if (sql.startsWith('UPDATE ts_job_runs')) Object.assign(runs.at(-1)!, { status: params[0], result: params[1] });
      return [{}];
    },
    async beginTransaction() { snapshot = rows.map(r => ({ ...r })); },
    async commit() { snapshot = null; },
    async rollback() { if (snapshot) rows = snapshot; snapshot = null; },
    async end() {},
  };
  return { db: db as unknown as Connection, rows: () => rows, runs, statements };
}

describe('published page paths', () => {
  it('normalizes encodings, full URLs and trailing slashes', () => {
    expect(sitePath('/videos/AbC_123xYz9/')).toBe('/videos/AbC_123xYz9');
    expect(sitePath('https://youtube.observe.tw/channels/42?x=1#y')).toBe('/channels/42');
    expect(sitePath('/')).toBe('/');
    expect(sitePath('/events/0d4c9e8a-1b2c-4d5e-8f90-123456789abc')).toBe('/events/0d4c9e8a-1b2c-4d5e-8f90-123456789abc');
  });
  it('drops other hosts (a domain property covers siblings), private pages, free text and traversal', () => {
    for (const raw of ['https://tag.observe.tw/eve/1/', 'https://evil.test/videos/AbC_123xYz9', '//evil.test/', '/my/settings', '/admin', '/search', '/observe/opt-out',
      '/keywords/%E7%A7%81/videos', '/groups/2024%20%E7%AB%8B%E5%A7%94', '/mayor/cities/%E5%8F%B0%E5%8C%97', '/ai/days/2026-10-01/x', '/live/groups/a/hours', '/comments/authors/x',
      '/videos/%2e%2e', '/videos/not-a-video-id-at-all', '/channels/%E0%A4%A', '/api/v1/home', '/Videos'])
      expect(sitePath(raw), raw).toBeNull();
  });
  it('tells content pages from index pages and names them from the path', () => {
    expect(['/videos/AbC_123xYz9', '/channels/42/trends', '/tags/12/videos', '/ai/events/77', '/ai/days/5/events', '/videos', '/channels', '/'].map(pageKind))
      .toEqual(['video', 'channel', 'category', 'topic', 'topic', 'page', 'page', 'page']);
    expect(pageTitle('/channels/42/videos', new Map([['channel:42', '公視新聞網']]))).toBe('公視新聞網・影片');
    expect(pageTitle('/videos/AbC_123xYz9')).toBe('影片 AbC_123xYz9');
    expect(pageTitle('/observe')).toBe('本站流量');
    expect(pageTitle('/live/current')).toBe('即時直播');
  });
});

describe('GA and Search Console reads', () => {
  it('sums views per path across slash variants, keeps users a lower bound and never stores private or free-text paths', () => {
    const rows = pageRows([
      { day: '2026-10-31', path: '/videos/AbC_123xYz9', views: 30, users: 20 },
      { day: '2026-10-31', path: '/videos/AbC_123xYz9/', views: 5, users: 4 },
      { day: '2026-10-31', path: '/keywords/%E7%A7%81/videos', views: 2, users: 1 },
    ]);
    expect(rows).toEqual([
      { day: '2026-10-31', source: 'ga', metric: 'page_views', item: '/videos/AbC_123xYz9', value: 35 },
      { day: '2026-10-31', source: 'ga', metric: 'page_users', item: '/videos/AbC_123xYz9', value: 20 },
    ]);
    expect(mergeRows([...rows, ...rows]).find(r => r.metric === 'page_users')!.value).toBe(20);
  });
  it('filters every GA report to this hostname, never asks for titles, and reads vitals only when the custom dimensions exist', async () => {
    const { google, calls } = fakeGoogle();
    const rows = await fetchGa(google, '558497452', '2026-10-25', '2026-11-01');
    const reports = calls.filter(c => c.url.endsWith(':runReport'));
    expect(reports.length).toBe(6);
    for (const { body } of reports) {
      expect(JSON.stringify(body!.dimensionFilter)).toContain('"fieldName":"hostName","stringFilter":{"matchType":"EXACT","value":"youtube.observe.tw"}');
      expect(JSON.stringify(body!.dimensions)).not.toMatch(/pageTitle|unifiedScreenName|searchTerm|query/i);
    }
    expect(rows).toContainEqual({ day: '2026-10-31', source: 'ga', metric: 'views', item: '', value: 120 });
    expect(rows.filter(r => r.metric === 'page_views').map(r => r.item).sort()).toEqual(['/', '/channels/42', '/videos/AbC_123xYz9']);
    expect(rows.filter(r => r.metric === 'event')).toEqual([{ day: '2026-10-31', source: 'ga', metric: 'event', item: 'open_original', value: 7 }]);
    expect(rows.filter(r => r.metric === 'vital')).toEqual([{ day: '2026-10-31', source: 'ga', metric: 'vital', item: 'LCP:good', value: 9 }]);
    const without = fakeGoogle({ vitals: false });
    expect((await fetchGa(without.google, '558497452', '2026-10-25', '2026-11-01')).some(r => r.metric === 'vital')).toBe(false);
    expect(without.calls.filter(c => c.url.endsWith(':runReport')).length).toBe(5);
  });
  it('reads Search Console by date and page only, with dataState all, and keeps only this site when the property is a domain', async () => {
    const domain = fakeGoogle({ domainLeak: true });
    const rows = await fetchGsc(domain.google, 'sc-domain:observe.tw', '2026-10-22', '2026-11-01');
    for (const { url, body } of domain.calls) {
      expect(url).toBe('https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Aobserve.tw/searchAnalytics/query');
      expect(body).toMatchObject({ type: 'web', dataState: 'all', dimensionFilterGroups: [{ filters: [{ dimension: 'page', operator: 'includingRegex', expression: '^https?://youtube\\.observe\\.tw/' }] }] });
      expect(body!.dimensions.every((d: string) => d === 'date' || d === 'page')).toBe(true);
    }
    expect(rows.filter(r => r.metric.startsWith('page_'))).toEqual([
      { day: '2026-10-30', source: 'gsc', metric: 'page_clicks', item: '/channels/42', value: 3 },
      { day: '2026-10-30', source: 'gsc', metric: 'page_impressions', item: '/channels/42', value: 50 },
    ]);
    expect(rows).toContainEqual({ day: '2026-10-30', source: 'gsc', metric: 'position', item: '', value: 7.25 });
    const prefix = fakeGoogle();
    await fetchGsc(prefix.google, 'https://youtube.observe.tw/', '2026-10-22', '2026-11-01');
    expect(prefix.calls[0]!.url).toContain('/sites/https%3A%2F%2Fyoutube.observe.tw%2F/');
    expect(prefix.calls[0]!.body).not.toHaveProperty('dimensionFilterGroups');
  });
  it('keeps realtime totals and the last 30 minutes only', async () => {
    const { google, calls } = fakeGoogle();
    const rows = await fetchRealtime(google, '558497452', NOW);
    expect(rows.map(r => [r.metric, r.item, r.value])).toEqual([['fetched_at', '', NOW.getTime()], ['active_users', '', 3], ['views', '', 12], ['minute_views', '00', 4], ['minute_views', '29', 1]]);
    expect(JSON.stringify(calls)).not.toMatch(/unifiedScreenName|pagePath|pageTitle/);
  });
});

describe('site analytics runs', () => {
  it('backfills 90 days on the first run, then rereads GA 7 and Search Console 10 days and replaces exactly that window', async () => {
    const { google, calls } = fakeGoogle(), store = fakeDb();
    const first = await runSiteAnalyticsSync(store.db, config, google, { now: () => NOW });
    expect(first).toEqual({ ga: { start: '2026-08-03', end: '2026-11-01', rows: expect.any(Number), backfill: true }, gsc: { start: '2026-08-03', end: '2026-11-01', rows: 5, backfill: true } });
    expect(store.rows()).toContainEqual({ day: '2026-11-01', source: 'meta', metric: 'synced_at', item: '', value: NOW.getTime() });
    const old = { day: '2026-08-01', source: 'ga' as const, metric: 'views', item: '', value: 5 };
    const second = fakeDb([...store.rows(), old]);
    calls.length = 0;
    const again = await runSiteAnalyticsSync(second.db, config, google, { now: () => NOW });
    expect([again.ga.start, again.gsc.start, again.ga.backfill]).toEqual(['2026-10-25', '2026-10-22', false]);
    expect(calls.find(c => c.url.endsWith(':runReport'))!.body!.dateRanges).toEqual([{ startDate: '2026-10-25', endDate: '2026-11-01' }]);
    // Days outside the window stay; inside it the rows are replaced, not duplicated.
    expect(second.rows()).toContainEqual(old);
    expect(second.rows().filter(r => r.source === 'ga' && r.metric === 'views' && r.day === '2026-10-31')).toHaveLength(1);
    expect(second.rows().filter(r => r.source === 'meta')).toHaveLength(1);
  });
  it('replaces all realtime rows on each live run', async () => {
    const { google } = fakeGoogle(), store = fakeDb([{ day: '2026-10-31', source: 'rt', metric: 'minute_views', item: '07', value: 99 }]);
    expect(await runSiteAnalyticsLive(store.db, config, google, { now: () => NOW })).toEqual({ activeUsers: 3, views: 12, minutes: 2 });
    expect(store.rows().some(r => r.item === '07')).toBe(false);
    expect(store.rows().filter(r => r.source === 'rt')).toHaveLength(5);
  });
  it('rolls the window back when Google fails mid-run, keeping the last good rows', async () => {
    const store = fakeDb([{ day: '2026-10-31', source: 'rt', metric: 'views', item: '', value: 1 }]);
    await expect(runSiteAnalyticsLive(store.db, config, async () => { throw new Error('Google API HTTP 503'); }, { now: () => NOW })).rejects.toThrow('503');
    expect(store.rows()).toEqual([{ day: '2026-10-31', source: 'rt', metric: 'views', item: '', value: 1 }]);
  });
});

describe('site analytics workflow boundary', () => {
  const gates = { APP_ENV: 'test', TS_INGESTION_ENABLED: 'true', TS_SCHEDULER_ENABLED: 'true', TS_INGESTION_OWNERS: 'site.analytics.sync,site.analytics.live' };
  const google = { GOOGLE_APPLICATION_CREDENTIALS: '/run/secrets/google.json', GA4_PROPERTY_ID: '558497452', GSC_SITE_URL: 'https://youtube.observe.tw/' };
  it('validates the bare command; a dry run touches nothing', async () => {
    expect(validateSiteAnalyticsArguments(['site:analytics:sync'])).toEqual({ job: 'site.analytics.sync', execute: false });
    for (const bad of [['site:analytics:other'], ['site:analytics:sync', '--limit=1'], ['site:analytics:live', '--execute', '--x']]) expect(() => validateSiteAnalyticsArguments(bad)).toThrow();
    const never = async () => { throw new Error('unexpected connection'); };
    expect(await executeSiteAnalyticsWorkflow(['site:analytics:sync'], {}, false, { connect: never })).toMatchObject({ mode: 'dry-run', configured: false, externalCalls: 0 });
  });
  it('is a no-op, not a failure, when any Google setting is missing', async () => {
    const never = async () => { throw new Error('unexpected connection'); };
    for (const missing of ['GOOGLE_APPLICATION_CREDENTIALS', 'GA4_PROPERTY_ID', 'GSC_SITE_URL']) {
      const env = { ...gates, ...google, [missing]: '' };
      expect(await executeSiteAnalyticsWorkflow(['site:analytics:sync', '--execute'], env, true, { connect: never, google: () => { throw new Error('unexpected Google'); } }))
        .toEqual({ workflow: 'site.analytics.sync', status: 'skipped', reason: 'google-access-not-configured' });
    }
  });
  it('still requires the ingestion ownership gates before anything else', async () => {
    await expect(executeSiteAnalyticsWorkflow(['site:analytics:live', '--execute'], { ...google, APP_ENV: 'test', TS_INGESTION_ENABLED: 'true' }, true)).rejects.toThrow('ownership');
  });
  it('journals sync runs and returns only counts', async () => {
    const store = fakeDb(), { google: fake } = fakeGoogle();
    const result = await executeSiteAnalyticsWorkflow(['site:analytics:sync', '--execute'], { ...gates, ...google }, false, { connect: async () => store.db, google: () => fake, now: () => NOW });
    expect(result).toMatchObject({ workflow: 'site.analytics.sync', status: 'completed', ga: { backfill: true }, gsc: { rows: 5 } });
    expect(store.runs).toEqual([{ status: 'completed', result: expect.stringContaining('"gsc"') }]);
    const live = await executeSiteAnalyticsWorkflow(['site:analytics:live', '--execute'], { ...gates, ...google }, false, { connect: async () => store.db, google: () => fake, now: () => NOW });
    expect(live).toEqual({ workflow: 'site.analytics.live', status: 'completed', activeUsers: 3, views: 12, minutes: 2 });
    expect(store.runs).toHaveLength(1);
  });
  it('rejects malformed configuration instead of guessing', () => {
    expect(() => googleConfigFromEnv({ ...google, GA4_PROPERTY_ID: 'G-X2G1PLNP7K' })).toThrow('numeric');
    expect(() => googleConfigFromEnv({ ...google, GSC_SITE_URL: 'youtube.observe.tw' })).toThrow('GSC_SITE_URL');
    expect(googleConfigFromEnv({ ...google, GSC_SITE_URL: 'sc-domain:observe.tw' })?.siteUrl).toBe('sc-domain:observe.tw');
  });
});

describe('Google client', () => {
  it('signs a read-only JWT grant, caches the token and never surfaces response bodies', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const dir = await mkdtemp(join(tmpdir(), 'site-analytics-')), file = join(dir, 'sa.json');
    await writeFile(file, JSON.stringify({ client_email: 'reader@example.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }), { mode: 0o600 });
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      if (url === 'https://oauth2.googleapis.com/token') return new Response(JSON.stringify({ access_token: 'secret-token', expires_in: 3600 }), { status: 200 });
      if (url.includes('fail')) return new Response('{"error":"echo secret-token"}', { status: 403 });
      return new Response('{"rows":[]}', { status: 200 });
    }) as unknown as typeof fetch;
    const client = googleClient({ ...config, credentialsFile: file }, fetchImpl);
    expect(await client('https://analyticsdata.googleapis.com/v1beta/properties/1:runReport', { a: 1 })).toEqual({ rows: [] });
    await client('https://analyticsdata.googleapis.com/v1beta/properties/1/metadata');
    expect(seen.filter(s => s.url.includes('oauth2'))).toHaveLength(1);
    const assertion = new URLSearchParams(String(seen[0]!.init.body)).get('assertion')!;
    const claims = JSON.parse(Buffer.from(assertion.split('.')[1]!, 'base64url').toString());
    expect(claims.scope.split(' ')).toEqual([...GOOGLE_SCOPES]);
    expect(claims.scope).not.toMatch(/edit|manage|\.readwrite|webmasters(?!\.readonly)/);
    const error = await client('https://www.googleapis.com/fail?key=1').catch(e => e as Error);
    expect(error.message).toBe('Google API HTTP 403 for /fail');
    expect(error.message).not.toContain('secret-token');
  });
});
