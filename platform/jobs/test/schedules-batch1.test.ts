import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fileURLToPath } from 'node:url';
const mocks = vi.hoisted(() => ({ queueConstruct: vi.fn(), workerConstruct: vi.fn(), add: vi.fn(), getJob: vi.fn(), close: vi.fn(), quit: vi.fn(), eval: vi.fn(), execute: vi.fn() }));
vi.mock('bullmq', () => ({ Queue: class { constructor(...args: unknown[]) { mocks.queueConstruct(...args); } add = mocks.add; getJob = mocks.getJob; close = mocks.close; }, Worker: class { constructor(...args: unknown[]) { mocks.workerConstruct(...args); } close = mocks.close; } }));
vi.mock('ioredis', () => ({ Redis: class { quit = mocks.quit; eval = mocks.eval; disconnect() {} on() {} } }));
vi.mock('../src/workflow-registry.js', async original => ({ ...await original<typeof import('../src/workflow-registry.js')>(), executeRegisteredWorkflow: mocks.execute }));
import { readScheduleConfig, planSchedules, validateScheduleConfig, tickSchedules } from '../src/scheduler.js';
import { workflowArgs } from '../src/workflow-registry.js';
import { startWorker } from '../src/worker.js';
import { workflowBatch } from '../../shared/worker-batches.js';

// Batch 1 of the Laravel scheduler handoff (docs/laravel-scheduler-handoff-2026-10-18.md):
// the TS schedule must keep the production Laravel Asia/Taipei cron slots.
const path = fileURLToPath(new URL('../../runtime/schedules.batch1.json', import.meta.url));
const laravelCron: Record<string, string[]> = {
  'reports.counts.build': ['27 3,8,11,13,18,23 * * *'],
  'reports.people.build': ['27 3,8,11,13,18,23 * * *'],
  'reports.tag_cloud.build': ['27 3,8,11,13,18,23 * * *'],
  'reports.tag_date.build': ['27 3,8,11,13,18,23 * * *'],
  'reports.keywords.cache': ['27 3,8,11,13,18,23 * * *'],
  'reports.schedule.build': ['29,47 * * * *'],
  'reports.live.build': ['*/9 0-9,15,23 * * *', '*/19 10-14 * * *'],
  'reports.live.clean': ['33 3,13,23 * * *'],
};
/** Taipei wall-clock minute → UTC instant (Taiwan has no DST). */
const taipei = (day: string, time: string) => new Date(Date.parse(`${day}T${time}:00+08:00`));

describe('batch 1 derived-cache schedule file', () => {
  it('passes the real validator with stable unique batch1 ids and only batch-1 workflows', async () => {
    const config = await readScheduleConfig(path);
    expect(validateScheduleConfig(JSON.parse(JSON.stringify(config)))).toEqual(config);
    for (const s of config.schedules) expect(s.id).toMatch(/^batch1-reports-[a-z0-9-]+-v1$/);
    expect(new Set(config.schedules.map(s => s.id)).size).toBe(config.schedules.length);
    expect([...new Set(config.schedules.map(s => s.workflow))].sort()).toEqual(Object.keys(laravelCron).sort());
    for (const [workflow, crons] of Object.entries(laravelCron))
      expect([...new Set(config.schedules.filter(s => s.workflow === workflow).map(s => s.cron))].sort()).toEqual([...crons].sort());
    // Not scheduled: retired Laravel jobs, the read-only group status report, and the channel cloud that
    // production Laravel skips (not in INGESTION_SCHEDULED_WRITE_ALLOWLIST) and TS cannot rotate.
    for (const s of config.schedules) {
      expect(['reports.keywords.build', 'reports.live.show', 'reports.live.static', 'reports.mayor.static', 'reports.groups.build', 'reports.channel_cloud.build']).not.toContain(s.workflow);
      expect(s.window).toBeUndefined();
    }
  });

  it('enqueues the Laravel slots in Laravel registry order and nothing in between', async () => {
    const config = await readScheduleConfig(path);
    const at = (day: string, time: string) => planSchedules(config, taipei(day, time), 1).map(r => r.schedule);
    expect(at('2031-03-04', '03:27')).toEqual([
      'batch1-reports-counts-v1', 'batch1-reports-people-v1',
      'batch1-reports-tag-cloud-v1',
      'batch1-reports-tag-date-v1', 'batch1-reports-keywords-cache-v1', 'batch1-reports-live-build-v1',
    ]);
    expect(at('2031-03-04', '10:27')).toEqual([]);
    expect(at('2031-03-04', '13:27')).toHaveLength(5);
    expect(at('2031-03-04', '12:19')).toEqual(['batch1-reports-live-build-midday-v1']);
    expect(at('2031-03-04', '15:27')).toEqual(['batch1-reports-live-build-v1']);
    expect(at('2031-03-04', '23:33')).toEqual(['batch1-reports-live-clean-v1']);
    expect(at('2031-03-04', '16:47')).toEqual(['batch1-reports-schedule-v1']);
  });

  it('produces the Laravel number of runs per Taipei day', async () => {
    const config = await readScheduleConfig(path), counts: Record<string, number> = {};
    for (let minute = 0; minute < 1440; minute++)
      for (const run of planSchedules(config, new Date(taipei('2031-03-04', '00:00').getTime() + minute * 60000), 1)) counts[run.schedule] = (counts[run.schedule] ?? 0) + 1;
    expect(counts).toEqual({
      'batch1-reports-counts-v1': 6, 'batch1-reports-people-v1': 6,
      'batch1-reports-tag-cloud-v1': 6,
      'batch1-reports-tag-date-v1': 6, 'batch1-reports-keywords-cache-v1': 6,
      'batch1-reports-schedule-v1': 48,
      'batch1-reports-live-build-v1': 12 * 7, 'batch1-reports-live-build-midday-v1': 5 * 4,
      'batch1-reports-live-clean-v1': 3,
    });
  });

  it('renders the reviewed bounded CLI arguments for each entry', async () => {
    const config = await readScheduleConfig(path);
    const args = Object.fromEntries(config.schedules.map(s => [s.id, workflowArgs(s.workflow, { options: s.options }).join(' ')]));
    expect(args).toEqual({
      'batch1-reports-counts-v1': 'reports:counts:build --limit=100 --execute',
      'batch1-reports-people-v1': 'reports:people:build --channel-limit=1000 --days=37 --tagid=13 --video-limit=10000 --execute',
      'batch1-reports-tag-cloud-v1': 'reports:tag-cloud:build --channel-limit=1000 --days=1,3,7,30,90 --tagid=1 --video-limit=600000 --execute',
      'batch1-reports-tag-date-v1': 'reports:tag-date:build --channel-limit=1000 --days=2 --tagid=1 --video-limit=10000 --execute',
      'batch1-reports-keywords-cache-v1': 'reports:keywords:cache --days=31 --recent-days=7 --video-limit=100000 --execute',
      'batch1-reports-schedule-v1': 'reports:schedule:build --limit=100 --execute',
      'batch1-reports-live-build-v1': 'reports:live:build --hours=24 --limit=100 --execute',
      'batch1-reports-live-build-midday-v1': 'reports:live:build --hours=24 --limit=100 --execute',
      'batch1-reports-live-clean-v1': 'reports:live:clean --limit=200 --execute',
    });
  });
});

