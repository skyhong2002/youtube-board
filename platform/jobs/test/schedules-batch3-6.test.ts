import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { readScheduleConfig, planSchedules, validateScheduleConfig, type ScheduleConfig } from '../src/scheduler.js';
import { workflowArgs, validateWorkflowInput } from '../src/workflow-registry.js';
import { validateAiArguments } from '../src/ai-cli.js';
import { dailySourceArgs, validateDerivedArguments } from '../src/ai-derived-cli.js';
import { validateYoutubeArguments } from '../src/youtube-cli.js';

// Batches 3–6 of the Laravel scheduler handoff (docs/laravel-scheduler-handoff-2026-10-18.md): the TS
// schedules keep the production Laravel Asia/Taipei cron slots and scheduled_execute_command options
// from config/ingestion.php.
const file = (batch: number) => fileURLToPath(new URL(`../../runtime/schedules.batch${batch}.json`, import.meta.url));
/** Taipei wall-clock minute → UTC instant (Taiwan has no DST). */
const taipei = (day: string, time: string) => new Date(Date.parse(`${day}T${time}:00+08:00`));
const perDay = (config: ScheduleConfig) => {
  const counts: Record<string, number> = {};
  for (let minute = 0; minute < 1440; minute++)
    for (const run of planSchedules(config, new Date(taipei('2031-03-04', '00:00').getTime() + minute * 60000), 1)) counts[run.schedule] = (counts[run.schedule] ?? 0) + 1;
  return counts;
};
const expected: Record<number, { workflows: Record<string, string>; perDay: Record<string, number>; args: Record<string, string> }> = {
  3: {
    workflows: { 'youtube.comments.queue': '23 4,10,16 * * *', 'youtube.comments.fetch': '5 * * * *' },
    perDay: { 'batch3-comments-queue-v1': 3, 'batch3-comments-fetch-v1': 24 },
    args: {
      // Laravel: youtube:comments:queue --or=1,2,3,4,5,6,13,14,81 --hours=72 --min=500 --execute --limit=5
      'batch3-comments-queue-v1': 'youtube:comments:queue --hours=72 --limit=5 --min=500 --or=1,2,3,4,5,6,13,14,81 --execute',
      // Laravel: youtube:comments:fetch --execute --limit=5 --max-pages=1 --max-reply-pages=20
      'batch3-comments-fetch-v1': 'youtube:comments:fetch --limit=5 --max-pages=1 --max-reply-pages=20 --execute',
    },
  },
  4: {
    workflows: { 'ai.daily': '0 0 * * *', 'ai.daily.catchup': '20 2,4,6 * * *' },
    perDay: { 'batch4-ai-daily-v1': 1, 'batch4-ai-daily-catchup-v1': 3 },
    // Laravel: ai:daily:pipeline --execute [--missing-only] --date=yesterday --channel-limit=39 --channel-batch-size=12
    //   --ai-call-limit=45 --channel-video-limit=120 --limit=1000. The date is pinned to the slot's previous Taipei day;
    // --channel-batch-size only chunked the sequential channel loop for reporting and changes no written row.
    args: {
      'batch4-ai-daily-v1': 'ai:daily:pipeline --call-limit=45 --channel-limit=39 --channel-video-limit=120 --date=2031-03-03 --limit=1000 --execute',
      'batch4-ai-daily-catchup-v1': 'ai:daily:catchup --call-limit=45 --channel-limit=39 --channel-video-limit=120 --date=2031-03-03 --limit=1000 --execute',
    },
  },
  5: {
    workflows: { 'ai.hourly': '10 * * * *' },
    perDay: { 'batch5-ai-hourly-v1': 24 },
    // Laravel: ai:hourly:pipeline --execute --limit=20 --source-max-results=50 (previous full Taipei hour).
    args: { 'batch5-ai-hourly-v1': 'ai:hourly:pipeline --from=2031-03-04 02:00:00 --limit=20 --source-max-results=50 --to=2031-03-04 02:59:59 --execute' },
  },
  6: {
    workflows: { 'ai.mayor_person': '45 5,20 * * *' },
    perDay: { 'batch6-ai-mayor-person-v1': 2 },
    // Laravel: ai:mayor-person --execute --city=taipei --limit=10 --ai-call-limit=10
    args: { 'batch6-ai-mayor-person-v1': 'ai:mayor-person --call-limit=10 --city=taipei --limit=10 --execute' },
  },
};
/** One Laravel slot per entry (Taipei, 2031-03-04). */
const slot: Record<string, string> = {
  'batch3-comments-queue-v1': '04:23', 'batch3-comments-fetch-v1': '05:05', 'batch4-ai-daily-v1': '00:00',
  'batch4-ai-daily-catchup-v1': '02:20', 'batch5-ai-hourly-v1': '03:10', 'batch6-ai-mayor-person-v1': '05:45',
};

