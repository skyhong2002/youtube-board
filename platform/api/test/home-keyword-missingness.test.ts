import { expect, it } from 'vitest';
import { channelHeat, keywordDisplayMap, rankKeywordWindows } from '../src/reports/home-keyword-ranking.js';
import { NO_VIEWS, viewsCell } from '../../web/src/lib/keyword-ranking.js';

const display = keywordDisplayMap([{ term_key: 'a', term: 'OpenAI' }]);

it.each([
  { name: 'partial', n: 3, m: 2, v: 20, views: null, detail: '已知小計 20 次・1 支缺值' },
  { name: 'all missing', n: 3, m: 0, v: 0, views: null, detail: '3 支缺值' },
  { name: 'partial with a known zero', n: 3, m: 1, v: 0, views: null, detail: '已知小計 0 次・2 支缺值' },
  { name: 'fully measured zero', n: 3, m: 3, v: 0, views: 0, detail: null },
])('$name keeps coverage separate from total in both aggregate forms and presentation', ({ n, m, v, views, detail }) => {
  const common = { window_key: 'week', g: 'a', n, t: 1, m, v };
  const perChannel = rankKeywordWindows([{ ...common, c: 1 }], display, [], { week: false, today: false });
  const sqlAggregate = rankKeywordWindows([{ ...common, channel_count: 1, heat_score: channelHeat(1, n - 1) }], display, [], { week: false, today: false });
  expect(sqlAggregate).toEqual(perChannel);
  const row = perChannel.week[0]!;
  expect(row).toMatchObject({ views, knownViews: v, measuredViewVideos: m, unknownViewVideos: n - m });
  expect(viewsCell(row)).toMatchObject({ value: views === null ? NO_VIEWS : '0 次', detail });
});

it('unknown views neither lower heat rank nor alter ties when measurements arrive', () => {
  const d = keywordDisplayMap([{ term_key: 'a', term: 'OpenAI' }, { term_key: 'b', term: 'Apple' }, { term_key: 'c', term: '台積電' }]);
  const rows = [
    { window_key: 'week', g: 'a', c: 1, n: 2, t: 2, m: 0, v: 0 },
    { window_key: 'week', g: 'b', c: 2, n: 1, t: 1, m: 1, v: 999999 },
    { window_key: 'week', g: 'c', c: 3, n: 2, t: 2, m: 2, v: 10 },
  ];
  const rank = (records: typeof rows) => rankKeywordWindows(records, d, [], { week: false, today: false }).week;
  const unknown = rank(rows);
  expect(unknown.map(row => row.key)).toEqual(['a', 'c', 'b']);
  expect(unknown[0]?.views).toBeNull();
  const measured = rank(rows.map(row => row.g === 'a' ? { ...row, m: 2, v: 0 } : row));
  expect(measured.map(row => row.key)).toEqual(unknown.map(row => row.key));
  expect(measured[0]?.views).toBe(0);
  expect(rows[0]).toMatchObject({ m: 0, v: 0 });
});