describe('batch 1 on the serial cache batch queue', () => {
  beforeEach(() => {
    vi.resetAllMocks(); mocks.close.mockResolvedValue(undefined); mocks.quit.mockResolvedValue(undefined); mocks.eval.mockResolvedValue(2); mocks.getJob.mockResolvedValue(undefined);
    mocks.add.mockImplementation(async (name: string, data: unknown, opts: { jobId: string }) => ({ id: opts.jobId, name, data, getState: async () => 'waiting' }));
  });
  const owners = Object.keys(laravelCron).join(',');
  const gates = { APP_ENV: 'test', TS_INGESTION_ENABLED: 'true', TS_SCHEDULER_ENABLED: 'true', TS_INGESTION_OWNERS: owners };

  it('every entry belongs to the cache batch', async () => {
    for (const s of (await readScheduleConfig(path)).schedules) expect(workflowBatch(s.workflow), s.id).toBe('cache');
  });

  it('the 03:27 slot enqueues its 6 runs into the one cache queue in Laravel order, and the cache worker drains it one at a time', async () => {
    const config = await readScheduleConfig(path), now = taipei('2031-03-04', '03:27');
    const runs = await tickSchedules(config, { ...gates, TS_QUEUE_MODE: 'batch' }, now, 1);
    expect(runs.map(r => r.schedule)).toEqual(planSchedules(config, now, 1).map(r => r.schedule));
    expect(runs).toHaveLength(6);
    expect(new Set(runs.map(r => r.queue))).toEqual(new Set(['youtube-board-ts-batch-cache']));
    expect(runs.every(r => r.state === 'waiting')).toBe(true);
    // Arrival order on the queue is the configured (Laravel registry) order; each slot keeps its own deterministic identity.
    expect(mocks.add.mock.calls.map(c => c[0])).toEqual(runs.map(r => r.workflow));
    expect(new Set(mocks.add.mock.calls.map(c => c[2].jobId)).size).toBe(6);
    expect(mocks.queueConstruct.mock.calls.every(c => c[0] === 'youtube-board-ts-batch-cache')).toBe(true);
    const again = await tickSchedules(config, { ...gates, TS_QUEUE_MODE: 'batch' }, now, 1);
    expect(again.map(r => r.runId)).toEqual(runs.map(r => r.runId));

    const worker = { ...gates, TS_WORKER_SCHEMA_MODE: 'facade', DB_DATABASE: 'youtube_board_ts_worker_cache_rewrite', TS_WORKER_BATCH: 'cache' };
    const handle = startWorker(worker);
    const [queue, consume, options] = mocks.workerConstruct.mock.calls[0] as [string, (job: unknown) => Promise<unknown>, { concurrency: number }];
    expect(queue).toBe('youtube-board-ts-batch-cache'); expect(options.concurrency).toBe(1);
    for (const [name, data] of mocks.add.mock.calls.slice(0, 6)) await consume({ name, data });
    expect(mocks.execute.mock.calls.map(c => c[0])).toEqual(runs.map(r => r.workflow));
    await handle.close();
  });

  it('a cache-batch scheduler refuses configuration entries owned by another batch before enqueueing', async () => {
    const config = await readScheduleConfig(path), enqueue = vi.fn();
    const foreign = { ...config, schedules: [...config.schedules, { id: 'stats-v1', workflow: 'youtube.videos.stats', cron: '*/9 * * * *', options: { limit: 25 } }] };
    await expect(tickSchedules(foreign, { ...gates, TS_INGESTION_OWNERS: owners + ',youtube.videos.stats', TS_QUEUE_MODE: 'batch', TS_WORKER_BATCH: 'cache' }, taipei('2031-03-04', '03:27'), 1, enqueue)).rejects.toThrow('declared worker batch');
    expect(enqueue).not.toHaveBeenCalled();
  });
});
