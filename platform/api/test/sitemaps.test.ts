import Fastify from 'fastify';
import {type SQL} from 'drizzle-orm';
import {MySqlDialect} from 'drizzle-orm/mysql-core';
import {describe, expect, it} from 'vitest';
import {DataQueryFailed, DataSourceUnavailable, type Reader, type Row} from '../src/db/client.js';
import {createSitemaps, registerSitemaps} from '../src/seo/sitemaps.js';

const NOW = Date.parse('2026-10-12T12:00:00Z');
const DATE = '2026-10-11T01:02:03Z';
const epoch = Date.parse('2026-10-10T10:00:00Z');
const dialect = new MySqlDialect();
type Query = ReturnType<typeof dialect.sqlToQuery>;
function fixture(overrides: {maxima?: Row; vocabulary?: false | Row; events?: boolean; rows?: Row[]; run?: (query: Query) => Row[] | Promise<Row[]> | undefined} = {}) {
    const queries: Query[] = [];
    const reader: Reader = {
        async rows<T extends Row>(statement: SQL) {
            const query = dialect.sqlToQuery(statement); queries.push(query);
            const custom = await overrides.run?.(query); if (custom !== undefined) return custom as T[];
            if (query.sql.includes('SELECT MAX(u_id)')) return [overrides.maxima ?? {channels: 50001, videos: 2, tags: 1}] as T[];
            if (query.sql.includes('ts_vocabulary_current')) {
                if (overrides.vocabulary === false) throw new DataQueryFailed('ER_NO_SUCH_TABLE');
                return [overrides.vocabulary ?? {id: 'run-one', snapshot_bytes: 256, published_epoch: epoch}] as T[];
            }
            if (query.sql.startsWith('SELECT JSON_EXTRACT(snapshot')) return [{separate_terms: overrides.vocabulary && 'separate_terms' in overrides.vocabulary ? overrides.vocabulary.separate_terms : true, embedded_terms: 1}] as unknown as T[];
            if (query.sql.includes('LIMIT 0')) return [];
            if (query.sql.includes('WHERE 1=0')) {
                if (overrides.events === false) throw new DataQueryFailed('ER_NO_SUCH_TABLE');
                return [];
            }
            return (overrides.rows ?? []) as T[];
        },
        async close() {},
    };
    return {reader, queries};
}
const options = {now: () => NOW, staticLastModified: DATE};
function urls(body: string) { return [...body.matchAll(/<loc>(.*?)<\/loc>/g)].map(m => m[1]); }
function leafQueries(queries: Query[]) { return queries.filter(q => !q.sql.includes('SELECT MAX(u_id)') && !q.sql.includes('ts_vocabulary_current') && !q.sql.startsWith('SELECT JSON_EXTRACT(snapshot') && !q.sql.includes('LIMIT 0') && !q.sql.includes('WHERE 1=0')); }

