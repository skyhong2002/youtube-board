import { describe, expect, it } from 'vitest';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { buildApp } from '../src/app.js';
import { DataQueryFailed, type Reader, type Row } from '../src/db/client.js';
import { createSiteObservation, dayRange, liveObservation, observationDays, siteObservation } from '../src/reports/site-observation.js';
import { BadQuery } from '../src/reports/query.js';

const NOW = new Date('2026-11-01T04:00:00Z'); // 12:00 Taipei
const dialect = new MySqlDialect();
type Seen = { sql: string; params: unknown[] };

/** Answers the report's queries from canned rows, recording each statement and its parameters. */
function fakeReader({ fetchedAt = NOW.getTime() - 60e3, provisioned = true, data = true } = {}) {
  const seen: Seen[] = [];
  const reader: Reader = {
    async rows<T extends Row>(query: Parameters<Reader['rows']>[0]) {
      const { sql, params } = dialect.sqlToQuery(query);
      seen.push({ sql, params });
      const out = (rows: Row[]) => rows as T[];
      if (!provisioned) throw new DataQueryFailed('ER_NO_SUCH_TABLE');
      if (sql.includes("source IN ('rt','meta')")) return out([
        { source: 'meta', metric: 'synced_at', item: '', value: String(NOW.getTime() - 30 * 60e3) },
        { source: 'rt', metric: 'fetched_at', item: '', value: String(fetchedAt) },
        { source: 'rt', metric: 'active_users', item: '', value: '3' },
        { source: 'rt', metric: 'views', item: '', value: '12' },
        { source: 'rt', metric: 'minute_views', item: '00', value: '4' },
        { source: 'rt', metric: 'minute_views', item: '29', value: '1' },
      ]);
      if (sql.includes('AS any_day')) return out(data ? [{ ga: '2026-10-30', any_day: '2026-10-29' }] : [{ ga: null, any_day: null }]);
      if (sql.includes("item='' AND source IN ('ga','gsc')")) return out([
        { day: '2026-10-30', source: 'ga', metric: 'views', value: '100' }, { day: '2026-10-30', source: 'ga', metric: 'sessions', value: '40' },
        { day: '2026-11-01', source: 'ga', metric: 'views', value: '10' },
        { day: '2026-10-29', source: 'gsc', metric: 'clicks', value: '2' }, { day: '2026-10-29', source: 'gsc', metric: 'impressions', value: '100' }, { day: '2026-10-29', source: 'gsc', metric: 'position', value: '8' },
        { day: '2026-10-30', source: 'gsc', metric: 'clicks', value: '1' }, { day: '2026-10-30', source: 'gsc', metric: 'impressions', value: '300' }, { day: '2026-10-30', source: 'gsc', metric: 'position', value: '4' },
      ]);
      if (sql.includes('SUM(value)') && sql.includes('GROUP BY item ORDER BY')) {
        const [source, metric] = [params[2], params[3]];
        if (source === 'ga' && metric === 'page_views') return out(sql.includes('REGEXP')
          ? [{ item: '/channels/42', total: '20' }, { item: '/videos/AbC_123xYz9', total: '35' }]
          : [{ item: '/', total: '50' }, { item: '/videos/AbC_123xYz9', total: '35' }, { item: '/channels/42', total: '20' }]);
        if (source === 'gsc' && metric === 'page_clicks') return out([{ item: '/channels/42', total: '3' }]);
        if (sql.includes("source='ga' AND metric=?")) {
          const m = params[2];
          if (m === 'channel') return out([{ item: 'Organic Search', total: '25' }]);
          if (m === 'device') return out([{ item: 'mobile', total: '30' }]);
          if (m === 'event') return out([{ item: 'open_original', total: '7' }]);
          if (m === 'vital') return out([{ item: 'LCP:good', total: '9' }, { item: 'LCP:poor', total: '1' }]);
        }
        return out([]);
      }
      if (sql.includes("metric='page_impressions'")) return out([{ item: '/channels/42', total: '50' }]);
      if (sql.includes('FROM urt_channel')) return out([{ id: '42', title: '公視新聞網' }]);
      if (sql.includes('FROM urt_video')) return out([{ id: 'abc_123xyz9', title: '大小寫不同的別支影片' }, { id: 'AbC_123xYz9', title: '颱風最新動態' }]);
      return out([]);
    },
    async close() {},
  };
  return { reader, seen };
}

