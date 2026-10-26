import { describe, expect, it } from 'vitest';
import { ChannelAdminError, applyTagDelta, parseChannelSource, parsePayload, parseTags } from '../../shared/channel-admin.js';
import { channelAdminJob } from '../src/channel-admin.js';
import { YoutubeError } from '../src/quota.js';
import type { SourceJobContext } from '../src/video-statistics.js';

const UC = 'UCabcdefghijklmnopqrstuv';
const now = new Date('2026-10-26T20:00:00Z');

describe('channel tag strings', () => {
  it('reads the markers in stored order and ignores anything else', () => {
    expect(parseTags('[1][5][92]')).toEqual([1, 5, 92]);
    expect(parseTags('')).toEqual([]);
    expect(parseTags(null)).toEqual([]);
    expect(parseTags('[1]x[1][a][7]')).toEqual([1, 7]);
  });
  it('appends added tags and cuts removed ones like the legacy tag.php, and keeps an empty string when nothing is left', () => {
    expect(applyTagDelta('[1]', [5], [])).toMatchObject({ tags: '[1][5]', added: [5], removed: [], changed: true });
    expect(applyTagDelta('[1][5]', [], [1])).toMatchObject({ tags: '[5]', removed: [1] });
    expect(applyTagDelta('[1]', [], [1])).toMatchObject({ tags: '', removed: [1] });
    expect(applyTagDelta(null, [3], [])).toMatchObject({ tags: '[3]' });
  });
  it('reports only real changes, and a tag is never matched by a longer id', () => {
    expect(applyTagDelta('[1][5]', [5], [9])).toMatchObject({ tags: '[1][5]', added: [], removed: [], changed: false });
    expect(applyTagDelta('[12]', [1], [])).toMatchObject({ tags: '[12][1]', added: [1] });
    expect(applyTagDelta('[12]', [], [1])).toMatchObject({ tags: '[12]', changed: false });
  });
  it('refuses a result that does not fit the 100-character column', () => {
    const nearlyFull = Array.from({ length: 19 }, (_, i) => `[${100 + i}]`).join('') + '[1]';
    expect(nearlyFull.length).toBe(98);
    expect(applyTagDelta(nearlyFull, [], []).changed).toBe(false);
    expect(() => applyTagDelta(nearlyFull, [2], [])).toThrow(ChannelAdminError);
    try { applyTagDelta(nearlyFull, [2], []); } catch (error) { expect((error as ChannelAdminError).code).toBe('TAGS_TOO_LONG'); }
    // Removing in the same request makes room, so a swap on a full column still works.
    expect(applyTagDelta(nearlyFull, [2], [1])).toMatchObject({ added: [2], removed: [1] });
  });
});

describe('what an administrator may paste', () => {
  it('accepts a channel id, a /channel/ URL and an @handle in any usual form', () => {
    for (const input of [UC, ` ${UC} `, `https://www.youtube.com/channel/${UC}`, `youtube.com/channel/${UC}/videos`, `https://m.youtube.com/channel/${UC}?si=x`]) expect(parseChannelSource(input)).toBe(UC);
    for (const input of ['@abc.def', 'https://www.youtube.com/@abc.def', 'https://youtube.com/@abc.def/videos', 'youtube.com/@abc.def']) expect(parseChannelSource(input)).toBe('@abc.def');
    expect(parseChannelSource('@%E6%B2%88%E4%BC%AF%E6%B4%8B')).toBe('@沈伯洋');
  });
  it('refuses what cannot be resolved exactly or does not belong to YouTube', () => {
    for (const input of ['', 'abc', '@ab', 'https://www.youtube.com/user/foo', 'https://www.youtube.com/c/foo', `https://evil.example/channel/${UC}`, `https://user:pw@youtube.com/channel/${UC}`, 'https://www.youtube.com/watch?v=abcdefghijk', 'UCshort', 5, null]) expect(parseChannelSource(input as never)).toBeNull();
  });
});