describe('bounded canonical sitemap inventory', () => {
    it('uses indexed MAX endpoints and fixed official URLs with 256 prefix buckets, never Host or wall-clock lastmod', async () => {
        const {reader, queries} = fixture(); const maps = createSitemaps(reader, options);
        const body = await maps.read();
        expect(body).toContain('<sitemapindex'); expect(urls(body)).toHaveLength(517);
        expect(urls(body)).toContain('https://youtube.observe.tw/sitemaps/channels/2.xml');
        expect(urls(body)).toContain('https://youtube.observe.tw/sitemaps/keywords/ff.xml');
        expect(urls(body)).toContain('https://youtube.observe.tw/sitemaps/events/00.xml');
        expect(body).not.toContain('<lastmod>');
        expect(queries[0]!.sql).toContain('MAX(pk)');
        expect(queries.map(q => q.sql).join('\n')).not.toMatch(/COUNT\(|OFFSET|SELECT \*/);
        const statics = await maps.read('static', '1');
        expect(urls(statics)).toContain('https://youtube.observe.tw/api');
        expect(urls(statics)).not.toContain('https://youtube.observe.tw/api/status');
        expect(urls(statics).every(url => url && !url.includes('?') && (url.endsWith('.tw/') || !url.endsWith('/')))).toBe(true);
        expect(statics.match(/<lastmod>/g)).toHaveLength(urls(statics).length);
        expect(statics).toContain('<lastmod>2026-10-11T01:02:03.000Z</lastmod>');
        expect(queries).toHaveLength(5);
    });
    it('does not invent static release dates and rejects future or overflowing source dates', async () => {
        for (const date of [undefined, '2027-01-01T00:00:00Z', '2026-02-30T00:00:00Z', 'now']) {
            const {reader} = fixture(); const maps = createSitemaps(reader, {now: () => NOW, staticLastModified: date});
            expect(await maps.read()).not.toContain('/static/');
            await expect(maps.read('static', '1')).rejects.toMatchObject({statusCode: 404});
        }
    });
    it('ranges by integer PK including sparse IDs and excludes inactive/deleted identities without OFFSET', async () => {
        const {reader, queries} = fixture({rows: [{u_id: 50001, tag_id: 1, mtime: '2026-10-11 12:00:00', ctime: '2026-01-01 00:00:00'}]});
        const maps = createSitemaps(reader, options);
        expect(await maps.read('channels', '2')).toContain('/channels/50001');
        expect(await maps.read('tags', '1')).toContain('/tags/1/channels');
        const [channels, tags] = leafQueries(queries);
        expect(channels!.sql).toContain('(c.flag_del IS NULL OR c.flag_del<1)');
        expect(channels!.sql).toContain('c.u_id>? AND c.u_id<=?');
        expect(channels!.params).toEqual([50000, 100000, 50001]);
        expect(tags!.sql).toContain('(del_flag IS NULL OR del_flag<1)');
        expect(tags!.params).toEqual([0, 50000, 50001]);
    });
    it('uses source modification/creation time, ignores future schedule time, and selects latest byte-exact valid video IDs', async () => {
        const {reader, queries} = fixture({rows: [
            {videoId: 'Abc_def-123', title: 'normal', mtime: '2026-10-11 12:00:00', stime: '2027-10-11 12:00:00'},
            {videoId: 'Abc_def-1234', title: 'normal', mtime: '2026-10-11 12:00:00'},
            {videoId: 'Abc_def-125', title: 'Private video', mtime: '2026-10-11 12:00:00'},
            {videoId: 'Abc_def-126', title: 'Deleted video', mtime: '2026-10-11 12:00:00'},
            {videoId: 'Abc_def-127', title: 'normal', mtime: '2027-10-11 12:00:00'},
            {videoId: 'Abc_def-128', title: 'normal', mtime: '0000-00-00 00:00:00'},
            {videoId: 'Abc_def-129', title: 'normal', mtime: '2026-02-30 12:00:00'},
            {videoId: 'Abc_def-130', title: 'normal', mtime: null, ctime: '2026-01-01 08:00:00'},
        ]});
        const body = await createSitemaps(reader, options).read('videos', '1');
        expect(urls(body)).toEqual(['https://youtube.observe.tw/videos/Abc_def-123', 'https://youtube.observe.tw/videos/Abc_def-130']);
        expect(body).toContain('<lastmod>2026-10-11T04:00:00.000Z</lastmod>');
        expect(body).toContain('<lastmod>2026-01-01T00:00:00.000Z</lastmod>');
        const [query] = leafQueries(queries);
        expect(query!.sql).toContain('newer.videoId=v.videoId AND BINARY newer.videoId=BINARY v.videoId AND newer.pk>v.pk');
        expect(query!.sql).not.toContain('stime');
        expect(query!.sql).toContain("(v.title IS NULL OR v.title NOT IN ('Private video','Deleted video'))");
        expect(query!.sql.split(' FROM ')[0]).toBe('SELECT v.pk,v.videoId,v.mtime,v.ctime');
    });
    it('uses indexed term buckets and maintained publication time without changing original term identity', async () => {
        const rows = ['新聞 & AI', `a<b>"'`, 'A/B', 'A\\B', 'tag%', 'a%41', '.', '..', '\ud800', '\u0000', '😀'.repeat(121)].map((term, i) => ({term, term_key: 'ab' + String(i).padStart(62, '0')}));
        rows.push({...rows[0]!});
        const {reader, queries} = fixture({rows}); const body = await createSitemaps(reader, options).read('keywords', 'ab');
        expect(urls(body)).toHaveLength(3);
        expect(body).toContain('/keywords/%E6%96%B0%E8%81%9E%20%26%20AI/videos');
        expect(body).toContain('/keywords/a%3Cb%3E%22&apos;/videos');
        expect(body).not.toContain('/keywords/A%2FB/videos');
        expect(body).toContain('/keywords/tag%25/videos');
        expect(body).toContain('<lastmod>2026-10-10T10:00:00.000Z</lastmod>');
        const [query] = leafQueries(queries);
        expect(query!.sql).toContain('run_id=? AND term_key>=? AND term_key<? ORDER BY term_key LIMIT ?');
        expect(query!.params).toEqual(['run-one', 'ab', 'ac', 50001]);
        expect(queries.find(q => q.sql.includes('ts_vocabulary_current'))!.sql).toContain('UNIX_TIMESTAMP(r.published_at)*1000');
    });
    it('requires a reliable publication lastmod for either stored vocabulary format', async () => {
        for (const vocabulary of [{id: 'missing-date', snapshot_bytes: 256, separate_terms: true, published_epoch: null}, {id: 'future', snapshot_bytes: 256, separate_terms: true, published_epoch: NOW + 1}]) {
            const {reader} = fixture({vocabulary}); const maps = createSitemaps(reader, options);
            expect(await maps.read()).not.toContain('/sitemaps/keywords/');
            await expect(maps.read('keywords', '00')).rejects.toMatchObject({statusCode: 404});
        }
    });
    it('includes the current bounded embedded observation pool without claiming a complete canonical vocabulary', async () => {
        const f = fixture({vocabulary: {id: 'observed-window', snapshot_bytes: 1024, separate_terms: false, published_epoch: epoch}, rows: [{term_key: 'ab' + '0'.repeat(62), term: '原標籤'}]});
        const maps = createSitemaps(f.reader, options);
        expect(await maps.read()).toContain('/sitemaps/keywords/ab.xml');
        expect(await maps.read('keywords', 'ab')).toContain(encodeURIComponent('原標籤'));
        expect(f.queries.some(q => q.sql.includes('ts_vocabulary_terms'))).toBe(false);
        const query = leafQueries(f.queries)[0]!;
        expect(query.sql).toContain("JSON_TABLE(r.snapshot,'$.terms[*]'");
        expect(query.sql).toContain("r.id=? AND r.status='published' AND t.term_key>=? AND t.term_key<?");
        expect(query.params).toEqual(['observed-window', 'ab', 'ac', 50001]);
    });
    it('checks the embedded snapshot byte budget before any JSON parsing and refuses overfull pools', async () => {
        const large = fixture({vocabulary: {id: 'too-large', snapshot_bytes: 8000001, published_epoch: epoch}});
        await expect(createSitemaps(large.reader, options).read()).rejects.toMatchObject({statusCode: 503});
        expect(large.queries.some(q => q.sql.includes('JSON_'))).toBe(false);
        const many = fixture({run: q => q.sql.startsWith('SELECT JSON_EXTRACT(snapshot') ? [{separate_terms: false, embedded_terms: 50001}] : undefined});
        await expect(createSitemaps(many.reader, options).read()).rejects.toMatchObject({statusCode: 503});
        expect(leafQueries(many.queries)).toHaveLength(0);
    });
    it('requires canonical unmerged UUIDs, reads UTC editorial dates and caps ff without a LIKE scan', async () => {
        const id = 'ff000000-0000-4000-8000-000000000000';
        const {reader, queries} = fixture({rows: [{id, mtime: '2026-10-11 12:00:00.123'}, {id: id.toUpperCase(), mtime: '2026-10-11 12:00:00'}]});
        const body = await createSitemaps(reader, options).read('events', 'ff');
        expect(urls(body)).toEqual([`https://youtube.observe.tw/events/${id}`]);
        expect(body).toContain('2026-10-11T12:00:00.123Z');
        const [query] = leafQueries(queries);
        expect(query!.sql).toContain('merged_into IS NULL AND id>=? AND id<? ORDER BY id LIMIT ?');
        expect(query!.params).toEqual(['ff', 'g', 50001]);
    });
    it('omits absent optional schema but never disguises timeouts, permission errors or drift as an empty inventory', async () => {
        const {reader} = fixture({vocabulary: false, events: false}); const maps = createSitemaps(reader, options);
        const index = await maps.read(); expect(index).not.toContain('/keywords/'); expect(index).not.toContain('/events/');
        const statics = await maps.read('static', '1'); expect(statics).not.toContain('.tw/keywords<'); expect(statics).not.toContain('.tw/events<');
        for (const error of [new DataSourceUnavailable(), new DataQueryFailed('ER_BAD_FIELD_ERROR')]) {
            const f = fixture({run: query => { if (query.sql.includes('ts_vocabulary_current')) throw error; return undefined; }});
            await expect(createSitemaps(f.reader, options).read()).rejects.toBe(error);
        }
        const f = fixture({run: query => { if (query.sql.includes('ts_editorial_audit_events')) throw new DataQueryFailed('ER_NO_SUCH_TABLE'); return undefined; }});
        expect(await createSitemaps(f.reader, options).read()).not.toContain('/events/');
    });
    it('rejects noncanonical/unknown/out-of-inventory pages without a leaf query', async () => {
        const {reader, queries} = fixture(); const maps = createSitemaps(reader, options);
        for (const [kind, page] of [['private', '1'], ['channels', '0'], ['channels', '01'], ['channels', '3'], ['videos', '-1'], ['videos', '9007199254740991'], ['events', 'FF'], ['keywords', '1'], ['static', '2']]) await expect(maps.read(kind, page)).rejects.toMatchObject({statusCode: 404});
        expect(leafQueries(queries)).toHaveLength(0);
    });
    it('fails safely at the URL count and XML byte cap instead of truncating an oversized bucket', async () => {
        const many = fixture({rows: Array.from({length: 50001}, () => ({term_key: 'a'.repeat(64), term: 'same'}))});
        await expect(createSitemaps(many.reader, options).read('keywords', 'aa')).rejects.toMatchObject({statusCode: 503});
        const large = fixture({rows: Array.from({length: 4500}, (_, i) => ({term_key: 'aa' + String(i).padStart(62, '0'), term: '新'.repeat(230) + i}))});
        await expect(createSitemaps(large.reader, options).read('keywords', 'aa')).rejects.toMatchObject({statusCode: 503});
        const hugeIndex = fixture({maxima: {channels: 2147483647, videos: 2147483647, tags: 1}});
        await expect(createSitemaps(hugeIndex.reader, options).read()).rejects.toMatchObject({statusCode: 503});
    });
});

describe('bounded sitemap caching and Fastify transport', () => {
    it('coalesces index and child misses, refreshes metadata/XML after one hour and never caches errors', async () => {
        let clock = NOW; const {reader, queries} = fixture(); const maps = createSitemaps(reader, {now: () => clock, staticLastModified: DATE});
        const [a, b] = await Promise.all([maps.read(), maps.read()]); expect(a).toBe(b); expect(queries).toHaveLength(5);
        await Promise.all([maps.read('channels', '1'), maps.read('channels', '1')]); expect(leafQueries(queries)).toHaveLength(1);
        clock += 3599999; await maps.read(); await maps.read('channels', '1'); expect(queries).toHaveLength(6);
        clock += 2; await maps.read(); await maps.read('channels', '1'); expect(queries).toHaveLength(12);
        let broken = true;
        const failed = fixture({run: query => { if (broken && query.sql.includes('SELECT MAX(u_id)')) throw new DataSourceUnavailable(); return undefined; }});
        const retry = createSitemaps(failed.reader, options);
        await expect(retry.read()).rejects.toBeInstanceOf(DataSourceUnavailable); broken = false;
        expect(await retry.read()).toContain('<sitemapindex');
    });
    it('retains all 512 tiny hash buckets, bounds ready keys at 600 and in-flight misses at four', async () => {
        let resolve!: (rows: Row[]) => void;
        const gate = new Promise<Row[]>(r => { resolve = r; });
        const f = fixture({run: query => query.sql.includes('SELECT MAX(u_id)') ? gate : undefined});
        const maps = createSitemaps(f.reader, options);
        const work = ['00', '01', '02', '03'].map(page => maps.read('keywords', page));
        await expect(maps.read('keywords', '04')).rejects.toMatchObject({statusCode: 503});
        resolve([{channels: 4_450_000, videos: 1, tags: 1}]); await Promise.all(work);
        expect(f.queries.filter(q => q.sql.includes('SELECT MAX(u_id)'))).toHaveLength(1);
        for (let i = 4; i < 256; i++) await maps.read('keywords', i.toString(16).padStart(2, '0'));
        for (let i = 0; i < 256; i++) await maps.read('events', i.toString(16).padStart(2, '0'));
        const buckets = leafQueries(f.queries).length;
        expect(buckets).toBe(512);
        // Touch 00 after all 512 buckets: it must still be retained and becomes MRU.
        await maps.read('keywords', '00'); expect(leafQueries(f.queries)).toHaveLength(buckets);
        for (let i = 1; i <= 89; i++) await maps.read('channels', String(i));
        const before = leafQueries(f.queries).length;
        await maps.read('channels', '89'); await maps.read('keywords', '00');
        expect(leafQueries(f.queries)).toHaveLength(before);
        // 601 documents crossed the key cap; the untouched oldest bucket 01 was evicted.
        await maps.read('keywords', '01'); expect(leafQueries(f.queries)).toHaveLength(before + 1);
    });
    it('enforces the independent 32 MiB byte budget even with only five large cached buckets', async () => {
        const f = fixture({rows: Array.from({length: 3700}, (_, i) => ({term_key: 'aa' + String(i).padStart(62, '0'), term: '新'.repeat(210) + i}))});
        const maps = createSitemaps(f.reader, options);
        let size = 0;
        for (let i = 0; i < 5; i++) {
            const body = await maps.read('keywords', i.toString(16).padStart(2, '0'));
            size = Buffer.byteLength(body);
            expect(size).toBeLessThanOrEqual(8 * 1024 * 1024);
        }
        expect(size * 4).toBeLessThanOrEqual(32 * 1024 * 1024);
        expect(size * 5).toBeGreaterThan(32 * 1024 * 1024);
        const before = leafQueries(f.queries).length;
        await maps.read('keywords', '04'); expect(leafQueries(f.queries)).toHaveLength(before);
        await maps.read('keywords', '00'); expect(leafQueries(f.queries)).toHaveLength(before + 1);
    });
    it('GET/HEAD serve XML with a one-hour anonymous shared policy and identity-aware Vary', async () => {
        const app = Fastify(); const {reader} = fixture(); registerSitemaps(app, reader, options);
        try {
            for (const method of ['GET', 'HEAD'] as const) {
                const response = await app.inject({method, url: '/sitemap.xml', headers: {host: 'attacker.invalid'}});
                expect(response.statusCode).toBe(200); expect(response.headers['content-type']).toBe('application/xml; charset=utf-8');
                expect(response.headers['cache-control']).toBe('public, max-age=0, s-maxage=3600');
                expect(response.headers.vary).toBe('Cookie, Authorization, X-Api-Key, RSC');
                expect(response.body).not.toContain('attacker.invalid'); if (method === 'HEAD') expect(response.body).toBe('');
            }
            const leaf = await app.inject('/sitemaps/static/1.xml'); expect(leaf.statusCode).toBe(200); expect(leaf.body).toContain('<urlset');
            for (const headers of [{cookie: ''}, {authorization: 'Bearer opaque'}, {'x-api-key': 'opaque'}, {rsc: '1'}]) {
                const response = await app.inject({url: '/sitemap.xml', headers}); expect(response.statusCode).toBe(200); expect(response.headers['cache-control']).toBe('private, no-store');
            }
            for (const path of ['/sitemap.xml?q=x', '/sitemaps/static/1.xml?q=', '/sitemaps/private/1.xml', '/sitemaps/channels/01.xml']) {
                const response = await app.inject(path); expect(response.statusCode).toBe(path.includes('?') ? 400 : 404); expect(response.headers['cache-control']).toBe('no-store');
            }
        } finally { await app.close(); }
    });
    it('keeps Set-Cookie responses private and preserves wildcard Vary', async () => {
        const app = Fastify(); const {reader} = fixture();
        app.addHook('onRequest', async (_request, reply) => { reply.header('Set-Cookie', 'session=opaque').header('Vary', '*'); });
        registerSitemaps(app, reader, options);
        try { const response = await app.inject('/sitemap.xml'); expect(response.headers['cache-control']).toBe('private, no-store'); expect(response.headers.vary).toBe('*'); }
        finally { await app.close(); }
    });
    it('returns no-store 503 on transport failures and 500 on query defects, with sanitized bodies', async () => {
        for (const [error, status] of [[new DataSourceUnavailable(), 503], [new DataQueryFailed('ER_BAD_FIELD_ERROR'), 500]] as const) {
            const app = Fastify(); const f = fixture({run: () => { throw error; return undefined; }}); registerSitemaps(app, f.reader, options);
            try { const response = await app.inject('/sitemap.xml'); expect(response.statusCode).toBe(status); expect(response.headers['cache-control']).toBe('no-store'); expect(response.body).toBe('{"error":"Sitemap unavailable."}'); expect(response.headers['retry-after']).toBe(status === 503 ? '60' : undefined); }
            finally { await app.close(); }
        }
    });
});
