import { describe, it, expect } from 'vitest';
import type { Connection } from 'mysql2/promise';
import { runDerived, derivedHash, aiFailureStage, type DerivedPlan } from '../src/derived-runner.js';
import { refreshFailure } from '../src/days-refresh.js';
import { RetryableProviderError } from '../src/provider.js';
import { aiBusinessKey, canonicalHash } from '../../shared/ai-business-key.js';

// #5: days-refresh used to collapse every non-lock, non-retry failure into
// source_generation_or_projection_failed, so durable partial_failure rows could not
// be traced to a source check, the provider, output validation or projection.
const plan: DerivedPlan = {
  workflow: 'ai.event', input: { kind: 'event' } as DerivedPlan['input'], table: 'urt_ai_event',
  key: { aipk: 1, event_name: 'topic', prompt_type: 'summary', condition_type: 'all', user_token: 'T' },
  columns: { date_from: '2026-10-01', date_to: '2026-10-01', data_type: 'oneday', channel_id: '{}' },
  source: { ok: true }, locks: ['ytb:ai:daily'], sourceCount: 1, prompt: 'p', schema: {} as DerivedPlan['schema'],
};
const runId = canonicalHash({ business: aiBusinessKey(plan.table, plan.key), inputHash: derivedHash(plan) });

function fakeDb(opts: { lockFree?: boolean; prior?: Record<string, unknown>; affectedRows?: number } = {}) {
  const db = {
    async query(sql: string) {
      if (sql.includes('GET_LOCK')) return [[{ acquired: opts.lockFree === false ? 0 : 1 }]];
      if (sql.includes('IS_USED_LOCK')) return [[{ owned: 1 }]];
      if (sql.includes('RELEASE_LOCK')) return [[{}]];
      if (sql.startsWith('SELECT * FROM ts_ai_runs')) return [opts.prior ? [opts.prior] : []];
      if (sql.startsWith('SELECT provider_json')) return [[{ provider_json: null }]];
      if (sql.startsWith('SELECT * FROM urt_ai_event')) return [[{ pk: 7 }]];
      throw new Error('unexpected query ' + sql);
    },
    async execute(sql: string) { return [{ affectedRows: sql.startsWith('UPDATE urt_ai_event') ? (opts.affectedRows ?? 1) : 1, insertId: 7 }]; },
  };
  return db as unknown as Connection;
}
const options = (complete: () => Promise<unknown>) => ({
  execute: true, assertAuthorized() {}, modelAlias: 'sky-quality',
  provider: { complete } as never, reserveCall() {},
});
const ok = async () => ({ requestedModel: 'sky-quality', model: 'm', content: '{}' });
async function failure(run: Promise<unknown>) {
  const error = await run.then(() => { throw new Error('expected failure'); }, e => e);
  return refreshFailure(error);
}

describe('days-refresh failure lineage (#5)', () => {
  it('reports pre-generation source codes as source_unavailable without a provider call', async () => {
    let calls = 0;
    const result = await failure(runDerived(fakeDb(), async () => { throw new Error('event_video_source_incomplete'); }, v => v, options(async () => { calls++; return ok(); })));
    expect(result).toEqual({ reason: 'source_unavailable', stage: 'source', sourceCode: 'event_video_source_incomplete' });
    expect(calls).toBe(0);
  });
  it('keeps lock contention and explicit retry policy distinct, with the run ID for journal lookup', async () => {
    expect(await failure(runDerived(fakeDb({ lockFree: false }), async () => plan, v => v, options(ok)))).toEqual({ reason: 'business_key_locked', stage: 'lock' });
    const prior = { run_id: runId, input_sha256: derivedHash(plan), business_key_sha256: aiBusinessKey(plan.table, plan.key), input_json: JSON.stringify({ plan }), status: 'failed', failure_code: 'generation_or_projection_failed', result_json: null, provider_json: null, updated_at: '2026-10-21 00:00:00' };
    expect(await failure(runDerived(fakeDb({ prior }), async () => plan, v => v, options(ok)))).toEqual({ reason: 'explicit_retry_required', runId });
    expect(await failure(runDerived(fakeDb({ prior: { ...prior, input_sha256: 'other' } }), async () => plan, v => v, options(ok)))).toEqual({ reason: 'journal_mismatch', stage: 'journal', runId });
  });
  it('separates provider, output validation and projection failures', async () => {
    expect(await failure(runDerived(fakeDb(), async () => plan, v => v, options(async () => { throw new Error('AI gateway HTTP 500'); })))).toEqual({ reason: 'generation_failed', stage: 'generation', runId });
    expect(await failure(runDerived(fakeDb(), async () => plan, v => v, options(async () => { throw new RetryableProviderError('AI gateway transient failure'); })))).toEqual({ reason: 'provider_transient', stage: 'generation', runId });
    expect(await failure(runDerived(fakeDb(), async () => plan, () => { throw new Error('Unknown event media'); }, options(ok)))).toEqual({ reason: 'generation_failed', stage: 'generation', runId });
    expect(await failure(runDerived(fakeDb({ affectedRows: 0 }), async () => plan, v => v, options(ok)))).toEqual({ reason: 'projection_failed', stage: 'projection', runId });
    let phase = 0;
    const drifting = async () => (++phase === 3 ? { ...plan, source: { ok: false } } : plan);
    expect(await failure(runDerived(fakeDb(), drifting, v => v, options(ok)))).toEqual({ reason: 'source_changed', runId });
  });
  it('classifies untagged errors without echoing free-form text', () => {
    expect(refreshFailure(new Error('AI call budget exhausted'))).toEqual({ reason: 'call_budget_exhausted' });
    expect(refreshFailure(new Error('topic_source_cap_exceeded'))).toEqual({ reason: 'source_unavailable', sourceCode: 'topic_source_cap_exceeded' });
    const opaque = refreshFailure(new Error('Connection to 10.0.0.5 refused for user secret'));
    expect(opaque).toEqual({ reason: 'source_generation_or_projection_failed' });
    expect(aiFailureStage(new Error('x'))).toBeUndefined();
  });
});
