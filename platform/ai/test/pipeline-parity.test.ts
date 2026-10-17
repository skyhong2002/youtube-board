import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Connection } from 'mysql2/promise';

// Laravel AiDailyIngestion / AiScheduledPipelineIngestion parity for the scheduled pipelines, with the
// per-row generator mocked so only the orchestration is exercised.
const runAi = vi.fn(), existingAi = vi.fn(), cacheStep = vi.fn();
vi.mock('../src/runner.js', () => ({ runAi: (...args: unknown[]) => runAi(...args), existingAi: (...args: unknown[]) => existingAi(...args) }));
vi.mock('../src/planner.js', () => ({ planAi: async (_db: unknown, input: unknown) => ({ input }) }));
vi.mock('../src/topic-cache.js', () => ({ dailyTopicCacheStep: (...args: unknown[]) => cacheStep(...args) }));
const { runDailyPipeline } = await import('../src/pipeline.js');
const { runHourlyPipeline } = await import('../src/hourly-pipeline.js');

const db = { query: async () => [[{ u_id: 76, n: 30 }, { u_id: 404, n: 12 }]] } as unknown as Connection;
const day = { kind: 'daily' as const, from: '2026-10-17 00:00:00', to: '2026-10-17 23:59:59' };
const base = { execute: true, callLimit: 45, provider: { complete: async () => { throw new Error('mocked'); } }, modelAlias: 'sky-quality', assertAuthorized: () => {} };
type Call = [unknown, { kind: string; channelId?: number; condition?: string }, { missingOnly?: boolean }];

beforeEach(() => { runAi.mockReset(); existingAi.mockReset(); cacheStep.mockReset(); cacheStep.mockResolvedValue({ workflow: 'reports.ai_topic.build', status: 'published' }); });

describe('daily pipeline channel gate (Laravel channel_ai_incomplete)', () => {
  it('writes no daily row when a channel failed and reports every condition as failed', async () => {
    runAi.mockImplementation(async (_db: unknown, input: { kind: string; channelId?: number }) => {
      if (input.kind === 'channel' && input.channelId === 404) throw new Error('AI gateway HTTP 500');
      return { status: 'published', targetPk: '1' };
    });
    const result = await runDailyPipeline(db, day, base);
    expect((runAi.mock.calls as Call[]).map(c => c[1].kind)).toEqual(['channel', 'channel']);
    expect(result.status).toBe('partial_failure');
    const daily = (result.rows as { workflow: string; status: string; reason?: string }[]).filter(r => r.workflow === 'ai.daily');
    expect(daily).toHaveLength(6);
    expect(daily.every(r => r.status === 'failed' && r.reason === 'channel_ai_incomplete')).toBe(true);
    expect(cacheStep).not.toHaveBeenCalled();
  });

  it('missing-only keeps valid channel and daily rows and only regenerates the rest', async () => {
    runAi.mockImplementation(async (_db: unknown, input: { kind: string; channelId?: number }) => {
      if (input.kind === 'channel' && input.channelId === 404) throw new Error('AI call budget exhausted');
      return { status: 'unchanged', targetPk: '1' };
    });
    existingAi.mockImplementation(async (_db: unknown, plan: { input: { condition: string } }) => plan.input.condition === 'all' ? null : { pk: 5 });
    const result = await runDailyPipeline(db, day, { ...base, missingOnly: true });
    expect((runAi.mock.calls as Call[]).every(c => c[2].missingOnly === true)).toBe(true);
    const daily = (result.rows as { workflow: string; condition: string; status: string; reason?: string }[]).filter(r => r.workflow === 'ai.daily');
    expect(daily.find(r => r.condition === 'all')).toMatchObject({ status: 'failed', reason: 'channel_ai_incomplete' });
    expect(daily.filter(r => r.status === 'unchanged')).toHaveLength(5);
  });

  it('processes channels in the configured Laravel order and honours --channel-limit', async () => {
    runAi.mockResolvedValue({ status: 'published', targetPk: '1' });
    await runDailyPipeline(db, day, { ...base, channelLimit: 1 });
    expect((runAi.mock.calls as Call[]).filter(c => c[1].kind === 'channel').map(c => c[1].channelId)).toEqual([76]);
  });

  it('rebuilds the topic cache whenever the all row was regenerated, even in missing-only mode', async () => {
    existingAi.mockResolvedValue(null);
    runAi.mockImplementation(async (_db: unknown, input: { kind: string; condition?: string }) => ({ status: input.kind === 'daily' && input.condition === 'all' ? 'published' : 'unchanged', targetPk: '1' }));
    await runDailyPipeline(db, day, { ...base, missingOnly: true });
    expect(cacheStep.mock.calls.at(-1)![3]).toMatchObject({ missingOnly: false });
    cacheStep.mockClear();
    runAi.mockResolvedValue({ status: 'unchanged', targetPk: '1' });
    await runDailyPipeline(db, day, { ...base, missingOnly: true });
    expect(cacheStep.mock.calls.at(-1)![3]).toMatchObject({ missingOnly: true });
  });
});

describe('hourly pipeline empty hours (Laravel AiHourlyIngestion skip)', () => {
  const hour = { kind: 'hourly' as const, from: '2026-10-18 02:00:00', to: '2026-10-18 02:59:59' };
  const source = async () => ({ complete: true, details: {} });
  it('reports an hour without videos, or with a single video, as a successful skip', async () => {
    runAi.mockResolvedValueOnce({ status: 'blocked', reason: 'no_source_videos' });
    expect(await runHourlyPipeline(db, hour, { ...base, refreshSource: source })).toMatchObject({ status: 'skipped_insufficient_evidence', reason: 'no_source_videos' });
    runAi.mockResolvedValueOnce({ status: 'blocked', reason: 'insufficient_source_for_contract' });
    expect(await runHourlyPipeline(db, hour, { ...base, refreshSource: source })).toMatchObject({ status: 'skipped_insufficient_evidence' });
    runAi.mockResolvedValueOnce({ status: 'blocked', reason: 'hourly_source_cap_exceeded' });
    expect(await runHourlyPipeline(db, hour, { ...base, refreshSource: source })).toMatchObject({ status: 'blocked' });
  });
});
