import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { readScheduleConfig, planSchedules, validateScheduleConfig } from '../src/scheduler.js';
import { workflowArgs } from '../src/workflow-registry.js';
import { validateCacheArguments } from '../src/cache-cli.js';
import { workflowBatch } from '../../shared/worker-batches.js';

// Election pages read tagid 3-6 tag-date caches of the candidate names. Laravel reports:mayor:static
// rebuilt them every 5 hours; it was retired in the handoff, so the rows stopped at 2026-10-16.
const file = fileURLToPath(new URL('../../runtime/schedules.mayor-cache.json', import.meta.url));
const taipei = (day: string, time: string) => new Date(Date.parse(`${day}T${time}:00+08:00`));

describe('mayor candidate cache schedule file', () => {
  it('passes the real validator and runs on the cache worker', async () => {
    const config = await readScheduleConfig(file);
    expect(validateScheduleConfig(JSON.parse(JSON.stringify(config)))).toEqual(config);
    expect(config.schedules.map(s => s.cron)).toEqual(['13 1,6,11,16,21 * * *', '15 1,6,11,16,21 * * *', '17 1,6,11,16,21 * * *', '19 1,6,11,16,21 * * *']);
    expect(workflowBatch('reports.tag_date.build')).toBe('cache');
  });

  it('rebuilds the last eight Taipei dates of one category each, candidate names only', async () => {
    const config = await readScheduleConfig(file), now = taipei('2026-10-20', '21:13');
    const tags = config.schedules.map(s => {
      const run = planSchedules({ ...config, schedules: [s] }, new Date(now.getTime() + (Number(s.cron.split(' ')[0]) - 13) * 60000), 1)[0]!;
      const parsed = validateCacheArguments(workflowArgs('reports.tag_date.build', run.input), now);
      expect(parsed).toMatchObject({ execute: true, input: { from: '2026-10-13', to: '2026-10-20', channelLimit: 1000, videoLimit: 10000 } });
      expect(parsed.options.get('keyword-set')).toBe('mayor-candidates');
      return parsed.input.tagIds;
    });
    expect(tags).toEqual([[3], [4], [5], [6]]);
  });
});
