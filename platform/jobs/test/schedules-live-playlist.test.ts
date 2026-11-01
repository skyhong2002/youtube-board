import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { readScheduleConfig, planSchedules, validateScheduleConfig } from '../src/scheduler.js';
import { validateWorkflowInput, workflowArgs } from '../src/workflow-registry.js';
import { validateYoutubeArguments, youtubeResultState } from '../src/youtube-cli.js';
import { workflowBatch } from '../../shared/worker-batches.js';
import { workerProfile } from '../../shared/worker-schema.js';

// 加入直播: live streams an administrator lists in our public playlist join the live tracking every five minutes.
const file = fileURLToPath(new URL('../../runtime/schedules.live-playlist.json', import.meta.url));

describe('live playlist schedule file', () => {
  it('passes the real validator and runs on the youtube-source worker', async () => {
    const config = await readScheduleConfig(file);
    expect(validateScheduleConfig(JSON.parse(JSON.stringify(config)))).toEqual(config);
    expect(config.schedules.map(s => [s.id, s.cron])).toEqual([['live-playlist-v1', '*/5 * * * *']]);
    expect(workflowBatch('youtube.live.playlist')).toBe('youtube-source');
  });
  it('renders bounded CLI arguments the job accepts, twelve runs an hour', async () => {
    const config = await readScheduleConfig(file), start = new Date('2026-11-01T06:00:00Z');
    const runs = planSchedules(config, start, 60);
    expect(runs).toHaveLength(12);
    const args = workflowArgs('youtube.live.playlist', runs[0]!.input);
    expect(args).toEqual(['youtube:live:playlist', '--playlist=PLWDKpvlDapjQ', '--execute']);
    expect(validateYoutubeArguments(args)).toMatchObject({ job: 'youtube.live.playlist', execute: true });
  });
  it('requires an exact playlist id and refuses options the job does not take', () => {
    for (const args of [['youtube:live:playlist', '--execute'], ['youtube:live:playlist', '--playlist=UUabcdefghijklmnopqrstuv'], ['youtube:live:playlist', '--playlist=PLshort'], ['youtube:live:playlist', '--playlist=PLWDKpvlDapjQ&x=1'],
      ['youtube:live:playlist', '--playlist=PLWDKpvlDapjQ', '--limit=51'], ['youtube:live:playlist', '--playlist=PLWDKpvlDapjQ', '--u_id=5'], ['youtube:live:playlist', '--playlist=PLWDKpvlDapjQ', '--videoId=abc']]) expect(() => validateYoutubeArguments(args), args.join(' ')).toThrow();
    expect(validateYoutubeArguments(['youtube:live:playlist', '--playlist=PLWDKpvlDapjQ', '--limit=10'])).toMatchObject({ execute: false });
    expect(() => validateWorkflowInput('youtube.live.playlist', { options: { playlist: 'PLWDKpvlDapjQ', or: '1' } })).toThrow();
  });
  it('an item left in the list keeps the run complete; one it cannot apply marks the run incomplete', () => {
    const base = { applied: [], skipped: [], unchanged: ['dKGM2rzKRjs'], waiting: [] };
    expect(youtubeResultState(base)).toBe('completed');
    expect(youtubeResultState({ ...base, skipped: [{ videoId: 'x', reason: 'unavailable' }] })).toBe('incomplete');
    expect(youtubeResultState({ ...base, stoppedReason: 'request-failed' })).toBe('failed');
    expect(youtubeResultState({ ...base, stoppedReason: 'quota-exhausted' })).toBe('skipped');
  });
  it('holds only the table rights the job needs: delete only on its backoff rows, and only INSERT on the request queue', () => {
    const { tables } = workerProfile('youtube.live.playlist');
    expect(tables).toEqual({
      urt_channel: ['SELECT'], urt_video: ['INSERT', 'SELECT', 'UPDATE'], urt_video_schedule: ['INSERT', 'SELECT', 'UPDATE'], urt_video_live: ['INSERT', 'SELECT', 'UPDATE'],
      ts_channel_admin_requests: ['INSERT', 'SELECT'], ts_youtube_item_backoff: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'], ts_job_runs: ['INSERT', 'SELECT', 'UPDATE'], ingestion_youtube_quota_daily: ['INSERT', 'SELECT', 'UPDATE'],
    });
  });
});
