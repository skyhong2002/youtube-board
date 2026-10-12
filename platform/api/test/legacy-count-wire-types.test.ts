import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import type { Reader, Row } from '../src/db/client.js';
import { legacyRawCounts } from '../src/legacy/common.js';
import { registerLegacyApi } from '../src/legacy/index.js';

describe('legacy raw integer count wire types', () => {
    it.each([
        ['0', 0], ['42', 42], ['-42', -42],
        ['9007199254740991', Number.MAX_SAFE_INTEGER],
        ['-9007199254740991', Number.MIN_SAFE_INTEGER],
        ['9007199254740992', '9007199254740992'],
        ['9007199254740993', '9007199254740993'],
        ['-9007199254740992', '-9007199254740992'],
        ['9223372036854775807', '9223372036854775807'],
        [null, null], [0, 0], [-42, -42],
    ])('serializes count %s without losing its integer value', (input, expected) => {
        const normalized = legacyRawCounts({ viewCount: input }, 'urt_channel');
        expect(JSON.parse(JSON.stringify(normalized))).toEqual({ viewCount: expected });
    });

    it('only changes allowlisted top-level count columns, without mutating the row', () => {
        const row = {
            pk: '123', u_id: '456', position: '0', videoId: '00000000001',
            id: '000123', youtube_id: '00123', channelId: 'AbCdEfGhI_1',
            title: '000123', channelTitle: '987654321', description: '1e3',
            publishedAt: '2026-10-11 18:00:00', viewCount: '42', likeCount: '0',
            comments: { viewCount: '99' },
        };
        expect(legacyRawCounts(row, 'urt_video')).toEqual({ ...row, viewCount: 42, likeCount: 0 });
        expect(row.viewCount).toBe('42');
        expect(legacyRawCounts(row, 'urt_channel').likeCount).toBe('0');
        expect(legacyRawCounts({ title: '123' }, 'urt_video')).toEqual({ title: '123' });
    });

    it.each(['', ' 12 ', '1.25', '1e3', '0x10', '+12', 'Infinity'])('does not parse non-integer SQL text %j as a count', value => {
        expect(legacyRawCounts({ viewCount: value }, 'urt_video').viewCount).toBe(value);
    });

    const channel = {
        u_id: 17, youtube_id: '00000000001', title: '000123',
        viewCount: '4294967296', commentCount: '0', subscriberCount: '23', videoCount: null,
    };
    const video = {
        u_id: 17, videoId: 'AbCdEfGhI_1', id: '000123', title: '000456',
        viewCount: '4294967296', likeCount: '0', dislikeCount: '-2',
        favoriteCount: '9007199254740991', commentCount: '9007199254740993',
    };
    const cases: { path: string; responses: Row[][]; result: unknown }[] = [
        {
            path: 'channels_list.php', responses: [[{ u_id: 17 }], [channel]],
            result: [{ ...channel, viewCount: 4294967296, commentCount: 0, subscriberCount: 23 }],
        },
        {
            path: 'channel_videos.php?u_id=17', responses: [[video]],
            result: [{ ...video, viewCount: 4294967296, likeCount: 0, dislikeCount: -2, favoriteCount: Number.MAX_SAFE_INTEGER }],
        },
        {
            path: 'channels_videos.php', responses: [[{ u_id: 17 }], [video]],
            result: [{ ...video, viewCount: 4294967296, likeCount: 0, dislikeCount: -2, favoriteCount: Number.MAX_SAFE_INTEGER }],
        },
        {
            path: 'live_tvbs.php', responses: [[{ d: '2026-10-11' }], [
                { videoId: 'AbCdEfGhI_1', max_current: '123', log_json: '{"10:00":"123"}' },
                { videoId: 'abcdefghI_1', max_current: '9007199254740993', log_json: '{}' },
                { videoId: '00000000001', max_current: null, log_json: '{}' },
            ]],
            result: {
                AbCdEfGhI_1: { videoId: 'AbCdEfGhI_1', max_current: 123, log_json: '{"10:00":"123"}' },
                abcdefghI_1: { videoId: 'abcdefghI_1', max_current: '9007199254740993', log_json: '{}' },
                '00000000001': { videoId: '00000000001', max_current: null, log_json: '{}' },
            },
        },
    ];
    it.each(cases)('preserves Laravel safe-count JSON types for $path', async ({ path, responses, result }) => {
        const remaining = responses.slice();
        const reader: Reader = {
            async rows<T extends Row>() {
                const rows = remaining.shift();
                if (!rows) throw new Error('Unexpected additional query');
                return rows as T[];
            },
            async close() {},
        };
        const app = Fastify();
        registerLegacyApi(app, reader, () => new Date('2026-10-11T10:00:00Z'), 'fixture');
        try {
            const response = await app.inject('/api/' + path);
            expect(response.statusCode).toBe(200);
            expect(response.json().result).toEqual(result);
            expect(remaining).toHaveLength(0);
        } finally {
            await app.close();
        }
    });
});
