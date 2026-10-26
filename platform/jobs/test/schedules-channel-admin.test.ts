import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { readScheduleConfig, planSchedules, validateScheduleConfig } from '../src/scheduler.js';
import { workflowArgs } from '../src/workflow-registry.js';
import { validateYoutubeArguments } from '../src/youtube-cli.js';
import { workflowBatch } from '../../shared/worker-batches.js';
import { workerProfile } from '../../shared/worker-schema.js';

// Administrators' channel edits are queued by the web and applied here once a minute, on the youtube-source worker.
const file = fileURLToPath(new URL('../../runtime/schedules.channel-admin.json', import.meta.url));

describe('channel admin schedule file', () => {
  it('passes the real validator and runs on the youtube-source worker', async () => {
    const config = await readScheduleConfig(file);
    expect(validateScheduleConfig(JSON.parse(JSON.stringify(config)))).toEqual(config);
    expect(config.schedules.map(s => s.cron)).toEqual(['* * * * *']);
    expect(workflowBatch('youtube.channels.admin')).toBe('youtube-source');
  });
  it('renders bounded CLI arguments the job accepts, sixty runs an hour', async () => {
    const config = await readScheduleConfig(file), start = new Date('2026-10-26T06:00:00Z');
    const runs = planSchedules(config, start, 60);
    expect(runs).toHaveLength(60);
    const args = workflowArgs('youtube.channels.admin', runs[0]!.input);
    expect(args).toEqual(['youtube:channels:admin', '--limit=10', '--execute']);
    expect(validateYoutubeArguments(args)).toMatchObject({ job: 'youtube.channels.admin', execute: true });
  });
  it('refuses options the job does not take', () => {
    expect(() => validateYoutubeArguments(['youtube:channels:admin', '--u_id=5', '--execute'])).toThrow();
    expect(() => validateYoutubeArguments(['youtube:channels:admin', '--limit=51'])).toThrow();
  });
  it('holds only the table rights the job needs, and no delete anywhere', () => {
    const { tables } = workerProfile('youtube.channels.admin');
    expect(tables.urt_channel).toEqual(['INSERT', 'SELECT']);
    expect(tables.urt_tag).toEqual(['INSERT', 'SELECT']);
    // SELECT lets the worker verify its facade view on connect; the log is never updated or deleted.
    expect(tables.urt_tag_log).toEqual(['INSERT', 'SELECT']);
    expect(tables.ts_channel_admin_requests).toEqual(['SELECT', 'UPDATE']);
    expect(Object.values(tables).flat()).not.toContain('DELETE');
  });
});
