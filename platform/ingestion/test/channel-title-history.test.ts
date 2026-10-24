import { describe, expect, it } from 'vitest';
import type { Connection } from 'mysql2/promise';
import { recordTitleChange } from '../src/channel-jobs.js';
import type { SourceJobContext } from '../src/video-statistics.js';

const now = new Date('2026-10-25T01:00:00Z');
function fake(history: { title: string }[]) {
  const inserts: unknown[][] = [];
  const db = { query: async () => [history.slice(-1)], execute: async (_sql: string, params: unknown[]) => { inserts.push(params); return [{}]; } } as unknown as Connection;
  return { inserts, ctx: { db, now } as unknown as SourceJobContext };
}
describe('channel title history', () => {
  it('stores the added name (legacy Taipei ctime as UTC) and the new name on the first rename', async () => {
    const { inserts, ctx } = fake([]);
    await recordTitleChange(ctx, { u_id: 9, title: ' 舊名 ', ctime: '2020-07-26 12:00:00' } as never, '新名');
    expect(inserts).toEqual([[9, '舊名', '2020-07-26 04:00:00', 'added'], [9, '新名', '2026-10-25 01:00:00', 'stats']]);
  });
  it('appends only the new name once history exists, and skips unchanged or already recorded names', async () => {
    const seen = fake([{ title: '舊名' }]);
    await recordTitleChange(seen.ctx, { u_id: 9, title: '舊名', ctime: '2020-07-26 12:00:00' } as never, '新名');
    expect(seen.inserts).toEqual([[9, '新名', '2026-10-25 01:00:00', 'stats']]);
    const same = fake([]);
    await recordTitleChange(same.ctx, { u_id: 9, title: '同名 ', ctime: '2020-07-26 12:00:00' } as never, '同名');
    const recorded = fake([{ title: '新名' }]);
    await recordTitleChange(recorded.ctx, { u_id: 9, title: '舊名', ctime: '2020-07-26 12:00:00' } as never, '新名');
    expect([...same.inserts, ...recorded.inserts]).toEqual([]);
  });
  it('skips the added row when the stored name is empty or ctime is unusable', async () => {
    const { inserts, ctx } = fake([]);
    await recordTitleChange(ctx, { u_id: 9, title: '', ctime: null } as never, '新名');
    expect(inserts).toEqual([[9, '新名', '2026-10-25 01:00:00', 'stats']]);
  });
});
