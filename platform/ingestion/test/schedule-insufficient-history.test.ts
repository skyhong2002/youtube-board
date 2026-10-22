import { describe, expect, it, vi } from 'vitest';
import { scheduleCacheJob } from '../src/maintenance-caches.js';
import type { CacheContext } from '../src/report-caches.js';

const now = new Date('2032-01-01T02:00:00Z');
const videoId = 'fixture0001';
function fixture(history: { ctime: string; viewCount: number }[], publishedAt: string | null = '2032-01-01 09:30:00', execute = true) {
  const row = { pk: 1, videoId, publishedAt, mtime: '2032-01-01 09:45:00', stime: '2033-01-01 00:00:00' };
  const db = { query: vi.fn().mockResolvedValueOnce([[row]]).mockResolvedValueOnce([history]), execute: vi.fn().mockResolvedValue([]) };
  const assertOwnership = vi.fn().mockResolvedValue(undefined);
  return { db, row, assertOwnership, ctx: { db, now, execute, assertOwnership } as unknown as CacheContext };
}

describe('schedule reports with insufficient observation history', () => {
  it.each([0, 1089, 5963])('defers a single pre-publication sample with %i views without deriving a false growth rate', async viewCount => {
    const history = [{ ctime: '2032-01-01 09:00:00', viewCount }];
    const f = fixture(history);
    const result = await scheduleCacheJob(f.ctx, { videoId, limit: 1 });
    expect(result).toMatchObject({ applied: [videoId], skipped: [], deferred: [{ videoId, reason: 'insufficient_history', nextCheckAt: '2032-01-01 12:00:00' }] });
    expect(f.assertOwnership).toHaveBeenCalledTimes(1);
    expect(f.db.execute.mock.calls[0]).toEqual(['UPDATE `urt_video_schedule` SET `stime` = ?, `mtime` = ? WHERE `pk` <=> ?', ['2032-01-01 12:00:00', '2032-01-01 10:00:00', 1]]);
    expect(f.db.execute).toHaveBeenCalledTimes(2); // Schedule and lineage only; source history/metadata stay intact.
    expect(history).toEqual([{ ctime: '2032-01-01 09:00:00', viewCount }]);
    expect(f.row.publishedAt).toBe('2032-01-01 09:30:00');
  });

  it.each(['2032-01-01 09:00:00', null])('also defers when publication is equal to the sample or unknown (%s)', async publishedAt => {
    const f = fixture([{ ctime: '2032-01-01 09:00:00', viewCount: 50 }], publishedAt);
    expect(await scheduleCacheJob(f.ctx, { videoId, limit: 1 })).toMatchObject({ skipped: [], deferred: [{ reason: 'insufficient_history' }] });
  });

  it('reports the proposed next observation in dry-run without taking ownership or writing', async () => {
    const f = fixture([{ ctime: '2032-01-01 09:00:00', viewCount: 50 }], undefined, false);
    expect(await scheduleCacheJob(f.ctx, { videoId, limit: 1 })).toMatchObject({ mode: 'dry-run', applied: [], skipped: [], deferred: [{ nextCheckAt: '2032-01-01 12:00:00' }] });
    expect(f.assertOwnership).not.toHaveBeenCalled();
    expect(f.db.execute).not.toHaveBeenCalled();
  });

  it('resumes ordinary rate-based scheduling once two ordered observations exist', async () => {
    const f = fixture([{ ctime: '2032-01-01 09:40:00', viewCount: 5000 }, { ctime: '2032-01-01 09:00:00', viewCount: 1000 }]);
    expect(await scheduleCacheJob(f.ctx, { videoId, limit: 1 })).toMatchObject({ applied: [videoId], skipped: [], deferred: [] });
    expect(f.db.execute.mock.calls[0]?.[1]).toEqual(['2032-01-01 11:45:00', '2032-01-01 10:00:00', 1]);
  });

  it('never moves an earlier check forward on repeated report ticks, even after it becomes due', async () => {
    for (const elapsedHours of [1, 3]) {
      const f = fixture([{ ctime: '2032-01-01 09:00:00', viewCount: 50 }]);
      f.row.stime = '2032-01-01 12:00:00';
      f.ctx.now = new Date(now.getTime() + elapsedHours * 3600000);
      expect(await scheduleCacheJob(f.ctx, { videoId, limit: 1 })).toMatchObject({ deferred: [{ nextCheckAt: '2032-01-01 12:00:00' }] });
    }
  });

  it.each([
    [{ ctime: '2032-01-01 09:00:00', viewCount: 5000 }, { ctime: '2032-01-01 09:40:00', viewCount: 1000 }],
    [{ ctime: 'not-a-date', viewCount: 5000 }],
  ])('keeps invalid or reversed source history visible as a failed item', async (...history) => {
    const f = fixture(history);
    expect(await scheduleCacheJob(f.ctx, { videoId, limit: 1 })).toMatchObject({ applied: [], deferred: [], skipped: [{ videoId, reason: 'invalid_history_payload' }] });
    expect(f.db.execute.mock.calls[0]?.[1]).toEqual(['2032-01-01 10:00:00', 1]);
  });
});
