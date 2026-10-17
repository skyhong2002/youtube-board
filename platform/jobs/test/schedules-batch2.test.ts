import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { readScheduleConfig, planSchedules, validateScheduleConfig } from '../src/scheduler.js';
import { workflowArgs } from '../src/workflow-registry.js';
import { uploadsLiveMode, validateYoutubeArguments, youtubeRetryOptions } from '../src/youtube-cli.js';

// Batch 2 ("youtube-source") of the Laravel scheduler handoff (docs/laravel-scheduler-handoff-2026-10-18.md):
// the same Asia/Taipei cron slots and scheduled_execute_command options as config/ingestion.php.
const path = fileURLToPath(new URL('../../runtime/schedules.batch2.json', import.meta.url));
/** config/ingestion.php `schedule` + `scheduled_execute_command`, in Laravel registry order. */
const laravel: [workflow: string, cron: string, command: string][] = [
  ['youtube.channels.stats', '*/9 * * * *', 'youtube:channels:stats --limit=25 --execute'],
  ['youtube.live.poll', '* * * * *', 'youtube:live:poll --limit=50 --execute'],
  ['youtube.tvbs.live.poll', '* * * * *', 'youtube:tvbs:live:poll --limit=20 --execute'],
  ['youtube.live.cleanup', '27 */2 * * *', 'youtube:live:cleanup --limit=100 --execute'],
  ['youtube.channels.videos.live_group', '1,31 0-15 * * *', 'youtube:channels:videos:live-group --limit=3 --max-results=5 --execute'],
  ['youtube.channels.videos.live', '5 2-16 * * *', 'youtube:channels:videos:live --limit=3 --max-results=5 --execute'],
  ['youtube.channels.videos.general', '*/5 * * * *', 'youtube:channels:videos --limit=5 --max-results=3 --execute'],
  ['youtube.tvbs.videos', '*/5 * * * *', 'youtube:tvbs:videos --limit=1 --max-results=1 --offset=auto --execute'],
  // Laravel also passes --keyword-limit=100000; TS matches the pinned upstream vocabulary instead of a keyword scan.
  ['youtube.tag_videos.backfill', '17 3,6,9,12,15,18,21 * * *', 'youtube:tag-videos:backfill --days=2 --limit=100 --max-pages=20 --max-results=50 --tagid=102 --execute'],
  ['youtube.videos.stats', '*/7 0-17 * * *', 'youtube:videos:stats --limit=25 --execute'],
  ['youtube.videos.duration', '*/23 * * * *', 'youtube:videos:duration --enqueue-missing --limit=25 --execute'],
];
const taipei = (day: string, time: string) => new Date(Date.parse(`${day}T${time}:00+08:00`));

