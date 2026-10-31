import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import SiteObservationView, { DailyBars, observeHref } from '../components/SiteObservationView';
import type { SiteObservation } from '../../../api/src/reports/site-observation';
import { publicApiUrl } from './public-data';

const render = (data: SiteObservation | null, days: 7 | 28 | 90 = 28) => renderToStaticMarkup(createElement(SiteObservationView, { data, days }));
const empty: SiteObservation = { updatedAt: null, live: null, days: 7, start: '2026-10-26', end: '2026-11-01', trackingSince: null, traffic: null, pages: [], content: [], search: null, vitals: null };

test('renders an unavailable notice when the API failed, and the period choices', () => {
  const html = render(null);
  assert.match(html, /觀測資料暫時無法取得/);
  assert.match(html, /href="\/observe\?days=7"/);assert.match(html, /<a[^>]*aria-current="page"[^>]*>近 28 天/);assert.match(html, /<a[^>]*href="\/observe"[^>]*>近 28 天/);assert.match(html, /href="\/observe\?days=90"/);
  assert.equal(observeHref(28), '/observe');
});

test('renders the empty shape before the first sync without fake zeros or a live panel', () => {
  const html = render(empty, 7);
  assert.match(html, /還沒有瀏覽資料/);assert.match(html, /這段期間還沒有內容頁的瀏覽/);assert.match(html, /Search Console 還沒有回傳搜尋資料/);
  assert.match(html, /還沒有讀者瀏覽器回報的使用體驗樣本/);assert.doesNotMatch(html, /aria-label="最近 30 分鐘"/);assert.doesNotMatch(html, /更新於/);
  assert.match(html, />—</);
});

test('renders traffic, reader focus with own titles, search pages, vitals and the live panel', () => {
  const data: SiteObservation = {
    ...empty, updatedAt: '2026-11-01T03:30:00.000Z', trackingSince: '2026-10-30',
    live: { fetchedAt: '2026-11-01T03:59:00.000Z', activeUsers: 3, views: 12, perMinute: Array.from({ length: 30 }, (_, i) => i % 3) },
    traffic: { daily: [{ date: '2026-10-30', views: 100, sessions: 40, users: 30 }, { date: '2026-10-31', views: 0, sessions: 0, users: 0 }, { date: '2026-11-01', views: 10, sessions: 4, users: 3 }], views: 110, sessions: 44,
      channels: [{ name: 'Organic Search', value: 30 }, { name: 'Direct', value: 14 }], devices: [{ name: 'mobile', value: 44 }], events: [{ name: 'open_original', value: 7 }] },
    pages: [{ path: '/', kind: 'page', title: '首頁', views: 50 }],
    content: [{ path: '/videos/AbC_123xYz9', kind: 'video', title: '<b>颱風最新動態</b>', views: 35 }],
    search: { daily: [{ date: '2026-10-30', clicks: 3, impressions: 400, position: 5 }], clicks: 3, impressions: 400, position: 5, pages: [{ path: '/channels/42', kind: 'channel', title: '公視新聞網', clicks: 3, impressions: 50 }] },
    vitals: [{ name: 'LCP', good: 9, needsImprovement: 0, poor: 1 }, { name: 'INP', good: 0, needsImprovement: 0, poor: 0 }, { name: 'CLS', good: 0, needsImprovement: 0, poor: 0 }],
  };
  const html = render(data, 7);
  assert.match(html, /aria-label="最近 30 分鐘"/);assert.match(html, />3<\/span> 位讀者/);assert.match(html, /id="method"/);
  assert.match(html, />110</);assert.match(html, /Google 等搜尋/);assert.match(html, /手機/);assert.match(html, /點開 YouTube 原影片/);
  assert.match(html, /href="\/videos\/AbC_123xYz9"/);assert.match(html, /&lt;b&gt;颱風最新動態/);assert.doesNotMatch(html, /<b>颱風/);
  assert.match(html, /3 點擊 \/ 50 曝光/);assert.match(html, /平均排名 5/);assert.match(html, /良好 90% · 需改善 0% · 不佳 10%/);
  // Days before tracking began have no bar; quiet tracked days are a zero, today is marked as still counting.
  assert.match(html, /2026-10-29：尚未開始追蹤/);assert.match(html, /2026-10-31：瀏覽 0/);assert.match(html, /2026-11-01（今天，累計中）：瀏覽 10/);
  assert.match(html, /查看數值表格（7 天）/);
});

test('daily bars stay inside their frame and carry a table view', () => {
  const html = renderToStaticMarkup(createElement(DailyBars, { label: '每日', name: '點擊', days: ['2026-10-30', '2026-10-31'], values: [0, 5] }));
  assert.match(html, /role="img" aria-label="每日"/);assert.match(html, /<td[^>]*>5<\/td>/);
  for (const [, y] of html.matchAll(/ y="(-?[\d.]+)"/g)) assert.ok(Number(y) >= 0, y);
});

test('the page reads the public API through the allowed family only', () => {
  assert.equal(publicApiUrl('http://127.0.0.1:4100/api/v1', 'site-observation', { days: '7' }), 'http://127.0.0.1:4100/api/v1/site-observation?days=7');
});
