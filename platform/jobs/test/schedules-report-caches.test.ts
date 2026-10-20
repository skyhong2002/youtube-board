import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { readScheduleConfig, planSchedules, validateScheduleConfig } from '../src/scheduler.js';
import { workflowArgs } from '../src/workflow-registry.js';
import { validateCacheArguments, categoryTagIds, rankedSubjects } from '../src/cache-cli.js';
import { workflowBatch } from '../../shared/worker-batches.js';

// The 2026-10-20 crawl found every category but tag 1, every keyword and every channel with an empty
// cloud/days page: only tag 1 had a cache schedule, and the channel/keyword builders never ran.
const file = fileURLToPath(new URL('../../runtime/schedules.report-caches.json', import.meta.url));
const batch1 = fileURLToPath(new URL('../../runtime/schedules.batch1.json', import.meta.url));
const taipei = (day: string, time: string) => new Date(Date.parse(`${day}T${time}:00+08:00`));
const fakeDb = (rows: Record<string, unknown>[]) => ({ query: async () => [rows] }) as never;

describe('report cache schedule file', () => {
  it('passes the real validator and runs on the cache worker', async () => {
    const config = await readScheduleConfig(file);
    expect(validateScheduleConfig(JSON.parse(JSON.stringify(config)))).toEqual(config);
    for (const s of config.schedules) expect(workflowBatch(s.workflow)).toBe('cache');
  });

  it('stays out of the hours when the cache queue refreshes the live display', async () => {
    const live = (await readScheduleConfig(batch1)).schedules.filter(s => s.workflow === 'reports.live.build').flatMap(s => s.cron.split(' ')[1]!.split(',').flatMap(h => {
      const [a, b] = h.split('-').map(Number);
      return Array.from({ length: (b ?? a!) - a! + 1 }, (_, i) => a! + i);
    }));
    for (const s of (await readScheduleConfig(file)).schedules) for (const hour of s.cron.split(' ')[1]!.split(',').map(Number)) expect(live).not.toContain(hour);
  });

  it('turns every entry into valid cache arguments at its 16:xx slot', async () => {
    const config = await readScheduleConfig(file), runs = new Map<string, ReturnType<typeof validateCacheArguments>>();
    for (const s of config.schedules) {
      const now = taipei('2026-10-20', `16:${s.cron.split(' ')[0]!.padStart(2, '0')}`), run = planSchedules({ ...config, schedules: [s] }, now, 1)[0]!;
      runs.set(s.id, validateCacheArguments(workflowArgs(s.workflow, run.input), now));
    }
    expect(runs.get('report-caches-tag-cloud-each-v1')).toMatchObject({ execute: true, daysList: [1, 3, 7, 30, 90], input: { tagIds: [] } });
    expect(runs.get('report-caches-tag-cloud-each-v1')!.options.get('exclude-tagid')).toBe('1');
    expect(runs.get('report-caches-tag-cloud-all-channels-v1')).toMatchObject({ input: { tagIds: [], orTagIds: [], channelLimit: 5000 } });
    expect(runs.get('report-caches-tag-date-each-v1')).toMatchObject({ input: { from: '2026-10-13', to: '2026-10-20' } });
    // tag 3-6 (mayor candidate subset), 13 (people merge) and 102 (backfill) keep their own writers.
    expect(runs.get('report-caches-tag-date-each-v1')!.options.get('exclude-tagid')).toBe('1,3,4,5,6,13,102');
    expect(runs.get('report-caches-channel-cloud-7-v1')).toMatchObject({ input: { from: '2026-10-14', to: '2026-10-20', days: 7 } });
    expect(runs.get('report-caches-keyword-cloud-30-v1')).toMatchObject({ input: { days: 30, videoLimit: 1000000 } });
    expect(runs.get('report-caches-keyword-relations-v1')!.options.get('top-subjects')).toBe('50');
  });
});

describe('scheduled cache selections', () => {
  it('rejects mixing each-tagid or top-subjects with explicit selections', () => {
    for (const args of [
      ['reports:tag-cloud:build', '--each-tagid=all', '--tagid=2'],
      ['reports:tag-date:build', '--each-tagid=some'],
      ['reports:tag-date:build', '--each-tagid=all', '--keyword-set=mayor-candidates'],
      ['reports:tag-cloud:build', '--exclude-tagid=1'],
      ['reports:keyword-cloud:build', '--top-subjects=5', '--subject=AI'],
      ['reports:keyword-cloud:build', '--top-subjects=101'],
      ['reports:keyword-relations:build'],
    ]) expect(() => validateCacheArguments(args), args.join(' ')).toThrow();
    expect(validateCacheArguments(['reports:keyword-relations:build', '--top-subjects=3', '--days=2'], taipei('2026-10-20', '16:13'))).toMatchObject({ input: { from: '2026-10-19', to: '2026-10-20' } });
  });

  it('lists every category marker once, minus exclusions', async () => {
    expect(await categoryTagIds(fakeDb([{ tags: '[1][13]' }, { tags: '[2][13][102]' }, { tags: 'x[0]' }]), '13')).toEqual([1, 2, 102]);
  });

  it('follows the /keywords order: vocabulary article count, without display-excluded terms', () => {
    const snapshot = { terms: [{ key: 'a', term: '台股', articleCount: 100 }, { key: 'b', term: 'YouTube', articleCount: 900 }, { key: 'c', term: '颱風', articleCount: 300 }, { key: 'd', term: 'AI', articleCount: 200 }, { key: 'f', term: '2026', articleCount: 700 }, { key: 'g', term: '冷門', articleCount: 0 }] };
    expect(rankedSubjects(3, snapshot)).toEqual(['颱風', 'AI', '台股']);
    expect(() => rankedSubjects(2, { terms: [] })).toThrow('No vocabulary terms');
  });
});
