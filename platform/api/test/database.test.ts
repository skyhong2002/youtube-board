import {createHash} from 'node:crypto';
import { assertTestDatabaseUrl } from '../../shared/test-database.js';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import mysql from 'mysql2/promise';
import { sql } from 'drizzle-orm';
import { createReader } from '../src/db/client.js';
import { videoTextDigest } from '../src/reports/video-digest.js';
import { sourceTextFingerprint } from '../../shared/video-fingerprint.js';
import { buildApp } from '../src/app.js';
import { seedFixture } from './fixture.js';
import { seedExtendedFixture } from './extended-fixture.js';
const url = process.env.TEST_DATABASE_URL ? assertTestDatabaseUrl(process.env.TEST_DATABASE_URL) : undefined, clock = () => new Date('2026-10-11T10:00:00Z');
describe.skipIf(!url)('isolated MariaDB synthetic fixtures', () => {
    const app = buildApp({ databaseUrl: url, dataset: 'fixture', clock });
    let cleanEvidence: (() => Promise<void>) | undefined;
    beforeAll(async () => { await seedFixture(url!, clock()); await seedExtendedFixture(url!); cleanEvidence = await seedEvidence(url!); });
    afterAll(async () => { await app.close(); await cleanEvidence?.(); });
    it('never labels synthetic vocabulary as live', async () => {
        for (const path of ['/api/v1/vocabulary', '/api/v1/keywords']) {
            const r = await app.inject(path);
            expect(r.statusCode).toBe(200);
            expect(r.json().meta.dataset).toBe('fixture');
            expect(r.json().meta.warnings.join(' ')).toContain('合成');
        }
    });
    it('video list applies legacy sort/min/hours before pagination and preserves empty browser controls', async () => {
        const r = await app.inject('/api/v1/videos?channelId=990001&column=viewCount&min=150&hours=24&limit=1');
        expect(r.statusCode).toBe(200); expect(r.json().data.total).toBe(1); expect(r.json().data.rows[0].id).toBe('FixtureAa01');
        const empty = await app.inject('/api/v1/videos?channelId=&hours=&min=&from=&to=&column=');
        expect(empty.statusCode).toBe(200); expect(empty.json().data.total).toBeGreaterThanOrEqual(4);
        const past = await app.inject('/api/v1/videos?channelId=990001&to=2026-10-10&hours=24');
        expect(past.statusCode).toBe(200); expect(past.json().data.total).toBe(0);
        const onlyDate = await app.inject('/api/v1/videos?channelId=990001&to=2026-10-10'); expect(onlyDate.statusCode).toBe(200); expect(onlyDate.json().data.total).toBe(0);
        for (const query of ['column=invalid','hours=0','hours=8761','min=-1','channelId=abc','from=2026-10-11&to=2026-10-10']) expect((await app.inject('/api/v1/videos?'+query)).statusCode).toBe(400);
    });
    it('keeps case-distinct IDs and actual measurements', async () => { const a = await app.inject('/api/v1/videos/FixtureAa01'), b = await app.inject('/api/v1/videos/Fixtureaa01'); expect(a.statusCode).toBe(200); expect(b.statusCode).toBe(200); expect(a.json().data.video.views).toBe(200); expect(b.json().data.video.views).toBe(100); expect(a.json().data.captionAvailable).toBe(false); expect(a.json().data.history[0].measured).toBe(true); });
    it('excludes stale live observations and uses source titles when cache missing', async () => {
        const r = await app.inject('/api/v1/live/current?q=合成');
        expect(r.statusCode).toBe(200);
        const rows = r.json().data.rows;
        expect(rows.map((r: {
            id: string;
        }) => r.id)).toEqual(['FixtureLive']);
        expect(rows[0].todayPeak).toBe(400);
        expect(rows[0].title).toBe('合成：交通現場直播');
        expect(rows[0].trend.length).toBe(2);
    });
    it('paginates selected channels and escapes search wildcards', async () => { const r = await app.inject('/api/v1/videos?channelIds=990001,990002&limit=2&offset=1'); expect(r.statusCode).toBe(200); expect(r.json().data.total).toBe(4); expect(r.json().data.rows.length).toBe(2); const s = await app.inject('/api/v1/channels?q=%25'); expect(s.statusCode).toBe(200); expect(s.json().data.rows).toEqual([]); });
    it('AI evidence has complete refs and source ids', async () => { const r = await app.inject('/api/v1/ai/days?pk=990001'); expect(r.statusCode).toBe(200); const d = r.json().data; expect(d.rawVideoRows).toBe(4); expect(d.sourceChannels).toBe(2); expect(d.rows[0].videoCount).toBe(3); expect(d.rows[0].evidence[0].source.id).toBe(990001); expect(Date.parse(r.json().meta.updatedAt)).toBe(Date.parse('2026-10-11T10:00:00.000Z')); });
    it('daily-backed event does not require separate generated analysis', async () => { const r = await app.inject('/api/v1/ai/events/990001?event=' + encodeURIComponent('合成：城市交通議題')); expect(r.statusCode).toBe(200); expect(r.json().data.videos.length).toBe(3); });
    it('category aggregate computes median and totals', async () => {
        const r = await app.inject('/api/v1/tags?min=0');
        expect(r.statusCode).toBe(200);
        const tag = r.json().data.rows.find((r: {
            id: number;
        }) => r.id === 990001);
        expect(tag.channels).toBe(2);
        expect(tag.weeklyViews).toBe(1500);
        expect(tag.median).toBe(750);
    });
    it('cloud subtracts a normalized long-period baseline', async () => { const r = await app.inject('/api/v1/channels/990001/cloud?days=7'); expect(r.statusCode).toBe(200); expect(r.json().data.rows).toHaveLength(1); expect(r.json().data.rows[0].term).toBe('交通'); expect(r.json().data.rows[0].score).toBeCloseTo(48.387, 3); });
    it('channel history preserves missing observations instead of inventing zero growth', async () => { const r = await app.inject('/api/v1/channels/990001/trends?from=2026-10-09&to=2026-10-11'); expect(r.statusCode).toBe(200); expect(r.json().data.rows[1].views).toBeNull(); expect(r.json().data.rows[2].viewChange).toBeNull(); expect(r.json().data.updatedAt).toBe('2026-10-11T10:00:00.000Z'); expect(r.json().data.rows[0].views).toBe(100); });
    it('comments publish only completed batches', async () => { const r = await app.inject('/api/v1/channels/990001/comments?hours=24&min=0'); expect(r.statusCode).toBe(200); expect(r.json().data.rows[0].videoCount).toBe(1); });
    it('tag rolling trends show source-day coverage and correct totals', async () => { const r = await app.inject('/api/v1/tags/990001/trends?from=2026-10-10&to=2026-10-11'); expect(r.statusCode).toBe(200); expect(r.json().data.rows[1]).toMatchObject({ observedDays: 2, views: 400, videos: 5 }); });
    it('live hourly aggregate uses each video peak, not sum of polling samples', async () => { const r = await app.inject('/api/v1/live/hours?from=2026-10-11&to=2026-10-11'); expect(r.statusCode).toBe(200); expect(r.json().data.rows.find((row:any)=>row.hour==='17')['2026-10-11']).toBe(400); expect(r.json().data.sections[0].rows[0].videos).toBe(1); });
    it('new table routes list their actual registrations', async () => { const r = await app.inject('/api/v1/status'); expect(r.json().data.routes).toContain('/api/v1/live/hours'); expect(r.json().data.routes).toContain('/api/v1/channels/:id/cloud'); });
    it('group definitions expose scope and empty observed metrics remain null', async () => { const r = await app.inject('/api/v1/groups/media/ranking'); expect(r.statusCode).toBe(200); expect(r.json().data.rows).toHaveLength(7); expect(r.json().data.rows[0].views).toBeNull(); expect(r.json().data.rows[0].observedDays).toBe(0); });
    it('mayor observations distinguish missing data from zero and disclose historical configuration', async () => { const r = await app.inject('/api/v1/mayor/cities/taipei?from=2026-10-11&to=2026-10-11'); expect(r.statusCode).toBe(200); expect(r.json().data.rows[0]['蔣萬安']).toBeNull(); expect(r.json().data.notes.join(' ')).toContain('2026-10-16'); });
    it('tag path intersects additional required tags instead of dropping filters', async () => { const r = await app.inject('/api/v1/tags/990001/channels?tagid=990099'); expect(r.statusCode).toBe(200); expect(r.json().data.total).toBe(0); });
    it('future video scheduling time never becomes data freshness', async () => {
        const r = await app.inject('/api/v1/videos/FixtureAa01');
        expect(r.statusCode).toBe(200);
        expect(r.json().data.video.updatedAt).toBe('2026-10-11T10:00:00.000Z');
        expect(Date.parse(r.json().meta.updatedAt)).toBe(Date.parse('2026-10-11T10:00:00.000Z'));
    });
    it('flag_del zero channels remain available through profile and list', async () => {
        const r = await app.inject('/api/v1/channels/990002');
        expect(r.statusCode).toBe(200);
        expect(r.json().data.channel.id).toBe(990002);
    });
    it('channel AI and people honor selected date with both boundaries', async () => {
        for (const path of ['ai', 'ai/days']) {
            const r = await app.inject('/api/v1/channels/990001/' + path + '?date=2026-10-10&days=1');
            expect(r.statusCode).toBe(200);
            expect(r.json().data.rows.map((v: any) => v.title)).toEqual(['前日合成事件']);
        }
        const r = await app.inject('/api/v1/channels/990001/people?date=2026-10-10&days=1');
        expect(r.json().data.rows[0].name).toBe('前日人物');
        expect((await app.inject('/api/v1/channels/990001/ai?date=garbage')).statusCode).toBe(400);
    });
    it('empty event name resolves direct event id, whitespace is not a daily title', async () => {
        for (const suffix of ['?event=', '?event=%20%20']) {
            const r = await app.inject('/api/v1/ai/events/990001' + suffix);
            expect(r.statusCode).toBe(200);
            expect(r.json().data.title).toBe('合成：城市交通議題');
        }
        expect((await app.inject('/api/v1/ai/days/990001/events?event=%20')).statusCode).toBe(400);
    });
    it('MariaDB compact JSON digest equals worker fingerprint for Unicode and escapes', async () => {
        const reader = createReader(url);
        try {
            for (const [title, description] of [['台灣😀🚇', '新聞🎉'], ['"quoted"\\slash', 'new\nline\ttab\rreturn\bback\fform'], ['İéé', 'é'], ['', ''], ['control\u0001', 'slash/與\u2028separator']]) {
                const r = await reader.rows(sql `SELECT ${videoTextDigest()} AS digest FROM (SELECT ${title} AS title,${description} AS description) v`);
                expect(r[0]?.digest).toBe(sourceTextFingerprint(title!, description!));
            }
        }
        finally {
            await reader.close();
        }
    });
    it('keyword count and pagination validate source identity and text, independent of stats time', async () => {
        const r = await app.inject('/api/v1/keywords/' + encodeURIComponent('交通') + '/videos?from=2026-10-01&channelIds=990001,990002&limit=1');
        expect(r.statusCode).toBe(200);
        expect(r.json().data.total).toBe(1);
        expect(r.json().data.rows.map((v: any) => v.id)).toEqual(['FixtureAa01']);
        expect(r.json().meta.coverage).toMatchObject({ vocabularyVersion: 'api-test-v1', sourceVideos: 4, freshVideos: 1, staleVideos: 2, unprocessedVideos: 1, keywordMatchedVideos: 1 });
        const page = await app.inject('/api/v1/keywords/' + encodeURIComponent('交通') + '/videos?from=2026-10-01&channelIds=990001,990002&limit=1&offset=1');
        expect(page.json().data.rows).toEqual([]);
        expect(page.json().data.total).toBe(1);
    });
    it('full vocabulary search folds case just as window vocabulary does', async () => {
        const r = await app.inject('/api/v1/vocabulary?q=opus');
        expect(r.statusCode).toBe(200);
        expect(r.json().data.rows[0].term).toBe('Opus新聞');
    });
    it('maintained keyword identity keeps trailing spaces distinct on list and keyword routes', async () => {
        for (const keyword of ['交通', '交通 ']) {
            const paths = [
                '/api/v1/videos?' + new URLSearchParams({ keyword, channelIds: '990001,990002' }),
                '/api/v1/keywords/' + encodeURIComponent(keyword) + '/videos?channelIds=990001,990002',
            ];
            for (const path of paths) {
                const r = await app.inject(path);
                expect(r.statusCode).toBe(200);
                expect(r.json().data.total).toBe(keyword === '交通' ? 1 : 0);
            }
        }
    });
    it('video evidence rejects matching text attached to another source row', async () => {
        const r = await app.inject('/api/v1/videos/FixtureLive/tags');
        expect(r.statusCode).toBe(200);
        expect(r.json().data.status).toBe('stale');
    });
    it('window and full snapshots share Unicode case folding and escaped search', async () => {
        const db = await mysql.createConnection(url!);
        const [runs] = await db.query<any[]>("SELECT snapshot FROM ts_vocabulary_runs WHERE id='api-test-v1'");
        const original = runs[0].snapshot;
        try {
            const terms = [{ key: 'c'.repeat(64), term: 'İNEWS_測試', articleCount: 1, media: [] }];
            await db.execute("INSERT INTO ts_vocabulary_terms(run_id,term_key,term,article_count,payload)VALUES('api-test-v1',?, ?,1,?)", [terms[0]!.key, terms[0]!.term, JSON.stringify(terms[0])]);
            const full = (await app.inject('/api/v1/vocabulary?q=' + encodeURIComponent('İnews_'))).json().data.rows;
            await db.execute("UPDATE ts_vocabulary_runs SET snapshot=? WHERE id='api-test-v1'", [JSON.stringify({ terms, coverage: 'observed-article-window' })]);
            const window = await app.inject('/api/v1/vocabulary?q=' + encodeURIComponent('İnews_'));
            expect(window.statusCode).toBe(200);
            expect(window.json().data.rows).toEqual(full);
            expect(full).toHaveLength(1);
        }
        finally {
            await db.execute("UPDATE ts_vocabulary_runs SET snapshot=? WHERE id='api-test-v1'", [original]);
            await db.end();
        }
    });
    it('real SQL faults are sanitized 500 and local connection refusal is 503', async () => {
        const db = createReader(url);
        const bad = buildApp({ reader: { rows: async () => db.rows(sql `SELECT missing_secret_column FROM urt_video`), close: () => db.close() } });
        const logs: string[] = [];
        const write = process.stderr.write;
        process.stderr.write = ((chunk: unknown) => { logs.push(String(chunk)); return true; }) as typeof write;
        try {
            const r = await bad.inject('/api/v1/videos');
            expect(r.statusCode).toBe(500);
            expect(r.body).not.toContain('missing_secret_column');
            expect(logs.join('')).toContain('ER_BAD_FIELD_ERROR');
            expect(logs.join('')).not.toContain('SELECT');
        }
        finally {
            process.stderr.write = write;
            await bad.close();
        }
        const refused = buildApp({ databaseUrl: 'mysql://local:local@127.0.0.1:1/local' });
        try {
            const r = await refused.inject('/api/v1/videos');
            expect(r.statusCode).toBe(503);
            expect(r.body).not.toContain('local:local');
        }
        finally {
            await refused.close();
        }
    });
});
async function seedEvidence(url: string) {
    const db = await mysql.createConnection(url);
    const [previous] = await db.query<any[]>("SELECT run_id FROM ts_vocabulary_current WHERE source='https://tag.observe.tw'");
    const previousVersion = previous[0]?.run_id !== 'api-test-v1' ? previous[0]?.run_id : null;
    try {
        await db.execute("INSERT INTO ts_vocabulary_runs(id,window_since,window_until,status,snapshot) VALUES('api-test-v1','','','published',?) ON DUPLICATE KEY UPDATE snapshot=VALUES(snapshot)", [JSON.stringify({ termsStoredSeparately: true, coverage: 'all-current-indexed-article-tags', upstreamSnapshotConsistent: true, publishedAt: '2026-10-11T00:00:00Z' })]);
        await db.execute("INSERT INTO ts_vocabulary_current(source,run_id)VALUES('https://tag.observe.tw','api-test-v1') ON DUPLICATE KEY UPDATE run_id=VALUES(run_id)");
        await db.execute("DELETE FROM ts_video_tag_matches WHERE vocabulary_version='api-test-v1'");
        const [videos] = await db.query<any[]>("SELECT pk,videoId,title,description FROM urt_video WHERE videoId IN ('FixtureAa01','Fixtureaa01','FixtureLive')");
        for (const v of videos) {
            await db.execute("INSERT INTO ts_video_tag_matches(video_id,vocabulary_version,source_pk,source_text_sha256,source_observed_at,rule_version,evidence_count)VALUES(?,'api-test-v1',?,?,'2026-10-10 00:00:00','exact-text-v1',1)", [v.videoId, v.videoId === 'FixtureLive' ? 0 : v.pk, sourceTextFingerprint(v.videoId === 'Fixtureaa01' ? 'stale title' : v.title, v.description)]);
            await db.execute("INSERT INTO ts_video_tag_evidence(video_id,vocabulary_version,term_key,term,source,field_name,start_offset,end_offset,matched_text,snippet,snippet_start,rule_version)VALUES(?,'api-test-v1',?,'交通','https://tag.observe.tw','title',0,2,'交通','交通',0,'exact-text-v1')", [v.videoId, createHash('sha256').update('https://tag.observe.tw\0交通').digest('hex')]);
        }
        const trafficKey=createHash('sha256').update('https://tag.observe.tw\0交通').digest('hex');
        await db.execute("INSERT INTO ts_vocabulary_terms(run_id,term_key,term,article_count,payload)VALUES('api-test-v1',?,'交通',1,?) ON DUPLICATE KEY UPDATE payload=VALUES(payload)",[trafficKey,JSON.stringify({key:trafficKey,term:'交通',articleCount:1,media:[]})]);
        await db.execute("INSERT INTO ts_vocabulary_terms(run_id,term_key,term,article_count,payload)VALUES('api-test-v1',?,'Opus新聞',1,?) ON DUPLICATE KEY UPDATE payload=VALUES(payload)", ['b'.repeat(64), JSON.stringify({ key: 'b'.repeat(64), term: 'Opus新聞', articleCount: 1, media: [] })]);
    }
    finally {
        await db.end();
    }
    return async () => {
        const cleanup = await mysql.createConnection(url);
        try {
            if (previousVersion)
                await cleanup.execute("UPDATE ts_vocabulary_current SET run_id=? WHERE source='https://tag.observe.tw' AND run_id='api-test-v1'", [previousVersion]);
            else
                await cleanup.execute("DELETE FROM ts_vocabulary_current WHERE source='https://tag.observe.tw' AND run_id='api-test-v1'");
            await cleanup.execute("DELETE FROM ts_video_tag_matches WHERE vocabulary_version='api-test-v1'");
            await cleanup.execute("DELETE FROM ts_vocabulary_terms WHERE run_id='api-test-v1'");
            await cleanup.execute("DELETE FROM ts_vocabulary_runs WHERE id='api-test-v1'");
        }
        finally {
            await cleanup.end();
        }
    };
}
