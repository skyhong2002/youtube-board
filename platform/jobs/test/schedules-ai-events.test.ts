import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { readScheduleConfig, planSchedules, validateScheduleConfig } from '../src/scheduler.js';
import { workflowArgs } from '../src/workflow-registry.js';
import { validateAiArguments } from '../src/ai-cli.js';
import { workflowBatch } from '../../shared/worker-batches.js';

// Daily AI event analyses (urt_ai_event, plus the cross-day urt_ai_period link) after the ai.daily
// catchup slots. No Laravel schedule produced them; rows stopped at the 2026-07-17 manual batch.
const file = fileURLToPath(new URL('../../runtime/schedules.ai-events.json', import.meta.url));
const taipei = (day: string, time: string) => new Date(Date.parse(`${day}T${time}:00+08:00`));

describe('AI event schedule file', () => {
  it('passes the real validator and belongs to the ai-daily worker', async () => {
    const config = await readScheduleConfig(file);
    expect(validateScheduleConfig(JSON.parse(JSON.stringify(config)))).toEqual(config);
    expect(config.schedules.map(s => [s.id, s.workflow, s.cron])).toEqual([['ai-daily-events-v1', 'ai.days_refresh', '40 7,13 * * *']]);
    expect(workflowBatch('ai.days_refresh')).toBe('ai-daily');
  });

  it('covers yesterday and the day before, events and period only', async () => {
    const config = await readScheduleConfig(file);
    for (const time of ['07:40', '13:40']) {
      const runs = planSchedules(config, taipei('2026-10-20', time), 1);
      expect(runs).toHaveLength(1);
      const args = workflowArgs('ai.days_refresh', runs[0]!.input);
      expect(args.join(' ')).toBe('ai:days-refresh --call-limit=100 --from=2026-10-18 --skip-cache --skip-daily --to=2026-10-19 --topic-limit=100 --execute');
      expect(validateAiArguments(args)).toMatchObject({ skipDaily: true, skipCache: true, skipEvents: false, skipPeriod: false });
    }
    // Month boundary uses Taipei dates, not UTC.
    expect(planSchedules(config, taipei('2026-11-01', '07:40'), 1)[0]!.input.options).toMatchObject({ from: '2026-10-30', to: '2026-10-31' });
  });
});
