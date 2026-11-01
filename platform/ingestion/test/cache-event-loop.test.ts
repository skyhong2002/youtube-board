import { describe, expect, it, vi } from 'vitest';
import { scanVideos, type CacheContext } from '../src/report-caches.js';

// A cache builder shares the worker process with the /ready endpoint. Measure the longest stretch in which a
// setImmediate heartbeat (standing in for the probe's HTTP callback) could not run while a day of rows is matched.
async function longestStall(work: () => Promise<unknown>) {
  let running = true, last = performance.now(), longest = 0;
  const beat = () => { const at = performance.now(); longest = Math.max(longest, at - last); last = at; if (running) setImmediate(beat); };
  setImmediate(beat);
  try { await work(); } finally { running = false; }
  await new Promise(resolve => setImmediate(resolve)); // the stall that ends with the work is measured by the next beat
  return longest;
}
const busy = (ms: number) => { const end = performance.now() + ms; while (performance.now() < end); };

describe('report cache scans keep the worker responsive', () => {
  it('hands the event loop back while synchronously matching a whole day of videos', async () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ pk: i + 1, videoId: 'video' + i, u_id: 1, title: 't', description: '', viewCount: 1, publishedAt: '2032-01-01 08:00:00' }));
    const db = { query: vi.fn().mockResolvedValueOnce([[{ n: rows.length }]]).mockResolvedValueOnce([rows]) };
    const ctx = { db, now: new Date('2032-01-01T04:00:00Z'), execute: false, assertOwnership: vi.fn() } as unknown as CacheContext;
    const visited: string[] = [];
    // 20 rows × 15 ms = 300 ms of matching for the single day; without yielding the heartbeat stalls for all of it.
    const stall = await longestStall(() => scanVideos(ctx, [1], '2032-01-01 00:00:00', '2032-01-01 23:59:59', 100, row => { busy(15); visited.push(row.videoId); }));
    expect(visited).toEqual(rows.map(r => r.videoId));
    expect(stall).toBeLessThan(150);
  });
});