describe.each([3, 4, 5, 6])('batch %i schedule file', batch => {
  it('passes the real validator with stable unique ids, only this batch and the Laravel cron slots', async () => {
    const config = await readScheduleConfig(file(batch));
    expect(validateScheduleConfig(JSON.parse(JSON.stringify(config)))).toEqual(config);
    for (const s of config.schedules) expect(s.id).toMatch(new RegExp(`^batch${batch}-[a-z0-9-]+-v1$`));
    expect(new Set(config.schedules.map(s => s.id)).size).toBe(config.schedules.length);
    expect(Object.fromEntries(config.schedules.map(s => [s.workflow, s.cron]))).toEqual(expected[batch]!.workflows);
    expect(config.schedules).toHaveLength(Object.keys(expected[batch]!.workflows).length);
  });

  it('produces the Laravel number of runs per Taipei day', async () => {
    expect(perDay(await readScheduleConfig(file(batch)))).toEqual(expected[batch]!.perDay);
  });

  it('renders the Laravel scheduled command options as bounded TS CLI arguments', async () => {
    const config = await readScheduleConfig(file(batch));
    for (const s of config.schedules) {
      const run = planSchedules(config, taipei('2031-03-04', slot[s.id]!), 1).find(r => r.schedule === s.id);
      expect(run, s.id).toBeDefined();
      const args = workflowArgs(s.workflow, run!.input);
      expect(args.join(' ')).toBe(expected[batch]!.args[s.id]);
      if (s.workflow.startsWith('ai.')) expect(() => validateAiArguments(args)).not.toThrow();
    }
  });
});

describe('batch 3–6 schedule details', () => {
  it('pins the AI windows to the scheduled slot, not to the time a serial worker dequeues it', async () => {
    const hourly = await readScheduleConfig(file(5));
    // The skipped Laravel run of 2026-10-18 03:10 Taipei covered 02:00–02:59:59.
    expect(planSchedules(hourly, taipei('2026-10-18', '03:10'), 1)[0]!.input.options).toMatchObject({ from: '2026-10-18 02:00:00', to: '2026-10-18 02:59:59' });
    expect(planSchedules(hourly, taipei('2026-10-18', '00:10'), 1)[0]!.input.options).toMatchObject({ from: '2026-10-17 23:00:00', to: '2026-10-17 23:59:59' });
    const daily = await readScheduleConfig(file(4));
    expect(planSchedules(daily, taipei('2026-10-19', '00:00'), 1).map(r => r.input.options.date)).toEqual(['2026-10-18']);
    expect(planSchedules(daily, taipei('2026-10-19', '06:20'), 1).map(r => [r.workflow, r.input.options.date])).toEqual([['ai.daily.catchup', '2026-10-18']]);
  });

  it('keeps operator-only comment reset out of recurring schedules', () => {
    expect(() => validateScheduleConfig({ version: 1, timezone: 'Asia/Taipei', schedules: [{ id: 'x', workflow: 'youtube.comments.reset', cron: '5 * * * *', options: { videoId: 'abcdefghijk' } }] })).toThrow('Operator-only');
    expect(validateWorkflowInput('youtube.comments.queue', { options: { or: '1,2,3,4,5,6,13,14,81', hours: 72, min: 500, limit: 5 } }).options.or).toBe('1,2,3,4,5,6,13,14,81');
  });
});

describe('batch 3–6 Laravel option semantics', () => {
  it('accepts the Laravel --or comment queue filter on the CLI', () => {
    expect(validateYoutubeArguments(['youtube:comments:queue', '--or=1,2,3,4,5,6,13,14,81', '--hours=72', '--min=500', '--limit=5', '--execute'])).toMatchObject({ job: 'youtube.comments.queue', execute: true });
    expect(() => validateYoutubeArguments(['youtube:comments:queue', '--or=1,x'])).toThrow('taxonomy');
  });
  it('treats --channel-limit as the channel-AI cap and crawls tag 102 like Laravel executeDaily()', () => {
    expect(validateAiArguments(['ai:daily:pipeline', '--date=2031-03-03', '--channel-limit=39'])).toMatchObject({ channelLimit: 39, channelVideoLimit: 120, limit: 1000 });
    expect(validateAiArguments(['ai:daily:catchup', '--date=2031-03-03', '--channel-limit=0', '--channel-video-limit=0'])).toMatchObject({ channelLimit: 0, channelVideoLimit: 0 });
    expect(dailySourceArgs('2031-03-03', 20, 1000, true)).toEqual(['youtube:tag-videos:backfill', '--tagid=102', '--from=2031-03-03', '--to=2031-03-03', '--limit=100', '--max-pages=20', '--max-results=50', '--max-api-attempts=1000', '--execute']);
    // The source step rebuilds the day's tag-date cache (no --no-cache), as Laravel's 00:00 tag-102 crawl did.
    expect(dailySourceArgs('2031-03-03', 20, 1000, false)).not.toContain('--no-cache');
    expect(() => validateYoutubeArguments(dailySourceArgs('2031-03-03', 20, 1000, true))).not.toThrow();
  });
  it('backfills one explicit past hour such as the skipped Laravel 2026-10-18 02:00 run', () => {
    const parsed = validateDerivedArguments(['ai:hourly:pipeline', '--from=2026-10-18 02:00:00', '--to=2026-10-18 02:59:59', '--source-max-pages=4', '--missing-only', '--execute']);
    expect(parsed).toMatchObject({ workflow: 'ai.hourly', execute: true, missingOnly: true, input: { kind: 'hourly', from: '2026-10-18 02:00:00', to: '2026-10-18 02:59:59', userToken: 'cli', sourceMaxPages: 4, sourceMaxResults: 50 } });
    expect((parsed.input as { condition?: string }).condition).toBeUndefined();
    expect(() => validateDerivedArguments(['ai:hourly:pipeline', '--from=2026-10-18 02:00:00', '--to=2026-10-18 02:59:59', '--hour=3'])).toThrow('absolute or relative');
  });
});
