import { describe, expect, it } from 'vitest';
import { parsePayload } from '../../shared/channel-admin.js';
import { channelAdminJob } from '../src/channel-admin.js';
import { YoutubeError } from '../src/quota.js';
import type { SourceJobContext } from '../src/video-statistics.js';
import type { PlaylistItem } from '../src/youtube.js';

const UC = 'UCabcdefghijklmnopqrstuv', V = 'dQw4w9WgXc_', source = `https://youtu.be/${V}`;
const item: PlaylistItem = { id: '', videoId: V, channelId: UC, title: '指定影片', description: '', thumbnails: 'https://i.ytimg.com/vi/x/default.jpg', publishedAt: '2026-10-26T19:00:00Z', channelTitle: '新頻道', playlistId: 'UU' + UC.slice(2), position: 0, liveBroadcastContent: 'none' };
const profile = { id: UC, title: '新頻道', description: 'd', uploads: 'UU' + UC.slice(2), publishedAt: '2020-01-02T03:04:05Z', thumbnail: null, statistics: { viewCount: 10, videoCount: 2, subscriberCount: 3, hiddenSubscriberCount: false } };
function setup(kind: string, options: { item?: PlaylistItem | null; existing?: boolean; retired?: boolean; details?: Record<string, unknown>; quota?: boolean; failPublish?: boolean } = {}) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const query = async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (sql.includes('FROM ts_channel_admin_requests')) return [[{ id: 1, kind, payload: JSON.stringify({ source, tags: [1] }) }]];
    if (sql.includes('FROM urt_tag WHERE tag_id IN')) return [[{ tag_id: 1 }]];
    if (sql.startsWith('SELECT u_id, flag_del, title FROM urt_channel')) return [options.existing ? [{ u_id: 12, flag_del: null, title: '新頻道' }] : []];
    if (sql.startsWith('INSERT INTO urt_channel')) return [{ insertId: 12 }];
    if (sql.startsWith('SELECT tags FROM urt_count')) return [[{ tags: null }]];
    if (sql.startsWith('SELECT * FROM `urt_video`')) return [options.existing ? [{ pk: 1, channelId: UC, u_id: 12 }] : []];
    if (sql.startsWith('SELECT * FROM `urt_video_live`')) return [options.retired ? [{ pk: 9, del_flag: 1 }] : []];
    if (sql.startsWith('SELECT *')) return [[]];
    if (options.failPublish && sql.startsWith('INSERT INTO `urt_video_schedule`')) throw new Error('publish failed');
    return [{}];
  };
  const ctx = { db: { query, execute: query, beginTransaction: () => query('BEGIN'), commit: () => query('COMMIT'), rollback: () => query('ROLLBACK') },
    now: new Date('2026-10-26T20:00:00Z'), execute: true, assertOwnership: async () => {}, youtube: { attemptsMade: 0,
      channelProfiles: async () => new Map([[UC, profile]]), videoUploads: async () => {
        if (options.quota) throw new YoutubeError('quota-exhausted');
        return options.item === null ? [] : [options.item ?? item];
      }, videoLiveStreamingDetails: async () => new Map(options.details ? [[V, options.details]] : []) } } as unknown as SourceJobContext;
  return { ctx, sqls: (prefix: string) => calls.filter(c => c.sql.startsWith(prefix)) };
}

