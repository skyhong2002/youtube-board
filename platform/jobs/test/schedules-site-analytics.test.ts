import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { readScheduleConfig, planSchedules, validateScheduleConfig } from '../src/scheduler.js';
import { validateWorkflowInput, workflowArgs } from '../src/workflow-registry.js';
import { validateSiteAnalyticsArguments } from '../src/site-analytics-cli.js';
import { workflowBatch } from '../../shared/worker-batches.js';
import { batchProfile, workerProfile } from '../../shared/worker-schema.js';

// 本站流量: the GA4/Search Console pull hourly at :20 (as tag.observe.tw's ANALYTICS_CRON) and GA Realtime every two
// minutes, both on the cache worker, which already derives TS-owned data without YouTube quota.
const file = fileURLToPath(new URL('../../runtime/schedules.site-analytics.json', import.meta.url));

describe('site analytics schedule file', () => {
  it('passes the real validator and runs on the cache worker', async () => {
    const config = await readScheduleConfig(file);
    expect(validateScheduleConfig(JSON.parse(JSON.stringify(config)))).toEqual(config);
    expect(config.schedules.map(s => [s.workflow, s.cron])).toEqual([['site.analytics.sync', '20 * * * *'], ['site.analytics.live', '*/2 * * * *']]);
    for (const workflow of ['site.analytics.sync', 'site.analytics.live']) expect(workflowBatch(workflow)).toBe('cache');
  });
  it('renders the bare execute command: one sync and thirty live runs an hour', async () => {
    const config = await readScheduleConfig(file), runs = planSchedules(config, new Date('2026-11-01T06:00:00Z'), 60);
    const count = (workflow: string) => runs.filter(r => r.workflow === workflow).length;
    expect([count('site.analytics.sync'), count('site.analytics.live')]).toEqual([1, 30]);
    expect(workflowArgs('site.analytics.sync', runs.find(r => r.workflow === 'site.analytics.sync')!.input)).toEqual(['site:analytics:sync', '--execute']);
    expect(workflowArgs('site.analytics.live', runs.find(r => r.workflow === 'site.analytics.live')!.input)).toEqual(['site:analytics:live', '--execute']);
    expect(validateSiteAnalyticsArguments(['site:analytics:live', '--execute'])).toEqual({ job: 'site.analytics.live', execute: true });
  });
  it('accepts no options at all', () => {
    for (const options of [{ limit: 1 }, { days: 90 }, { 'property-id': '1' }]) expect(() => validateWorkflowInput('site.analytics.sync', { options })).toThrow();
    expect(() => validateSiteAnalyticsArguments(['site:analytics:sync', '--days=90'])).toThrow();
    expect(() => validateSiteAnalyticsArguments(['site:analytics:sync', '--execute', '--execute'])).toThrow();
  });
  it('holds only its own table rights: replace windows of ts_site_metrics, journal sync runs, nothing on source tables', () => {
    expect(workerProfile('site.analytics.sync').tables).toEqual({ ts_site_metrics: ['DELETE', 'INSERT', 'SELECT'], ts_job_runs: ['INSERT', 'SELECT', 'UPDATE'] });
    expect(workerProfile('site.analytics.live').tables).toEqual({ ts_site_metrics: ['DELETE', 'INSERT', 'SELECT'] });
    expect(batchProfile('cache').tables.ts_site_metrics).toEqual(['DELETE', 'INSERT', 'SELECT']);
  });
});
