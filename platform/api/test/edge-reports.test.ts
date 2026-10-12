import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';
import { publishedTagCache } from '../src/reports/cache-lineage.js';
import type { Reader, Row } from '../src/db/client.js';
function queued(queue: Row[][]): Reader { return { rows: async <T extends Row>() => (queue.shift() ?? []) as T[], close: async () => { } }; }
describe('reviewed report edge cases', () => {
    it('unknown group/city keys cannot resolve through object prototypes', async () => { const app = buildApp({ reader: queued([]) }); for (const path of ['/groups/constructor', '/groups/__proto__/ranking', '/mayor/cities/toString'])
        expect((await app.inject('/api/v1' + path)).statusCode).toBe(404); await app.close(); });
    it('rejects invalid live dates and unsupported units instead of silently changing reports', async () => { const app = buildApp({ reader: queued([[{u_id:1,title:'Fixture',flag_del:null}]]) }); for (const path of ['/live/days/abc', '/keywords/x/days?type=tags_views', '/channels/1/cloud?days=365'])
        expect((await app.inject('/api/v1' + path)).statusCode).toBe(400); await app.close(); });
    it('never assigns anonymous comments to an author with missing identity', async () => { const app = buildApp({ reader: queued([[{ author_id: 1, ChannelId: '', DisplayName: 'Missing' }]]) }); expect((await app.inject('/api/v1/comments/authors/1')).statusCode).toBe(404); await app.close(); });
    it('author map indexes keep video keys, and replies occur exactly once', async () => { const app = buildApp({ reader: queued([[{ author_id: 1, ChannelId: 'UCauthor', DisplayName: 'Author' }], [{ index_json: JSON.stringify({ FixtureAa01: 3 }) }], [{ videoId: 'FixtureAa01', comments_json: JSON.stringify({ root: { authorChannelId: { value: 'UCauthor' }, textOriginal: 'Root', replies: [{ authorChannelId: 'UCauthor', textOriginal: 'Reply' }] } }) }]]) }); const r = await app.inject('/api/v1/comments/authors/1'); expect(r.statusCode).toBe(200); expect(r.json().data.rows).toHaveLength(2); expect(r.json().data.rows.filter((r: {
        reply: boolean;
    }) => r.reply)).toHaveLength(1); await app.close(); });
    it('does not turn unobserved live rows into zero-viewer measurements', async () => { const app = buildApp({ reader: queued([[{ videoId: 'FixtureAa01', u_id: 1, the_date: '2026-10-11', max_current: null, log_json: '{}' }]]), clock: () => new Date('2026-10-11T10:00:00Z') }); const r = await app.inject('/api/v1/live/trends/daily'); expect(r.statusCode).toBe(200); expect(r.json().data.rows.every((row:any)=>row.total===null&&row.observations===null)).toBe(true); expect(r.json().data.series.every((series:any)=>series.points.every((point:any)=>point.value===null))).toBe(true); await app.close(); });
    it('withholds unpublished or unknown-view TS cache buckets while retaining legacy buckets', async () => { const rows = [{ the_date: '2026-10-09' }, { the_date: '2026-10-10' }, { the_date: '2026-10-11' }, { the_date: '2026-10-12' }], r = await publishedTagCache(queued([[{ present: 1 }], [{ the_date: '2026-10-09', status: 'pending', unknown_view_videos: 0 }, { the_date: '2026-10-10', status: 'published', unknown_view_videos: 1 }, { the_date: '2026-10-11', status: 'published', unknown_view_videos: 0 }]]), rows, { tagid: '4,3' }); expect(r.map(r => r.the_date)).toEqual(['2026-10-11', '2026-10-12']); });
});