describe('request payloads', () => {
  it('accepts well-formed requests and normalizes them', () => {
    expect(parsePayload('add-channel', { source: ` ${UC} `, tags: [1, 1, 5] })).toEqual({ kind: 'add-channel', source: UC, tags: [1, 5] });
    expect(parsePayload('add-channel', { source: '@abc.def' })).toEqual({ kind: 'add-channel', source: '@abc.def', tags: [] });
    expect(parsePayload('set-tags', { uId: 3, add: [1], remove: [2] })).toEqual({ kind: 'set-tags', uId: 3, add: [1], remove: [2] });
    expect(parsePayload('create-tag', { name: '  新  分類 ' })).toEqual({ kind: 'create-tag', name: '新 分類' });
  });
  it('rejects malformed, empty, conflicting or oversized requests', () => {
    for (const [kind, body] of [['set-tags', { uId: 3 }], ['set-tags', { uId: 3, add: [1], remove: [1] }], ['set-tags', { uId: 0, add: [1] }], ['set-tags', { uId: 3, add: ['1'] }], ['set-tags', { uId: 3, add: Array.from({ length: 21 }, (_, i) => i + 1) }],
      ['add-channel', { source: 'nope' }], ['add-channel', { source: UC, tags: [0] }], ['create-tag', { name: '' }], ['create-tag', { name: 'x'.repeat(33) }], ['create-tag', { name: 'a\u0000b' }], ['other', {}], ['set-tags', [1]], ['set-tags', null]] as const) expect(parsePayload(kind, body)).toBeNull();
  });
});

interface Call { sql: string; params: unknown[] }
function harness(handler: (sql: string, params: unknown[]) => unknown, options: { profiles?: (ids: string[]) => Promise<Map<string, unknown>>; handle?: (handle: string) => Promise<string | null>; execute?: boolean } = {}) {
  const calls: Call[] = [];
  const answer = async (sql: string, params: unknown[] = []) => { calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params }); return handler(sql, params); };
  const db = {
    query: async (sql: string, params?: unknown[]) => [await answer(sql, params)],
    execute: async (sql: string, params?: unknown[]) => [await answer(sql, params)],
    beginTransaction: async () => { calls.push({ sql: 'BEGIN', params: [] }); },
    commit: async () => { calls.push({ sql: 'COMMIT', params: [] }); },
    rollback: async () => { calls.push({ sql: 'ROLLBACK', params: [] }); },
  };
  const youtube = { attemptsMade: 0, channelProfiles: options.profiles ?? (async () => new Map()), channelIdForHandle: options.handle ?? (async () => null) };
  const ctx = { db, youtube, now, clock: () => now, execute: options.execute ?? true, assertOwnership: async () => {} } as unknown as SourceJobContext;
  const sqls = (prefix: string) => calls.filter(call => call.sql.startsWith(prefix));
  return { ctx, calls, sqls };
}
const pending = (...rows: { id: number; kind: string; payload: unknown }[]) => rows.map(row => ({ ...row, payload: typeof row.payload === 'string' ? row.payload : JSON.stringify(row.payload) }));
const profile = { id: UC, title: '新頻道', description: 'd', uploads: 'UU' + UC.slice(2), publishedAt: '2020-01-02T03:04:05Z', thumbnail: 'https://yt3.ggpht.com/a', statistics: { viewCount: 10, videoCount: 2, subscriberCount: 3, hiddenSubscriberCount: false } };