describe('batch 2 YouTube source schedule file', () => {
  it('passes the real validator with one stable batch2 id per Laravel job, in Laravel registry order', async () => {
    const config = await readScheduleConfig(path);
    expect(validateScheduleConfig(JSON.parse(JSON.stringify(config)))).toEqual(config);
    for (const s of config.schedules) { expect(s.id).toMatch(/^batch2-[a-z0-9-]+-v1$/); expect(s.window).toBeUndefined(); expect(Object.keys(s).sort()).toEqual(['cron', 'id', 'options', 'workflow']); }
    expect(new Set(config.schedules.map(s => s.id)).size).toBe(config.schedules.length);
    expect(config.schedules.map(s => [s.workflow, s.cron])).toEqual(laravel.map(([workflow, cron]) => [workflow, cron]));
  });

  it('renders the Laravel scheduled_execute_command options as bounded TS CLI arguments the source CLI accepts', async () => {
    const config = await readScheduleConfig(path);
    for (const [index, s] of config.schedules.entries()) {
      const args = workflowArgs(s.workflow, { options: s.options });
      expect(args.join(' ')).toBe(laravel[index]![2]);
      if (s.workflow !== 'youtube.live.cleanup') expect(validateYoutubeArguments(args)).toMatchObject({ job: s.workflow, execute: true });
    }
  });

  it('enqueues the Laravel slots in registry order and the Laravel number of runs per Taipei day', async () => {
    const config = await readScheduleConfig(path), at = (day: string, time: string) => planSchedules(config, taipei(day, time), 1).map(r => r.schedule);
    expect(at('2031-03-04', '00:00')).toEqual(['batch2-channels-stats-v1', 'batch2-live-poll-v1', 'batch2-tvbs-live-poll-v1', 'batch2-videos-general-v1', 'batch2-tvbs-videos-v1', 'batch2-videos-stats-v1', 'batch2-videos-duration-v1']);
    expect(at('2031-03-04', '15:05')).toEqual(['batch2-live-poll-v1', 'batch2-tvbs-live-poll-v1', 'batch2-videos-live-v1', 'batch2-videos-general-v1', 'batch2-tvbs-videos-v1']);
    expect(at('2031-03-04', '15:31')).toEqual(['batch2-live-poll-v1', 'batch2-tvbs-live-poll-v1', 'batch2-videos-live-group-v1']);
    expect(at('2031-03-04', '16:31')).toEqual(['batch2-live-poll-v1', 'batch2-tvbs-live-poll-v1']);
    expect(at('2031-03-04', '21:17')).toEqual(['batch2-live-poll-v1', 'batch2-tvbs-live-poll-v1', 'batch2-tag-videos-backfill-v1']);
    expect(at('2031-03-04', '13:27')).toEqual(['batch2-channels-stats-v1', 'batch2-live-poll-v1', 'batch2-tvbs-live-poll-v1']);
    expect(at('2031-03-04', '14:27')).toEqual(['batch2-channels-stats-v1', 'batch2-live-poll-v1', 'batch2-tvbs-live-poll-v1', 'batch2-live-cleanup-v1']);
    expect(at('2031-03-04', '18:07')).toEqual(['batch2-live-poll-v1', 'batch2-tvbs-live-poll-v1']);
    const counts: Record<string, number> = {};
    for (let minute = 0; minute < 1440; minute++)
      for (const run of planSchedules(config, new Date(taipei('2031-03-04', '00:00').getTime() + minute * 60000), 1)) counts[run.schedule] = (counts[run.schedule] ?? 0) + 1;
    expect(counts).toEqual({
      'batch2-channels-stats-v1': 24 * 7, 'batch2-live-poll-v1': 1440, 'batch2-tvbs-live-poll-v1': 1440, 'batch2-live-cleanup-v1': 12,
      'batch2-videos-live-group-v1': 16 * 2, 'batch2-videos-live-v1': 15, 'batch2-videos-general-v1': 288, 'batch2-tvbs-videos-v1': 288,
      'batch2-tag-videos-backfill-v1': 7, 'batch2-videos-stats-v1': 18 * 9, 'batch2-videos-duration-v1': 24 * 3,
    });
  });

  it('keeps the Laravel live tag mapping, TVBS offset and YouTube retry settings in the source CLI', () => {
    expect(uploadsLiveMode('youtube.channels.videos.live')).toEqual({ live: 1 });
    expect(uploadsLiveMode('youtube.channels.videos.live_group')).toEqual({ live: 2 });
    expect(uploadsLiveMode('youtube.channels.videos.general')).toEqual({});
    expect(() => validateYoutubeArguments(['youtube:tvbs:videos', '--offset=17'])).not.toThrow();
    expect(() => validateYoutubeArguments(['youtube:tvbs:videos', '--offset=-1'])).toThrow();
    expect(() => validateYoutubeArguments(['youtube:channels:videos', '--offset=auto'])).toThrow();
    expect(youtubeRetryOptions({})).toEqual({ transientRetries: 1, retryDelayMs: 250 });
    expect(youtubeRetryOptions({ YOUTUBE_API_TRANSIENT_RETRIES: '9', YOUTUBE_API_RETRY_DELAY_MS: '0' })).toEqual({ transientRetries: 3, retryDelayMs: 0 });
  });
});
