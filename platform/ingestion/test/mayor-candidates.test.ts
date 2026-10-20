import { it, expect } from 'vitest';
import { tagMetricsAccumulator } from '../../shared/cache-metrics.js';
import { laravelSubsetMatch, mayorCandidateTerms } from '../src/mayor-candidates.js';
it('candidate terms cover every city candidate and the press aliases', () => {
  const terms = mayorCandidateTerms();
  expect(terms).toContain('蔣萬安');expect(terms).toContain('温世政');expect(terms).toContain('溫世政');
  expect(new Set(terms).size).toBe(terms.length);
});
it('matches Laravel substr_count over title, title and description with longer-term subtraction', () => {
  const count = (matches: { term: string }[], term: string) => matches.filter(m => m.term === term).length;
  const m = laravelSubsetMatch(['蔣萬安', '沈伯洋'], '蔣萬安 vs 沈伯洋', '蔣萬安說');
  expect(count(m, '蔣萬安')).toBe(3);expect(count(m, '沈伯洋')).toBe(2);
  const nested = laravelSubsetMatch(['陳瑩', '陳瑩瑩'], '陳瑩瑩', '陳瑩');
  expect(count(nested, '陳瑩瑩')).toBe(2);expect(count(nested, '陳瑩')).toBe(1);
  expect(laravelSubsetMatch(['蔣萬安'], '天氣', '')).toEqual([]);
});
it('scores divide by the Laravel tags divisor', () => {
  const acc = tagMetricsAccumulator();
  acc.add({ viewCount: 10, matches: laravelSubsetMatch(['蔣萬安'], '蔣萬安', '') });
  const r = acc.result(term => term === '蔣萬安' ? 382.5 : 1);
  expect(r.tags_result).toEqual({ 蔣萬安: (2 * (Math.log(3.5) - 0.5) / 382.5).toFixed(3) });
  expect(r.tags_views).toEqual({ 蔣萬安: 10 });expect(r.tags_video).toEqual({ 蔣萬安: 1 });
});