describe('channelAdminJob', () => {
  it('does nothing in a dry run beyond counting what is waiting', async () => {
    const { ctx, calls } = harness(sql => sql.includes('FROM ts_channel_admin_requests') ? pending({ id: 1, kind: 'set-tags', payload: { uId: 3, add: [1], remove: [] } }) : [], { execute: false });
    expect(await channelAdminJob(ctx, { limit: 10 })).toMatchObject({ mode: 'dry-run', selected: 1, applied: [] });
    expect(calls).toHaveLength(1);
  });

  it('adds and removes tags in one transaction, logs each effective change like the legacy site, and marks the request done', async () => {
    const { ctx, calls, sqls } = harness(sql => {
      if (sql.includes('FROM ts_channel_admin_requests')) return pending({ id: 7, kind: 'set-tags', payload: { uId: 3, add: [5], remove: [1] } });
      if (sql.startsWith('SELECT u_id FROM urt_channel')) return [{ u_id: 3 }];
      if (sql.includes('FROM urt_tag WHERE tag_id IN')) return [{ tag_id: 5 }];
      if (sql.startsWith('SELECT tags FROM urt_count')) return [{ tags: '[1][2]' }];
      return {};
    });
    const result = await channelAdminJob(ctx, { limit: 10 });
    expect(result.applied).toEqual([{ id: 7, kind: 'set-tags', outcome: { uId: 3, before: '[1][2]', after: '[2][5]', added: [5], removed: [1] } }]);
    expect(sqls('UPDATE urt_count')[0]!.params).toEqual(['[2][5]', 3]);
    expect(sqls('INSERT INTO urt_tag_log').map(call => call.params)).toEqual([['2026-10-27 04:00:00', 3, 5, 'add'], ['2026-10-27 04:00:00', 3, 1, 'del']]);
    const order = calls.map(call => call.sql.split(' ').slice(0, 3).join(' '));
    expect(order.indexOf('BEGIN')).toBeLessThan(order.indexOf('UPDATE urt_count SET'));
    expect(order.indexOf('UPDATE ts_channel_admin_requests SET')).toBeLessThan(order.indexOf('COMMIT'));
    expect(sqls('UPDATE ts_channel_admin_requests')[0]!.params.slice(0, 2)).toEqual(['done', null]);
  });

  it('writes nothing, not even a log row, when the tags already match', async () => {
    const { ctx, sqls } = harness(sql => {
      if (sql.includes('FROM ts_channel_admin_requests')) return pending({ id: 8, kind: 'set-tags', payload: { uId: 3, add: [1], remove: [9] } });
      if (sql.startsWith('SELECT u_id FROM urt_channel')) return [{ u_id: 3 }];
      if (sql.includes('FROM urt_tag WHERE tag_id IN')) return [{ tag_id: 1 }];
      if (sql.startsWith('SELECT tags FROM urt_count')) return [{ tags: '[1]' }];
      return {};
    });
    const result = await channelAdminJob(ctx, { limit: 10 });
    expect(result.applied).toHaveLength(1);
    expect(sqls('UPDATE urt_count')).toHaveLength(0);
    expect(sqls('INSERT INTO urt_tag_log')).toHaveLength(0);
  });

  it('creates the count row of a channel that has none, and reports an unchanged NULL as NULL', async () => {
    const { ctx, sqls } = harness(sql => {
      if (sql.includes('FROM ts_channel_admin_requests')) return pending({ id: 9, kind: 'set-tags', payload: { uId: 3, add: [], remove: [1] } }, { id: 10, kind: 'set-tags', payload: { uId: 4, add: [2], remove: [] } });
      if (sql.startsWith('SELECT u_id FROM urt_channel')) return [{ u_id: 1 }];
      if (sql.includes('FROM urt_tag WHERE tag_id IN')) return [{ tag_id: 2 }];
      if (sql.startsWith('SELECT tags FROM urt_count')) return [];
      return {};
    });
    const result = await channelAdminJob(ctx, { limit: 10 });
    expect(result.applied.map(item => item.outcome)).toEqual([{ uId: 3, before: null, after: null, added: [], removed: [] }, { uId: 4, before: null, after: '[2]', added: [2], removed: [] }]);
    expect(sqls('INSERT INTO urt_count')).toHaveLength(2);
  });

  it('refuses unknown channels, unknown tags and full tag columns with a reason, rolls back, and carries on with the next request', async () => {
    const full = Array.from({ length: 19 }, (_, i) => `[${100 + i}]`).join('') + '[1]';
    // The first request names an unknown channel, the second an unknown tag, the third a channel whose column is full.
    let request = 0;
    const scripted = harness(sql => {
      if (sql.includes('FROM ts_channel_admin_requests')) return pending(
        { id: 1, kind: 'set-tags', payload: { uId: 99, add: [1], remove: [] } },
        { id: 2, kind: 'set-tags', payload: { uId: 3, add: [77], remove: [] } },
        { id: 3, kind: 'set-tags', payload: { uId: 3, add: [2], remove: [] } });
      if (sql.startsWith('SELECT u_id FROM urt_channel')) { request++; return request === 1 ? [] : [{ u_id: 3 }]; }
      if (sql.includes('FROM urt_tag WHERE tag_id IN')) return request === 2 ? [] : [{ tag_id: 1 }];
      if (sql.startsWith('SELECT tags FROM urt_count')) return [{ tags: full }];
      return {};
    });
    const result = await channelAdminJob(scripted.ctx, { limit: 10 });
    expect(result.rejected.map(item => [item.id, item.code])).toEqual([[1, 'CHANNEL_NOT_FOUND'], [2, 'TAG_NOT_FOUND'], [3, 'TAGS_TOO_LONG']]);
    expect(scripted.sqls('ROLLBACK')).toHaveLength(3);
    expect(scripted.sqls('COMMIT')).toHaveLength(0);
    expect(scripted.sqls('UPDATE ts_channel_admin_requests').map(call => call.params.slice(0, 2))).toEqual([['failed', 'CHANNEL_NOT_FOUND'], ['failed', 'TAG_NOT_FOUND'], ['failed', 'TAGS_TOO_LONG']]);
    expect(scripted.sqls('UPDATE urt_count')).toHaveLength(0);
  });

  it('fails a malformed stored request without opening a transaction', async () => {
    const { ctx, sqls } = harness(sql => sql.includes('FROM ts_channel_admin_requests') ? pending({ id: 5, kind: 'set-tags', payload: '{not json' }, { id: 6, kind: 'drop-table', payload: {} }) : {});
    const result = await channelAdminJob(ctx, { limit: 10 });
    expect(result.rejected.map(item => item.code)).toEqual(['INVALID_REQUEST', 'INVALID_REQUEST']);
    expect(sqls('BEGIN')).toHaveLength(0);
  });

  it('creates a tag once and answers with the existing one when the name is already taken', async () => {
    let taken = false;
    const { ctx, sqls } = harness(sql => {
      if (sql.includes('FROM ts_channel_admin_requests')) return pending({ id: 1, kind: 'create-tag', payload: { name: '新分類' } }, { id: 2, kind: 'create-tag', payload: { name: '新分類' } });
      if (sql.startsWith('SELECT tag_id FROM urt_tag WHERE tag_name')) return taken ? [{ tag_id: 115 }] : [];
      if (sql.startsWith('INSERT INTO urt_tag ')) { taken = true; return { insertId: 115 }; }
      return {};
    });
    const result = await channelAdminJob(ctx, { limit: 10 });
    expect(result.applied.map(item => item.outcome)).toEqual([{ tagId: 115, name: '新分類', created: true }, { tagId: 115, name: '新分類', created: false }]);
    expect(sqls('INSERT INTO urt_tag ')).toHaveLength(1);
    expect(sqls('INSERT INTO urt_tag ')[0]!.params).toEqual(['2026-10-27 04:00:00', '新分類']);
  });

  it('inserts a new channel from its exact YouTube profile with empty stime/vtime, a count row and the requested tags', async () => {
    const { ctx, sqls } = harness(sql => {
      if (sql.includes('FROM ts_channel_admin_requests')) return pending({ id: 11, kind: 'add-channel', payload: { source: UC, tags: [1] } });
      if (sql.startsWith('SELECT u_id, flag_del, title FROM urt_channel')) return [];
      if (sql.startsWith('INSERT INTO urt_channel')) return { insertId: 4155 };
      if (sql.includes('FROM urt_tag WHERE tag_id IN')) return [{ tag_id: 1 }];
      if (sql.startsWith('SELECT tags FROM urt_count')) return [{ tags: null }];
      return {};
    }, { profiles: async ids => { expect(ids).toEqual([UC]); return new Map([[UC, profile]]); } });
    const result = await channelAdminJob(ctx, { limit: 10 });
    expect(result.applied[0]!.outcome).toEqual({ uId: 4155, youtubeId: UC, title: '新頻道', created: true, tags: '[1]' });
    const insert = sqls('INSERT INTO urt_channel')[0]!;
    expect(insert.sql).not.toMatch(/stime|vtime|flag_del/);
    expect(insert.params).toEqual(['2026-10-27 04:00:00', '2026-10-27 04:00:00', UC, '新頻道', 'd', '2020-01-02 11:04:05', 'https://yt3.ggpht.com/a', 'UU' + UC.slice(2), 10, 3, 2]);
    expect(sqls('INSERT INTO urt_count')[0]!.params).toEqual([4155, '2026-10-27 04:00:00', '2026-10-27 04:00:00', 10, 3, 2]);
    expect(sqls('INSERT INTO urt_tag_log')[0]!.params).toEqual(['2026-10-27 04:00:00', 4155, 1, 'add']);
    expect(sqls('COMMIT')).toHaveLength(1);
  });

  it('resolves an @handle through YouTube first, and treats an unknown handle as not found', async () => {
    const asked: string[] = [];
    const { ctx, sqls } = harness(sql => {
      if (sql.includes('FROM ts_channel_admin_requests')) return pending({ id: 1, kind: 'add-channel', payload: { source: '@abc.def' } }, { id: 2, kind: 'add-channel', payload: { source: '@nobody' } });
      if (sql.startsWith('SELECT u_id, flag_del, title FROM urt_channel')) return [];
      if (sql.startsWith('INSERT INTO urt_channel')) return { insertId: 4155 };
      return {};
    }, { handle: async handle => { asked.push(handle); return handle === '@abc.def' ? UC : null; }, profiles: async () => new Map([[UC, profile]]) });
    const result = await channelAdminJob(ctx, { limit: 10 });
    expect(asked).toEqual(['@abc.def', '@nobody']);
    expect(result.applied).toHaveLength(1);
    expect(result.rejected).toEqual([{ id: 2, kind: 'add-channel', code: 'CHANNEL_NOT_FOUND' }]);
    expect(sqls('INSERT INTO urt_channel')).toHaveLength(1);
  });

  it('only tags a channel it already tracks, and refuses a retired one', async () => {
    let rows: { u_id: number; flag_del: number | null; title: string }[] = [{ u_id: 12, flag_del: null, title: '舊頻道' }];
    const { ctx, sqls } = harness(sql => {
      if (sql.includes('FROM ts_channel_admin_requests')) return pending({ id: 1, kind: 'add-channel', payload: { source: UC, tags: [1] } });
      if (sql.startsWith('SELECT u_id, flag_del, title FROM urt_channel')) return rows;
      if (sql.includes('FROM urt_tag WHERE tag_id IN')) return [{ tag_id: 1 }];
      if (sql.startsWith('SELECT tags FROM urt_count')) return [{ tags: '' }];
      return {};
    }, { profiles: async () => { throw new Error('must not ask YouTube for a channel we already have'); } });
    expect((await channelAdminJob(ctx, { limit: 10 })).applied[0]!.outcome).toMatchObject({ uId: 12, created: false, tags: '[1]' });
    expect(sqls('INSERT INTO urt_channel')).toHaveLength(0);
    rows = [{ u_id: 12, flag_del: 1, title: '舊頻道' }];
    const retired = harness(sql => sql.includes('FROM ts_channel_admin_requests') ? pending({ id: 2, kind: 'add-channel', payload: { source: UC } }) : sql.startsWith('SELECT u_id, flag_del') ? rows : {});
    expect((await channelAdminJob(retired.ctx, { limit: 10 })).rejected).toEqual([{ id: 2, kind: 'add-channel', code: 'CHANNEL_RETIRED' }]);
  });

  it('leaves the request pending and stops when YouTube quota is exhausted, but fails it when YouTube answers badly', async () => {
    const quota = harness(sql => sql.includes('FROM ts_channel_admin_requests') ? pending({ id: 1, kind: 'add-channel', payload: { source: UC } }, { id: 2, kind: 'create-tag', payload: { name: 'x' } }) : sql.startsWith('SELECT u_id, flag_del') ? [] : {},
      { profiles: async () => { throw new YoutubeError('quota-exhausted'); } });
    expect(await channelAdminJob(quota.ctx, { limit: 10 })).toMatchObject({ stoppedReason: 'quota-exhausted', remaining: 2, applied: [], rejected: [] });
    expect(quota.sqls('UPDATE ts_channel_admin_requests')).toHaveLength(0);
    expect(quota.sqls('ROLLBACK')).toHaveLength(1);
    const bad = harness(sql => sql.includes('FROM ts_channel_admin_requests') ? pending({ id: 1, kind: 'add-channel', payload: { source: UC } }) : sql.startsWith('SELECT u_id, flag_del') ? [] : {},
      { profiles: async () => { throw new YoutubeError('transient'); } });
    expect((await channelAdminJob(bad.ctx, { limit: 10 })).rejected).toEqual([{ id: 1, kind: 'add-channel', code: 'PROVIDER_ERROR' }]);
  });

  it('marks an unexpected database error as failed and flags the run, never retrying it forever', async () => {
    const { ctx } = harness(sql => {
      if (sql.includes('FROM ts_channel_admin_requests')) return pending({ id: 1, kind: 'create-tag', payload: { name: 'x' } });
      if (sql.startsWith('SELECT tag_id FROM urt_tag WHERE tag_name')) throw new Error('boom');
      return {};
    });
    const result = await channelAdminJob(ctx, { limit: 10 });
    expect(result.rejected).toEqual([{ id: 1, kind: 'create-tag', code: 'APPLY_FAILED' }]);
    expect(result.skipped).toEqual([{ id: 1, reason: 'apply-failed' }]);
  });

  it('rejects an out-of-range batch size before touching the database', async () => {
    const { ctx, calls } = harness(() => []);
    await expect(channelAdminJob(ctx, { limit: 0 })).rejects.toThrow();
    await expect(channelAdminJob(ctx, { limit: 51 })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});
