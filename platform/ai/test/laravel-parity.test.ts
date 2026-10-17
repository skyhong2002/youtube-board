import { describe, it, expect } from 'vitest';
import type { Connection } from 'mysql2/promise';
import { laravelRowValid, provenanceModel, runAi } from '../src/runner.js';
import { dailyChannelOrder } from '../src/pipeline.js';
import { CHANNEL_IDS } from '../src/contracts.js';
import type { Completion, ProviderRequest } from '../src/provider.js';

// Laravel parity for the scheduled AI jobs (batches 4–6 of the scheduler handoff).
const topic = (title: string, media = 2, events = 1) => ({ 標題: title, 媒體事件: Object.fromEntries(Array.from({ length: media }, (_, i) => [`媒體${i}`, Array.from({ length: events }, (_, j) => `事件${i}-${j}`)])) });

describe('missing-only validity of rows without a TS journal (Laravel validDailyRow / validChannelRow)', () => {
  it('requires 5–40 valid all topics and 3–25 for other conditions, each with 2–6 media and one event per media', () => {
    const five = ['a', 'b', 'c', 'd', 'e'].map(t => topic(t));
    expect(laravelRowValid('daily', 'all', five)).toBe(true);
    expect(laravelRowValid('daily', 'all', five.slice(0, 4))).toBe(false);
    expect(laravelRowValid('daily', 'green', five.slice(0, 3))).toBe(true);
    expect(laravelRowValid('daily', 'all', [...five.slice(0, 4), topic('x', 7)])).toBe(false);
    expect(laravelRowValid('daily', 'all', [...five.slice(0, 4), topic('x', 2, 2)])).toBe(false);
    expect(laravelRowValid('daily', 'all', [...five.slice(0, 4), topic('x', 1)])).toBe(false);
    // Invalid items are dropped before counting, as in Laravel's generation-daily validation.
    expect(laravelRowValid('daily', 'all', [...five, topic('x', 1)])).toBe(true);
    expect(laravelRowValid('daily', 'all', { events: five })).toBe(true);
    expect(laravelRowValid('daily', 'all', Array.from({ length: 41 }, (_, i) => topic('t' + i)))).toBe(false);
  });
  it('accepts a channel row only when every event has a title and at least one video id', () => {
    expect(laravelRowValid('channel', 'all', [{ 事件: 'A', videoId: ['abcdefghijk'] }])).toBe(true);
    expect(laravelRowValid('channel', 'all', [{ 事件: 'A', videoId: ['abcdefghijk'] }, { 事件: 'B', videoId: [] }])).toBe(false);
    expect(laravelRowValid('channel', 'all', [{ 描述: 'no title', videoId: ['abcdefghijk'] }])).toBe(false);
    expect(laravelRowValid('channel', 'all', [])).toBe(false);
  });
});

describe('ai_type provenance (Laravel OpenCodeChatClient provenance_model)', () => {
  it('writes the resolved gateway model when it fits 16 characters, else the alias', () => {
    expect(provenanceModel(JSON.stringify({ model: 'gpt-5.4-mini' }), 'sky-quality')).toBe('gpt-5.4-mini');
    expect(provenanceModel(JSON.stringify({ model: 'a-very-long-model-name-2026' }), 'sky-quality')).toBe('sky-quality');
    expect(provenanceModel(null, 'sky-quality')).toBe('sky-quality');
    expect(provenanceModel('{broken', 'sky-quality')).toBe('sky-quality');
  });
});

describe('daily channel stage order (Laravel refreshChannelAi / eligibleChannelUIds)', () => {
  it('walks the hard-coded 39-channel order and caps by --channel-limit', () => {
    expect(CHANNEL_IDS).toHaveLength(39);
    expect(dailyChannelOrder([15, 76, 39, 404]).map(c => c.u_id)).toEqual([76, 404, 39, 15]);
    expect(dailyChannelOrder([15, 76, 39, 404], 2).map(c => c.u_id)).toEqual([76, 404]);
    expect(dailyChannelOrder([15, 76], 0)).toEqual([]);
    expect(dailyChannelOrder([99999, 76], 39).map(c => c.u_id)).toEqual([76]);
  });
});

