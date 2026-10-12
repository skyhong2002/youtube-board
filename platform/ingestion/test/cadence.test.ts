import { it, expect, vi } from 'vitest';
import type { Connection } from 'mysql2/promise';
import { videoStatisticsJob, type SourceJobContext } from '../src/video-statistics.js';
import { livePollingJob } from '../src/live-polling.js';
import { legacyInstant } from '../src/legacy-db.js';
import { YoutubeDataApiClient } from '../src/youtube.js';
function context(row: object): SourceJobContext {
  const db = { query: vi.fn().mockResolvedValue([[row]]) } as unknown as Connection;
  const youtube = new YoutubeDataApiClient({ keys: [], ledger: { precharge: async () => { throw new Error('dry-run must not charge'); }, markDailyExhausted: async () => {} } });
  return { db, youtube, execute: false, now: new Date('2026-10-12T02:00:00Z'), assertOwnership: async () => {} };
}
it('aged small statistics batches and never-observed rows do not starve below the batching threshold', async () => {
  expect((await videoStatisticsJob(context({ videoId: 'Test1234567', mtime: '2026-10-12 07:00:00' }), { limit: 50 })).wouldCallApi).toBe(true);
  expect((await videoStatisticsJob(context({ videoId: 'Test1234567', mtime: null }), { limit: 50 })).wouldCallApi).toBe(true);
  expect((await videoStatisticsJob(context({ videoId: 'Test1234567', mtime: '2026-10-12 09:00:00' }), { limit: 50 })).wouldCallApi).toBe(false);
});
it('one old live stream is polled even when the 10-stream batch threshold is not met', async () => {
  expect((await livePollingJob(context({ videoId: 'Test1234567', mtime: '2026-10-12 09:30:00' }), { limit: 50, intervalMinutes: 11 })).wouldCallApi).toBe(true);
  expect((await livePollingJob(context({ videoId: 'Test1234567', mtime: null }), { limit: 50, intervalMinutes: 11 })).wouldCallApi).toBe(true);
});
it('legacy wall times resolve independently of host timezone and reject ambiguous Date inputs', () => {
  expect(legacyInstant('2026-10-12 10:00:00')?.toISOString()).toBe('2026-10-12T02:00:00.000Z');
  expect(() => legacyInstant(new Date())).toThrow('dateStrings');
});
it('integration test connections reject the preview and arbitrary databases', async () => {
  const { isolatedTestEnv } = await import('../../shared/test-database.js');
  expect(isolatedTestEnv({}).DB_DATABASE).toBe('youtube_board_test_rewrite');
  expect(() => isolatedTestEnv({ DB_DATABASE: 'youtube_board_rewrite' })).toThrow('isolated');
  expect(() => isolatedTestEnv({ DB_HOST: 'production.example' })).toThrow('isolated');
});