describe('exact video and live requests', () => {
  it('accepts exact video forms and refuses channel identities for video actions', () => {
    for (const kind of ['add-video', 'add-live']) {
      expect(parsePayload(kind, { source: `https://youtube.com/watch?v=${V}`, tags: [1] })).toEqual({ kind, source, tags: [1] });
      expect(parsePayload(kind, { source: UC })).toBeNull();
      expect(parsePayload(kind, { source: '@abc.def' })).toBeNull();
    }
  });
  it('publishes the exact ordinary video and schedule, auto-adds its channel and tags it in the same transaction', async () => {
    const h = setup('add-video');
    expect((await channelAdminJob(h.ctx, { limit: 10 })).applied[0]?.outcome).toMatchObject({ uId: 12, videoId: V, created: true, channelCreated: true, live: false, tags: '[1]' });
    expect(h.sqls('INSERT INTO `urt_video`')).toHaveLength(1);
    expect(h.sqls('INSERT INTO `urt_video_schedule`')).toHaveLength(1);
    expect(h.sqls('INSERT INTO `urt_video_live`')).toHaveLength(0);
    expect(h.sqls('UPDATE ts_channel_admin_requests')).toHaveLength(1);
    expect(h.sqls('COMMIT')).toHaveLength(1);
  });
  it('updates an existing video without inserting a second channel or video', async () => {
    const h = setup('add-video', { existing: true });
    expect((await channelAdminJob(h.ctx, { limit: 10 })).applied[0]?.outcome).toMatchObject({ created: false, channelCreated: false });
    expect(h.sqls('INSERT INTO urt_channel')).toHaveLength(0);
    expect(h.sqls('INSERT INTO `urt_video`')).toHaveLength(0);
    expect(h.sqls('UPDATE `urt_video`')).toHaveLength(1);
  });
  it('refuses an ordinary video as a live before adding the channel or applying tags', async () => {
    const h = setup('add-live');
    expect((await channelAdminJob(h.ctx, { limit: 10 })).rejected).toEqual([{ id: 1, kind: 'add-live', code: 'VIDEO_NOT_LIVE' }]);
    expect(h.sqls('INSERT INTO urt_channel')).toHaveLength(0);
    expect(h.sqls('INSERT INTO urt_tag_log')).toHaveLength(0);
    expect(h.sqls('INSERT INTO `urt_video_live`')).toHaveLength(0);
  });
  it('tracks live and upcoming videos, and a replay with verified historical live details', async () => {
    for (const liveBroadcastContent of ['live', 'upcoming'] as const) {
      const h = setup('add-live', { item: { ...item, liveBroadcastContent } });
      expect((await channelAdminJob(h.ctx, { limit: 10 })).applied[0]?.outcome.live).toBe(true);
      expect(h.sqls('INSERT INTO `urt_video_live`')).toHaveLength(1);
    }
    const h = setup('add-live', { details: { actualStartTime: '2026-10-26T17:00:00Z', actualEndTime: '2026-10-26T18:00:00Z' } });
    expect((await channelAdminJob(h.ctx, { limit: 10 })).applied).toHaveLength(1);
    expect(h.sqls('INSERT INTO `urt_video_live`')[0]?.params).toContain('2026-10-27 01:00:00');
  });
  it('refuses retired live tracking and missing videos, and leaves quota exhaustion pending', async () => {
    const retired = setup('add-live', { retired: true });
    expect((await channelAdminJob(retired.ctx, { limit: 10 })).rejected[0]?.code).toBe('VIDEO_RETIRED');
    expect(retired.sqls('INSERT INTO urt_channel')).toHaveLength(0);
    const missing = setup('add-video', { item: null });
    expect((await channelAdminJob(missing.ctx, { limit: 10 })).rejected[0]?.code).toBe('VIDEO_NOT_FOUND');
    const quota = setup('add-video', { quota: true });
    expect(await channelAdminJob(quota.ctx, { limit: 10 })).toMatchObject({ stoppedReason: 'quota-exhausted', remaining: 1 });
    expect(quota.sqls('UPDATE ts_channel_admin_requests')).toHaveLength(0);
  });
  it('rolls back when publishing fails and records a failed request rather than reporting success', async () => {
    const h = setup('add-video', { failPublish: true });
    expect((await channelAdminJob(h.ctx, { limit: 10 })).rejected[0]?.code).toBe('APPLY_FAILED');
    expect(h.sqls('ROLLBACK')).toHaveLength(1);
    expect(h.sqls('COMMIT')).toHaveLength(0);
    expect(h.sqls('UPDATE ts_channel_admin_requests')[0]?.params[0]).toBe('failed');
  });
});