describe('site observation query', () => {
  it('accepts only 7, 28 or 90 days', () => {
    expect(observationDays({})).toBe(28);
    expect(observationDays({ days: '7' })).toBe(7);
    expect(observationDays({ days: '90' })).toBe(90);
    for (const days of ['30', '0', '7.0', 'abc', '', ['7'], '+7']) expect(() => observationDays({ days }), String(days)).toThrow(BadQuery);
  });
  it('hides realtime that is stale or from the future, and orders minutes oldest first', () => {
    const rows = (at: number) => [{ metric: 'fetched_at', item: '', value: at }, { metric: 'active_users', item: '', value: 2 }, { metric: 'minute_views', item: '00', value: 5 }, { metric: 'minute_views', item: '29', value: 1 }];
    expect(liveObservation(rows(NOW.getTime() - 16 * 60e3), NOW)).toBeNull();
    expect(liveObservation(rows(NOW.getTime() + 5 * 60e3), NOW)).toBeNull();
    expect(liveObservation([], NOW)).toBeNull();
    const live = liveObservation(rows(NOW.getTime() - 14 * 60e3), NOW)!;
    expect([live.activeUsers, live.views, live.perMinute.length, live.perMinute[0], live.perMinute[29]]).toEqual([2, 0, 30, 1, 5]);
    expect(dayRange('2026-10-30', '2026-11-01')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01']);
  });
  it('builds the page from ts_site_metrics: zero-filled days since tracking began, content pages, own titles, weighted position', async () => {
    const { reader, seen } = fakeReader();
    const data = await siteObservation(reader, 7, NOW);
    expect(data).toMatchObject({ days: 7, start: '2026-10-26', end: '2026-11-01', trackingSince: '2026-10-30', updatedAt: '2026-11-01T03:30:00.000Z' });
    expect(data.live).toMatchObject({ activeUsers: 3, views: 12, fetchedAt: '2026-11-01T03:59:00.000Z' });
    expect(data.traffic!.daily).toEqual([
      { date: '2026-10-30', views: 100, sessions: 40, users: 0 }, { date: '2026-10-31', views: 0, sessions: 0, users: 0 }, { date: '2026-11-01', views: 10, sessions: 0, users: 0 },
    ]);
    expect([data.traffic!.views, data.traffic!.sessions]).toEqual([110, 40]);
    expect(data.traffic!.events).toEqual([{ name: 'open_original', value: 7 }]);
    expect(data.pages.map(p => [p.path, p.kind, p.title])).toEqual([['/', 'page', '首頁'], ['/videos/AbC_123xYz9', 'video', '颱風最新動態'], ['/channels/42', 'channel', '公視新聞網']]);
    expect(data.content.map(p => p.kind)).toEqual(['channel', 'video']);
    expect(data.search).toMatchObject({ clicks: 3, impressions: 400, position: 5, pages: [{ path: '/channels/42', title: '公視新聞網', clicks: 3, impressions: 50 }] });
    expect(data.vitals).toEqual([{ name: 'LCP', good: 9, needsImprovement: 0, poor: 1 }, { name: 'INP', good: 0, needsImprovement: 0, poor: 0 }, { name: 'CLS', good: 0, needsImprovement: 0, poor: 0 }]);
    // The window is bound as parameters and content pages are picked in SQL.
    const content = seen.find(s => s.sql.includes('REGEXP'))!;
    expect(content.params.slice(0, 2)).toEqual(['2026-10-26', '2026-11-01']);
    expect(String(content.params.at(-2))).toContain('videos');
    expect(seen.every(s => !/INSERT|UPDATE|DELETE/.test(s.sql))).toBe(true);
  });
  it('returns the empty shape before any sync, and when the table or grant is not provisioned', async () => {
    const fresh = await siteObservation(fakeReader({ data: false }).reader, 28, NOW);
    expect(fresh).toMatchObject({ trackingSince: null, traffic: null, pages: [], content: [], search: null, vitals: null });
    expect(fresh.live).not.toBeNull();
    expect(await siteObservation(fakeReader({ provisioned: false }).reader, 90, NOW)).toEqual({
      updatedAt: null, live: null, days: 90, start: '2026-08-04', end: '2026-11-01', trackingSince: null, traffic: null, pages: [], content: [], search: null, vitals: null,
    });
  });
  it('reuses one aggregation per period for a minute', async () => {
    const { reader, seen } = fakeReader();
    let now = NOW.getTime();
    const read = createSiteObservation(reader, () => new Date(now));
    await read(28); const first = seen.length; await read(28);
    expect(seen.length).toBe(first);
    await read(7); expect(seen.length).toBeGreaterThan(first);
    now += 61e3; const before = seen.length; await read(28);
    expect(seen.length).toBeGreaterThan(before);
  });
});

describe('GET /api/v1/site-observation', () => {
  it('serves the v1 envelope with the public 60-second cache, and 400 for other periods', async () => {
    const app = buildApp({ reader: fakeReader().reader, clock: () => NOW, dataset: 'fixture', rankingPools: false, keywordStore: false, publicApi: false });
    try {
      const ok = await app.inject('/api/v1/site-observation?days=7');
      expect(ok.statusCode).toBe(200);
      expect(ok.headers['cache-control']).toMatch(/s-maxage=60/);
      expect(ok.json().data).toMatchObject({ days: 7, trackingSince: '2026-10-30' });
      expect(ok.json().meta.updatedAt).toBe('2026-11-01T03:30:00.000Z');
      const bad = await app.inject('/api/v1/site-observation?days=30');
      expect(bad.statusCode).toBe(400);
      expect(bad.json()).toEqual({ error: 'days must be 7, 28 or 90.', code: 'INVALID_QUERY' });
      expect(bad.headers['cache-control']).toBe('no-store');
    } finally { await app.close(); }
  });
});