describe('hourly generation against a scripted database', () => {
  const videos = [{ pk: '1', u_id: 76, videoId: 'AAAAAAAAAA1', title: '甲事件', publishedAt: '2026-10-18 02:10:00', viewCount: '10' }, { pk: '2', u_id: 404, videoId: 'AAAAAAAAAA2', title: '乙事件', publishedAt: '2026-10-18 02:20:00', viewCount: '5' }];
  const event = (title: string, id: string) => ({ 事件: title, 描述: '描述', 角度: '無法判斷', 陣營: '無法判斷', 分類: '政治', 關鍵字: [], 人物: [], 地名: [], 類型: [], videoId: [id] });
  function scripted() {
    const writes: { sql: string; params: unknown[] }[] = [];
    const db = {
      query: async (sql: string) => {
        if (sql.startsWith('SELECT COUNT(*) n FROM urt_video')) return [[{ n: '2' }]];
        if (sql.startsWith('SELECT v.pk')) return [videos];
        if (sql.startsWith('SELECT GET_LOCK')) return [[{ acquired: 1 }]];
        if (sql.startsWith('SELECT IS_USED_LOCK')) return [[{ owned: 1 }]];
        if (sql.startsWith('SELECT pk,u_id,videoId')) return [videos];
        return [[]];
      },
      execute: async (sql: string, params: unknown[]) => { writes.push({ sql, params }); return [{ insertId: 9, affectedRows: 1 }]; },
    } as unknown as Connection;
    return { db, writes };
  }
  it('asks once more after an invalid completed response and records the resolved model as ai_type', async () => {
    const { db, writes } = scripted();
    const answers = [JSON.stringify({ events: [event('甲', 'AAAAAAAAAA1')] }), JSON.stringify({ events: [event('甲', 'AAAAAAAAAA1'), event('乙', 'AAAAAAAAAA2')] })];
    let calls = 0;
    const provider = { complete: async (_p: ProviderRequest): Promise<Completion> => ({ content: answers[calls++]!, model: 'gpt-5.4', requestedModel: 'sky-quality', usage: null }) };
    const result = await runAi(db, { kind: 'hourly', from: '2026-10-18 02:00:00', to: '2026-10-18 02:59:59' }, { execute: true, assertAuthorized: () => {}, provider, modelAlias: 'sky-quality' });
    expect(result).toMatchObject({ status: 'published', targetPk: '9' });
    expect(calls).toBe(2);
    const insert = writes.find(w => w.sql.startsWith('INSERT INTO urt_ai_hour'))!;
    const columns = insert.sql.slice(insert.sql.indexOf('(') + 1, insert.sql.indexOf(')')).split(',');
    expect(insert.params[columns.indexOf('ai_type')]).toBe('gpt-5.4');
    expect(insert.params[columns.indexOf('condition_type')]).toBe('all');
    expect(insert.params[columns.indexOf('data_type')]).toBe('each');
    expect(insert.params[columns.indexOf('user_token')]).toBe('cli');
  });
  it('gives up after the second invalid response without writing the legacy row', async () => {
    const { db, writes } = scripted();
    let calls = 0;
    const provider = { complete: async (): Promise<Completion> => { calls++; return { content: '{"events":[]}', model: 'gpt-5.4', requestedModel: 'sky-quality', usage: null }; } };
    await expect(runAi(db, { kind: 'hourly', from: '2026-10-18 02:00:00', to: '2026-10-18 02:59:59' }, { execute: true, assertAuthorized: () => {}, provider, modelAlias: 'sky-quality' })).rejects.toThrow('outside contract');
    expect(calls).toBe(2);
    expect(writes.some(w => w.sql.startsWith('INSERT INTO urt_ai_hour'))).toBe(false);
  });
});
