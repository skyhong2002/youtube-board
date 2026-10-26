import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { readScheduleConfig, planSchedules, validateScheduleConfig } from '../src/scheduler.js';
import { workflowArgs } from '../src/workflow-registry.js';
import { validateWebsubArguments } from '../src/websub-cli.js';
import { workflowBatch } from '../../shared/worker-batches.js';

// YouTube pushes new uploads and live streams through the WebSub hub; this job turns those notices into
// discovery work and keeps the channel subscriptions leased. It runs beside the general discovery sweep.
const file = fileURLToPath(new URL('../../runtime/schedules.websub.json', import.meta.url));

describe('WebSub sync schedule file', () => {
  it('passes the real validator and runs on the youtube-source worker', async () => {
    const config = await readScheduleConfig(file);
    expect(validateScheduleConfig(JSON.parse(JSON.stringify(config)))).toEqual(config);
    expect(config.schedules.map(s => s.cron)).toEqual(['*/2 * * * *']);
    expect(workflowBatch('youtube.websub.sync')).toBe('youtube-source');
  });
  it('renders bounded CLI arguments the job accepts, thirty runs an hour', async () => {
    const config = await readScheduleConfig(file), start = new Date('2026-10-26T06:00:00Z');
    const runs = planSchedules(config, start, 60);
    expect(runs).toHaveLength(30);
    const args = workflowArgs('youtube.websub.sync', runs[0]!.input);
    expect(args).toEqual(['youtube:websub:sync', '--limit=40', '--execute']);
    expect(validateWebsubArguments(args)).toMatchObject({ execute: true, limit: 40 });
  });
});
