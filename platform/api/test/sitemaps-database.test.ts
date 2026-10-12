import {readFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import mysql, {type Connection, type RowDataPacket} from 'mysql2/promise';
import {MySqlDialect} from 'drizzle-orm/mysql-core';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {assertTestDatabaseUrl} from '../../shared/test-database.js';
import type {Reader} from '../src/db/client.js';
import {createSitemaps} from '../src/seo/sitemaps.js';

const url = process.env.TEST_DATABASE_URL ? assertTestDatabaseUrl(process.env.TEST_DATABASE_URL) : undefined;
/** Exact checked-in DDL, isolated names and guaranteed cleanup. Real (rather than
 * TEMPORARY) tables allow MariaDB/MySQL to reopen the video table for latest-ID NOT EXISTS. */
describe.skipIf(!url)('sitemaps against isolated copies of real MariaDB source schemas', () => {
    const prefix = 'seo_' + randomBytes(5).toString('hex') + '_';
    const names = ['urt_channel', 'urt_video', 'urt_tag', 'ts_vocabulary_runs', 'ts_vocabulary_current', 'ts_vocabulary_terms', 'ts_editorial_events', 'ts_editorial_sources', 'ts_editorial_links', 'ts_editorial_audit', 'ts_editorial_audit_events'];
    const created: string[] = [];
    const replace = (statement: string) => statement.replace(new RegExp('\\b(' + names.join('|') + ')\\b', 'g'), name => prefix + name);
    const dialect = new MySqlDialect();
    let db: Connection;
    const queries: Array<{sql: string; params: unknown[]}> = [];
    const reader: Reader = {
        async rows(statement) {
            const query = dialect.sqlToQuery(statement); queries.push(query);
            const [rows] = await db.query<RowDataPacket[]>(replace(query.sql), query.params);
            return rows as never;
        },
        async close() {},
    };
    beforeAll(async () => {
        db = await mysql.createConnection({uri: url!, dateStrings: true, supportBigNumbers: true, bigNumberStrings: true, timezone: '+08:00'});
        await db.query("SET time_zone='+08:00'");
        const files = [
            new URL('../../../database/schema/legacy-dashboard-baseline.sql', import.meta.url),
            new URL('../../jobs/migrations/001_vocabulary.sql', import.meta.url),
            new URL('../../jobs/migrations/003_full_vocabulary.sql', import.meta.url),
            new URL('../../jobs/migrations/010_editorial.sql', import.meta.url),
            new URL('../../jobs/migrations/011_editorial_audit_events.sql', import.meta.url),
        ];
        const ddl = (await Promise.all(files.map(file => readFile(file, 'utf8')))).join('\n');
        for (const name of names) {
            const definition = new RegExp('CREATE TABLE IF NOT EXISTS `?' + name + '`? \\([\\s\\S]*?\\) ENGINE=[^;]+;').exec(ddl)?.[0];
            if (!definition) throw new Error('Missing checked-in sitemap schema: ' + name);
            await db.query(replace(definition)); created.push(name);
        }
        await db.query(replace('ALTER TABLE ts_editorial_events ADD INDEX editorial_merged_into(merged_into,id)'));
        await db.query(replace("INSERT INTO urt_channel(u_id,ctime,mtime,stime,flag_del,youtube_id,title) VALUES(1,'2026-10-01','2026-10-11 12:00:00','2027-10-01',0,'UCfixtureA','Active'),(2,'2026-10-01','2026-10-11',NULL,1,'UCfixtureB','Deleted'),(50001,'2026-10-01','2026-10-11',NULL,NULL,'UCfixtureC','Second range')"));
        await db.query(replace("INSERT INTO urt_tag(tag_id,ctime,mtime,tag_name,del_flag) VALUES(1,'2026-10-01','2026-10-11 12:00:00','公開分類',0),(2,'2026-10-01','2026-10-11','已刪分類',1)"));
        for (const [pk, id, title] of [[1, 'SitemapAa01', 'Public A'], [2, 'Sitemapaa01', 'Public a'], [3, 'SitemapPr01', 'Private video']] as const) {
            await db.query(replace("INSERT INTO urt_video(pk,ctime,mtime,stime,u_id,id,publishedAt,channelId,title,thumbnails,channelTitle,playlistId,position,videoId,description) VALUES(?,'2026-10-01','2026-10-11 12:00:00','2027-10-01',1,?,'2026-10-01','UCfixtureA',?,'','Fixture','fixture',0,?,'')"), [pk, id, title, id]);
        }
        await db.query(replace("INSERT INTO ts_vocabulary_runs(id,window_since,window_until,status,snapshot,published_at) VALUES('seo-full','','','published',?,'2026-10-10 18:00:00')"), [JSON.stringify({termsStoredSeparately: true})]);
        await db.query(replace("INSERT INTO ts_vocabulary_current(source,run_id) VALUES('https://tag.observe.tw','seo-full')"));
        for (const [prefix, term] of [['00', '新文易數 & AI'], ['ff', 'Other tag']]) await db.query(replace("INSERT INTO ts_vocabulary_terms(run_id,term_key,term,article_count,payload) VALUES('seo-full',?,?,1,'{}')"), [prefix + '0'.repeat(62), term]);
        await db.query(replace("INSERT INTO ts_editorial_events(id,title,version,merged_into,created_at,updated_at) VALUES('aa000000-0000-4000-8000-000000000000','Published',1,NULL,'2026-10-01','2026-10-11 12:00:00.123'),('aa000000-0000-4000-8000-000000000001','Merged',2,'aa000000-0000-4000-8000-000000000000','2026-10-01','2026-10-11')"));
    });
    afterAll(async () => {
        try { for (const name of [...created].reverse()) await db.query('DROP TABLE `' + prefix + name + '`'); }
        finally { await db?.end(); }
    });
    it('executes all six inventories on real source columns and keeps Taipei and UTC dates distinct', async () => {
        const maps = createSitemaps(reader, {now: () => Date.parse('2026-10-12T12:00:00Z'), staticLastModified: '2026-10-12T00:00:00Z'});
        expect(await maps.read()).toContain('/sitemaps/channels/2.xml');
        expect(await maps.read('static', '1')).toContain('https://youtube.observe.tw/events');
        const channels = await maps.read('channels', '1'); expect(channels).toContain('/channels/1<'); expect(channels).not.toContain('/channels/2<');
        expect(await maps.read('channels', '2')).toContain('/channels/50001<');
        const tags = await maps.read('tags', '1'); expect(tags).toContain('/tags/1/channels<'); expect(tags).not.toContain('/tags/2/channels<'); expect(tags).toContain('2026-10-11T04:00:00.000Z');
        const videos = await maps.read('videos', '1'); expect(videos).toContain('/videos/SitemapAa01<'); expect(videos).toContain('/videos/Sitemapaa01<'); expect(videos).not.toContain('SitemapPr01'); expect(videos).not.toContain('2027');
        const keywords = await maps.read('keywords', '00'); expect(keywords).toContain(encodeURIComponent('新文易數 & AI')); expect(keywords).toContain('2026-10-10T10:00:00.000Z'); expect(keywords).not.toContain('Other');
        expect(await maps.read('keywords', 'ff')).toContain('Other%20tag');
        const events = await maps.read('events', 'aa'); expect(events).toContain('/events/aa000000-0000-4000-8000-000000000000<'); expect(events).not.toContain('8000-000000000001'); expect(events).toContain('2026-10-11T12:00:00.123Z');
    });
    it('supports indexed range execution plans for each collection and constant metadata queries', async () => {
        const leaf = queries.filter(query => query.sql.includes('ORDER BY') && !query.sql.includes('ts_vocabulary_current'));
        expect(leaf.length).toBeGreaterThanOrEqual(7);
        for (const query of leaf) {
            const [plan] = await db.query<RowDataPacket[]>('EXPLAIN ' + replace(query.sql), query.params);
            expect(plan.length).toBeGreaterThan(0);
            // Tiny fixtures may choose an ALL access for two rows. The source range
            // predicates and usable keys, not optimizer cost choices, bound production reads.
            expect(plan.some(row => String(row.possible_keys ?? row.key ?? '').includes('PRIMARY') || String(row.possible_keys ?? row.key ?? '').includes('editorial_merged_into'))).toBe(true);
            if (query.sql.includes('FROM urt_video v')) {
                const inner = plan.find(row => row.table === 'newer');
                // The correlation must probe the exact video identity index, not scan
                // the inner table once for every row in the bounded outer PK range.
                expect(inner, JSON.stringify(plan)).toBeDefined();
                expect(inner!.key).toBe('videoId');
                expect(['eq_ref', 'ref', 'unique_subquery']).toContain(inner!.type);
                expect(String(inner!.ref)).toMatch(/(?:\.|^)v\.videoId$/);
                expect(Number(inner!.rows)).toBeLessThanOrEqual(1);
            }
            expect(query.params.at(-1)).toBe(50001);
            expect(query.sql).not.toContain('OFFSET');
        }
    });
    it('reads the current embedded observation pool through bounded JSON_TABLE without a full-export term table', async () => {
        await db.query(replace("INSERT INTO ts_vocabulary_runs(id,window_since,window_until,status,snapshot,published_at) VALUES('seo-window','','','published',?,'2026-10-10 18:00:00')"), [JSON.stringify({coverage: 'observed-article-window', terms: [{key: 'ab' + '0'.repeat(62), term: '觀察標籤'}, {key: 'cd' + '0'.repeat(62), term: '另一標籤'}]})]);
        await db.query(replace("UPDATE ts_vocabulary_current SET run_id='seo-window' WHERE source='https://tag.observe.tw'"));
        const maps = createSitemaps(reader, {now: () => Date.parse('2026-10-12T12:00:00Z')});
        const body = await maps.read('keywords', 'ab');
        expect(body).toContain(encodeURIComponent('觀察標籤')); expect(body).not.toContain(encodeURIComponent('另一標籤'));
        expect(body).toContain('2026-10-10T10:00:00.000Z');
        expect(queries.at(-1)!.params).toEqual(['seo-window', 'ab', 'ac', 50001]);
    });

});
