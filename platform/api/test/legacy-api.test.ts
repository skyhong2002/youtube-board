import { orderedJsonValues, int, numeric } from '../src/legacy/common.js';
import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import mysql from 'mysql2/promise';
import { buildApp } from '../src/app.js';
import { legacyApiPaths } from '../src/legacy/index.js';
import { channelReport } from '../src/legacy/channel.js';
import { tagReport } from '../src/legacy/tags.js';
import { phpCollections } from '../src/legacy/index.js';
import { hourly, period } from '../src/legacy/live.js';
import { DataQueryFailed, DataSourceUnavailable, type Reader } from '../src/db/client.js';
import { assertTestDatabaseUrl } from '../../shared/test-database.js';
const clock = () => new Date('2026-10-11T10:00:00Z');
const url = process.env.TEST_DATABASE_URL ? assertTestDatabaseUrl(process.env.TEST_DATABASE_URL) : undefined;
describe('legacy contracts and failure boundary', () => {
    it('preserves first-topic and PK object order across nested JSON and escaped keys', () => { expect(orderedJsonValues('{"10":{"title":"first"},"2":{"title":"second"}}')).toEqual([{ title: 'first' }, { title: 'second' }]); expect(orderedJsonValues('{"topics":{"10":{"title":"A\\\"{}"},"2":false}}', ['topics'])).toEqual([{ title: 'A"{}' }, false]); expect(orderedJsonValues('{"9":"first","2":"second","9":"updated"}')).toEqual(['updated', 'second']); expect(orderedJsonValues('bad')).toEqual([]); });
    it('rejects non-finite integer coercion and hexadecimal measurements', () => { expect(int('1e400')).toBe(0); expect(int('12abc')).toBe(12); expect(numeric('0x12')).toBe(false); expect(numeric('1.2e3')).toBe(true); });
    it('matches PHP consecutive numeric map JSON shapes', () => { expect(phpCollections({ '0': { '0': 'x', '1': 'y' }, '1': {} })).toEqual([['x', 'y'], {}]); expect(phpCollections({ '01': 'hour', '10': 'hour' })).toEqual({ '01': 'hour', '10': 'hour' }); });
    it('retains legacy prediction precision and truncation', async () => { let count = 100000; const log: Record<string, unknown> = {}, deltas = [1, 2, 4, 8, 16, 32, 64]; for (let t = Date.parse('2026-01-01'); t <= Date.parse('2026-05-10'); t += 86400000) {
        const d = new Date(t);
        count += deltas[d.getUTCDay()]!;
        log[d.toISOString().slice(0, 10)] = { view: count, video: 100 };
    } log['2026-05-11'] = { view: count + 500, video: 100 }; let calls = 0; const reader = { rows: async () => ++calls === 1 ? [{ thedata: JSON.stringify(log) }] : [], close: async () => { } } as Reader; const r = await channelReport(reader, { u_id: '10', limit: '100' }, new Date('2026-05-13T04:00:00Z')); expect(r.result['2026-05-12']!.pred).toBe(1003); expect(r.result['2026-05-13']!.pred).toBe(2006); expect(r.result['2026-05-13']!.moving).toBe(518); });
    it('keeps malformed legacy keyword dates finite', async () => { const reader = { rows: async () => [{ pk: 1, tag: 'fixture', hours_count: 10, max_count: 10, max_hours: '0000-00-00 00:00:00' }], close: async () => { } } as Reader; const r = await tagReport(reader, 'tags_index', {}, clock()) as {
        result: Record<string, {
            weight: number;
        }>;
    }; expect(r.result.fixture!.weight).toBe(0); });
    it('registers36 unique endpoints', () => expect(new Set(legacyApiPaths).size).toBe(36));
    it('validates hourly samples and reversed periods', () => { expect(hourly('{"10:30:59":"500","10:45":700,"24:00":1000,"12:60":200,"13:00:60":400,"17:00":"1e9999","18:00":[]}')).toEqual({ '10': 700 }); expect(period({ from: '2026-10-10', to: '2026-10-09' }, clock())).toEqual({ date: '2026-10-10', from: '2026-10-09', to: '2026-10-10', is_range: true }); });
    it('preserves connection vs schema failures', async () => { for (const [error, code] of [[new DataQueryFailed('ER_BAD_FIELD_ERROR'), 500], [new DataSourceUnavailable(), 503]] as const) {
        const reader: Reader = { rows: async () => { throw error; }, close: async () => { } }, app = buildApp({ reader, clock });
        const r = await app.inject('/api/api_duration.php');
        expect(r.statusCode).toBe(code);
        await app.close();
    } });
});
describe.skipIf(!url)('MariaDB legacy contracts', () => {
    const app = buildApp({ databaseUrl: url, clock, dataset: 'fixture' });
    let db: mysql.Connection;
    const uid = 991101, pk = 991101, vid = 'LegacyApiAa1', stamp = '2026-10-11 18:00:00';
    const owned: {
        table: string;
        where: string;
        values: (string | number | null)[];
    }[] = [];
    async function insert(table: string, row: Record<string, string | number | null>, where = 'pk=?', values: (string | number | null)[] = [pk]) { await db.execute('DELETE FROM ' + table + ' WHERE ' + where, values); owned.push({ table, where, values }); await db.execute('INSERT INTO ' + table + '(' + Object.keys(row).map(k => '`' + k + '`').join(',') + ') VALUES(' + Object.keys(row).map(() => '?').join(',') + ')', Object.values(row)); }
    const get = async (path: string) => { const r = await app.inject('/api/' + path); expect(r.statusCode, r.body).toBe(200); return r; };
    beforeAll(async () => {
        db = await mysql.createConnection(url!);
        await insert('urt_channel', { u_id: uid, ctime: stamp, mtime: stamp, title: 'Legacy synthetic', youtube_id: 'UCLegacySynthetic', viewCount: 123 }, 'u_id=?', [uid]);
        await insert('urt_count', { u_id: uid, ctime: stamp, tags: '[991101][13]' }, 'u_id=?', [uid]);
        await insert('urt_tag', { tag_id: uid, tag_name: 'Legacy synthetic tag', ctime: stamp }, 'tag_id=?', [uid]);
        for (const [id, title, views] of [[vid, '合成長詞 短詞', 700], ['LegacyApiaa1', '合成短詞', 70]] as const) {
            await insert('urt_video', { ctime: stamp, u_id: uid, id, publishedAt: stamp, channelId: 'UCLegacySynthetic', title, thumbnails: '', channelTitle: 'Legacy synthetic', playlistId: 'PLSynthetic', position: 0, videoId: id, description: '合成描述', viewCount: views }, 'videoId=?', [id]);
            await insert('urt_video_duration', { ctime: stamp, videoId: id, duration: views }, 'videoId=?', [id]);
        }
        await insert('urt_comment', { ctime: stamp, videoId: vid, comments_json: '{"comment":"complete"}', authors_json: '[]', pageToken: null }, 'videoId=?', [vid]);
        await insert('urt_comment', { ctime: stamp, videoId: 'LegacyApiaa1', comments_json: '["unfinished"]', pageToken: 'next' }, 'videoId=?', ['LegacyApiaa1']);
        await insert('urt_video_live', { ctime: stamp, mtime: stamp, publishedAt: stamp, videoId: vid, u_id: uid, concurrentViewers: 1234 }, 'videoId=?', [vid]);
        await insert('urt_video_live_log', { pk, ctime: stamp, videoId: vid, u_id: uid, the_date: '2026-10-11', max_current: 700, log_json: '{"10:00":300,"10:30":500,"11:00":700,"99:00":9999}' });
        await insert('urt_video_live_log', { pk: pk + 1, ctime: stamp, videoId: 'LegacyApiaa1', u_id: uid, the_date: '2026-10-11', max_current: 70, log_json: '{"11:00":70}' }, 'pk=?', [pk + 1]);
        await insert('urt_show_live_date', { pk, ctime: stamp, the_date: '2026-10-10', return_json: '{"result":{"video":[{"videoId":"historical"}]}}' });
        await insert('urt_log', { pk, u_id: uid, ctime: stamp, themonth: '2026-10-01', thedata: '{"2026-10-08":{"view":100,"video":1},"2026-10-09":{"view":200,"video":2},"2026-10-10":{"view":500,"video":3},"2026-10-11":{"view":450,"video":2}}' });
        await insert('urt_show_photo', { pk, ctime: stamp, tag: '合成照片legacy', image_url: 'https://example.test/synthetic.jpg' });
        await insert('tags', { pk, tag: '合成長詞', ctime: stamp, mtime: stamp, max_count: 10, hours_count: 20, max_hours: '2026-10-10 18:00:00' });
        await insert('urt_show_cloud', { pk, ctime: stamp, mtime: stamp, u_id: uid, days: 30, keywords_json: '{"keywords":[{"word":"合成","weight":4}]}' });
        await insert('urt_show_tag_cloud', { pk, ctime: stamp, days: 3, tagid: String(uid), tags_count: 2, tags_result: '{"tags_result":[{"tag":"合成","count":9}]}' });
        await insert('urt_show_tag_date', { pk, ctime: stamp, tagid: String(uid), the_date: '2026-10-11', tags_count: 2, tags_result: '{"合成":9}', tags_views: '{"合成":100}', tags_video: '{"合成":2}', total_views: 100, count_videos: 2 });
        await insert('urt_show_tag_month', { pk, ctime: stamp, tag: '合成legacy', tagid: String(uid), the_month: '2026-10-01', tags_result: '{"daily":[{"date":"2026-10-11","views":10}]}' });
        await insert('urt_show_tag_cloud_tag', { pk, ctime: stamp, tag: '合成legacy', days: 3, tagid: String(uid), tags_result: '{"tags":{"合成":2}}', videos_json: '{"videos":{"LegacyApiAa1":2}}' });
        await insert('urt_show_tag_date', { pk: pk + 2, ctime: stamp, tagid: '13', the_date: '2026-10-11', tags_views: '{"合成":100}', tags_video: '{"合成":2}', total_views: 100, count_videos: 2 }, 'pk=?', [pk + 2]);
        await insert('urt_show_tag_date', { pk: pk + 3, ctime: stamp, tagid: '13', the_date: '2026-10-09', tags_views: '{" 合成 ":50,"bad":"12abc","__proto__":99}', tags_video: '{}', total_views: 50, count_videos: 1 }, 'pk=?', [pk + 3]);
        await insert('urt_show_group', { pk, ctime: stamp, the_group: 'Legacy fixture group', the_view: 'people', the_result: '{"result":{"cached":true}}' });
        await insert('urt_ai_date', { pk, ctime: stamp, date_from: '2026-10-11 00:00:00', date_to: '2026-10-11 23:59:59', ai_type: 'fixture', data_type: 'oneday', condition_type: 'legacy', user_token: 'synthetic', channel_id: JSON.stringify({ [uid]: '合成媒體' }), result_json: '{"topics":[{"title":"合成事件","media_events":{"合成媒體":["A","B"]}}]}', data_json: '{"合成事件":{"影片數":99}}', video_json: '{"LegacyApiAa1":{}}' });
        await insert('urt_channel_ai', { pk, ctime: stamp, u_id: uid, date_from: '2026-10-11 00:00:00', date_to: '2026-10-11 23:59:59', ai_type: 'fixture', data_type: 'oneday', user_token: 'synthetic', result_json: '{"source":"synthetic"}' });
        await insert('urt_ai_period', { pk, ctime: stamp, date_from: '2026-10-10', date_to: '2026-10-11', ai_type: 'fixture', data_type: 'period', user_token: 'synthetic', condition_type: 'legacy', result_json: '[{"2026-10-10":["合成前日"],"2026-10-11":["合成事件"]}]', data_json: JSON.stringify([String(pk), String(pk - 1)]) });
    });
    afterAll(async () => { await app.close(); if (db) {
        for (const o of owned.reverse())
            await db.execute('DELETE FROM ' + o.table + ' WHERE ' + o.where, o.values);
        await db.end();
    } });
    it.each(legacyApiPaths)('serves %s using real schema', async (path) => { const r = await app.inject(path + '?pk=991101&u_id=991101&uid=991101&tagid=991101&date=2026-10-11&condition=legacy&videoId=LegacyApiAa1'); expect(r.statusCode, r.body).toBe(200); });
    it('keeps plain text, byte-exact IDs and CORS', async () => { const a = await get('api_duration.php?videoId=' + vid), b = await get('api_duration.php?videoId=LegacyApiaa1'); expect(a.body).toBe('700'); expect(b.body).toBe('70'); expect(a.headers['content-type']).toContain('text/plain'); expect(a.headers['access-control-allow-origin']).toBe('*'); expect((await get('api_get_photo.php?tag=合成照片legacy')).body).toBe('https://example.test/synthetic.jpg'); });
    it('preserves historical fallback and force bypass', async () => { expect((await get('api_live_day.php?videoId=' + vid + '&date=2026-10-11')).json().result['2026-10-11']['10:30']).toBe(500); const h = (await get('api_live_date.php?date=2026-10-10')).json(); expect(h.meta.cache_role).toBe('imported_historical_fallback'); expect(h.result.video[0].videoId).toBe('historical'); expect((await get('api_live_date.php?date=2026-10-10&force=1')).json().result.video).toEqual([]); });
    it('returns valid hourly peaks and classification totals', async () => { const h = (await get('api_live_hour.php?date=2026-10-11')).json(); expect(h.result['2026-10-11 10'][vid]).toBe(500); expect(h.result['2026-10-11 99']).toBeUndefined(); expect((await get('api_live_date.php?date=2026-10-11')).json().result.tag.max['991101']).toBe(770); });
    it('serves numeric HTML and quoted CSV with safe filenames', async () => { const h = await get('video_live.php?videoId=' + vid + '&date=2026-10-11'); expect(h.body).toContain('目前：1,234 人'); expect(h.body).toContain('var myvalues = [300,500,700,9999]'); expect((await get('csv_live_line.php?videoId=' + vid + '&limit=1')).body).toBe('"2026-10-11 10:00:00",500\n"2026-10-11 11:00:00",700\n'); expect((await get('csv_live_line.php?videoId=x%3Bfilename%3Devil&limit=1')).headers['content-disposition']).toBe('attachment;filename=xfilenameevil.csv'); });
    it('returns bare taxonomy and weighted literal keyword counts', async () => { expect((await get('api_tag.php')).json()['991101']).toBe('Legacy synthetic tag'); expect((await get('tags_list.php')).json().result['991101']).toBe('Legacy synthetic tag'); expect((await get('video_tags.php?videoId=' + vid)).json().result['合成長詞']).toBe(2); expect((await get('video_tags_title.php?videoId=' + vid)).json().result['合成長詞']).toBe(1); });
    it('filters categories and hides incomplete comments', async () => { const r = (await get('channels_videos.php?tagid=991101&comments=1&min=0')).json(); expect(r.count_videos).toBe(2); expect(r.comments_count).toBe(1); expect(r.result.find((r: {
        videoId: string;
    }) => r.videoId === 'LegacyApiaa1').comments.result).toEqual([]); expect((await get('channels_list.php?tagid=991101&not=13')).json().result).toEqual([]); expect((await get('api_comment.php?videoId=LegacyApiaa1')).json().meta.available).toBe(false); });
    it('unwraps cloud and date/month caches and PHP array queries', async () => { expect((await get('cloud.php?uid=991101')).json().result).toEqual({ '合成': 4 }); expect((await get('tags_day.php?tagid[]=991101')).json().result).toEqual({ '合成': 9 }); const d = (await get('cloud_tag_date.php?tagid=991101&date=2026-10-11&type=all')).json(); expect(d.tags_views).toEqual({ '合成': 100 }); expect(d.tags_video).toEqual({ '合成': 2 }); expect((await get('tag_month.php?tagid=991101&tag=合成legacy')).json().result).toEqual({ '2026-10-11': { views: 10 } }); expect((await get('tag_tags_days.php?tagid=991101&tag=合成legacy')).json().videos).toEqual({ LegacyApiAa1: 2 }); });
    it('computes signed deltas and aggregates classification history', async () => { const r = (await get('api_channel_log.php?u_id=991101&limit=2')).json(); expect(r.result['2026-10-11']).toMatchObject({ videos: -1, orig: -50 }); expect(r.result['2026-10-10'].pred).toBe(300); expect((await get('channel_pred.php?u_id=991101&limit=2')).json().summary.views_pred_week).toBeGreaterThanOrEqual(300); expect((await get('api_tag_log.php?tagid=991101&limit=2')).json().result['2026-10-11'].orig).toBe(-50); });
    it('derives current group matrices before imported historical fallback', async () => { const r = (await get('group_view.php?tags=合成&view=people&days=2')).json(); expect(r.meta.source).toContain('derived'); expect(r.result.group_data[1]['2026-10-11']).toEqual({ count_videos: 2, total_views: 100 }); expect(r.result.data_array[0]['1']['2026-10-11']).toEqual({ tags_views: 100, tags_video: 2 }); expect(Object.keys(r.result.data_array[0]['1'])).toEqual(['2026-10-11', '2026-10-09']); expect(r.result.data_array[0]['1']['2026-10-09']).toEqual({ tags_views: 50 }); const fallback=(await get('group_view.php?group=Legacy%20fixture%20group&view=people')).json();expect(fallback.result).toEqual({cached:true});expect(fallback.meta.cache_role).toBe('imported_historical_fallback');const current=(await get('group_view.php?group=Legacy%20fixture%20group&view=people&tags=合成&days=2')).json();expect(current.result.cached).toBeUndefined();expect(current.meta.source).toContain('derived'); });
    it('pins daily AI channel sources to the published immutable snapshot', async () => { const run = 'd'.repeat(64); const input = { plan: { table: 'urt_ai_date', key: { date_from: '2026-10-11 00:00:00', date_to: '2026-10-11 23:59:59', data_type: 'oneday', condition_type: 'legacy', user_token: 'synthetic' }, source: [{ pk: String(pk), u_id: uid, title: '合成媒體', events: [{ 事件: '固定來源', videoId: ['ABCDEFGHIJ1'] }] }] } }; await db.execute('DELETE FROM ts_ai_runs WHERE run_id=?', [run]); try {
        await db.execute("INSERT INTO ts_ai_runs(run_id,workflow,business_key_sha256,input_sha256,input_json,status,result_json,target_pk,created_at,updated_at) SELECT ?, 'ai.daily', ?, ?, ?, 'published', result_json, pk, ?, ? FROM urt_ai_date WHERE pk=?", [run, 'd'.repeat(64), 'e'.repeat(64), JSON.stringify(input), stamp, stamp, pk]);
        let r = (await get('ai_day.php?pk=' + pk)).json();
        expect(r.channel[String(uid)]).toEqual([{ 事件: '固定來源', videoId: ['ABCDEFGHIJ1'] }]);
        expect(r.meta.lineage.state).toBe('immutable-snapshot');
        await db.execute('UPDATE ts_ai_runs SET input_json=? WHERE run_id=?', ['{}', run]);
        r = (await get('ai_day.php?pk=' + pk)).json();
        expect(r.channel).toEqual([]);
        expect(r.channel_id).toEqual([]);
        expect(r.meta.source).not.toContain('immutable');
        expect(r.meta.projection_complete).toBe(false);
        expect(r.meta.blocked_reason).toBeTruthy();
        expect(r.meta.lineage.state).toBe('snapshot-unavailable');
    }
    finally {
        await db.execute('DELETE FROM ts_ai_runs WHERE run_id=?', [run]);
    } });
    it('retains AI cached/forced forms and traces previous event chain', async () => { expect((await get('ai_day.php?pk=991101')).json().channel['991101']).toEqual({ source: 'synthetic' }); expect((await get('api_topic.php?pk=991101')).json().result.topic['合成事件']['影片數']).toBe(99); expect((await get('api_topic.php?pk=991101&force=1')).json().result.topic['合成事件']['影片數']).toBe(2); const e = (await get('api_event.php?pk=991101&prefetch=')).json(); expect(e.result.match['2026-10-10']).toEqual(['合成前日']); expect(e.result.pk['2026-10-10']).toBe(String(pk - 1)); expect(e.result.keyword).toEqual({ date: {}, meta: {} }); });
});
