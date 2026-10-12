import {sql, type SQL} from 'drizzle-orm';
import type {FastifyInstance} from 'fastify';
import {DataQueryFailed, DataSourceUnavailable, type Reader, type Row} from '../db/client.js';

const ORIGIN = 'https://youtube.observe.tw';
const PAGE_SIZE = 50_000;
const SNAPSHOT_BYTES = 8_000_000;
const XML_BYTES = 8 * 1024 * 1024;
const CACHE_BYTES = 32 * 1024 * 1024;
const CACHE_KEYS = 600;
const CACHE_TTL = 3_600_000;
const MAX_PENDING = 4;
const kinds = ['static', 'channels', 'videos', 'keywords', 'tags', 'events'] as const;
type Kind = typeof kinds[number];
type NumericKind = 'channels' | 'videos' | 'tags';
const staticPaths = [
    '/', '/videos', '/channels', '/tags', '/keywords', '/events', '/groups', '/mayor',
    '/ai/days', '/ai/hours', '/ai/periods', '/ai/aspects', '/live/current', '/live/channels',
    '/live/hours', '/live/tags', '/live/periods', '/live/trends/daily', '/compare/titles', '/about', '/api',
] as const;
export interface SitemapOptions {
    /** Explicit source-content release timestamp, never request/startup time. */
    staticLastModified?: string;
    now?: () => number;
}
interface Inventory {
    pages: Record<NumericKind, number>;
    vocabulary: boolean;
    keywords: {runId: string; lastmod: string; separate: boolean} | null;
    events: boolean;
}
interface Entry {path: string; lastmod: string}
class SitemapFailure extends Error {
    constructor(readonly statusCode: number, message: string) { super(message); }
}
const notFound = () => new SitemapFailure(404, 'Sitemap not found.');
const overBudget = () => new SitemapFailure(503, 'Sitemap read capacity exceeded.');
function optionalMissing(error: unknown): boolean {
    return error instanceof DataQueryFailed && error.driverCode === 'ER_NO_SUCH_TABLE';
}
function positiveId(value: unknown): string | null {
    const s = String(value ?? '');
    return /^[1-9]\d*$/.test(s) && Number.isSafeInteger(Number(s)) ? s : null;
}
/** Date strings from legacy tables are Taipei civil time; editorial rows are UTC.
 * Round-trip the civil component to reject zero/overflow dates rather than normalize them. */
function sourceDate(value: unknown, zone: 'taipei' | 'utc', now: number): string | null {
    if (typeof value !== 'string') return null;
    const match = /^(\d{4}-\d\d-\d\d)[ T](\d\d:\d\d:\d\d)(?:\.(\d{1,6}))?$/.exec(value);
    if (!match || match[1]!.startsWith('0000')) return null;
    const civil = `${match[1]}T${match[2]}.${(match[3] ?? '').padEnd(3, '0').slice(0, 3)}`;
    const offset = zone === 'taipei' ? 8 * 3_600_000 : 0;
    const millis = Date.parse(civil + 'Z') - offset;
    if (!Number.isFinite(millis) || millis > now || new Date(millis + offset).toISOString().slice(0, -1) !== civil) return null;
    return new Date(millis).toISOString();
}
function absoluteDate(value: unknown, now: number): string | null {
    if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)) return null;
    return sourceDate(value.slice(0, -1), 'utc', now);
}
function modified(row: Row, zone: 'taipei' | 'utc', now: number): string | null {
    const dates = [sourceDate(row.mtime, zone, now), sourceDate(row.ctime, zone, now)].filter((v): v is string => v !== null);
    return dates.sort().at(-1) ?? null;
}
function escapeXml(value: string): string {
    return value.replace(/[<>&"']/g, char => ({'<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;'}[char]!));
}
function xmlDocument(root: 'urlset' | 'sitemapindex', fragments: Iterable<string>): string {
    const head = `<?xml version="1.0" encoding="UTF-8"?>\n<${root} xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;
    const tail = `</${root}>`;
    let bytes = Buffer.byteLength(head + tail), count = 0;
    const parts = [head];
    for (const fragment of fragments) {
        bytes += Buffer.byteLength(fragment);
        if (++count > PAGE_SIZE || bytes > XML_BYTES) throw overBudget();
        parts.push(fragment);
    }
    return parts.join('') + tail;
}
function urlset(entries: Iterable<Entry>): string {
    // Convert lazily: the byte cap stops encoding before building a potentially
    // 100 MiB collection of percent-encoded labels. Identity dedupe is page-local.
    return xmlDocument('urlset', (function* () {
        const seen = new Set<string>();
        for (const entry of entries) {
            if (seen.has(entry.path)) continue;
            seen.add(entry.path);
            yield `<url><loc>${escapeXml(ORIGIN + entry.path)}</loc><lastmod>${entry.lastmod}</lastmod></url>`;
        }
    })());
}
function bucketBounds(page: string): [string, string] {
    return [page, page === 'ff' ? 'g' : (parseInt(page, 16) + 1).toString(16).padStart(2, '0')];
}
function keywordPath(term: unknown): string | null {
    if (typeof term !== 'string' || !term || term.length > 240 || term === '.' || term === '..' || term.includes('/') || term.includes('\\') || /[\u0000-\u001f\u007f-\u009f]|%[0-9a-f]{2}/i.test(term)) return null;
    try { return `/keywords/${encodeURIComponent(term)}/videos`; } catch { return null; }
}

/** One instance per gateway: bounded immutable public inventory, independent of identity.
 * Metadata and XML share the four-miss gate; metadata uses a separate single-flight slot
 * inside it so four simultaneous child requests cannot deadlock awaiting metadata. */
export function createSitemaps(reader: Reader, options: SitemapOptions = {}) {
    const now = options.now ?? Date.now;
    const cache = new Map<string, {body: string; expires: number; bytes: number}>();
    const pending = new Map<string, Promise<string>>();
    let bytes = 0;
    let metadata: {value: Inventory; expires: number} | undefined;
    let metadataPending: Promise<Inventory> | undefined;
    const drop = (key: string) => { const old = cache.get(key); if (old) { bytes -= old.bytes; cache.delete(key); } };
    async function inventory(): Promise<Inventory> {
        if (metadata && metadata.expires > now()) return metadata.value;
        if (metadataPending) return metadataPending;
        metadataPending = (async () => {
            // Each scalar MAX is an indexed endpoint lookup, including sparse PK ranges.
            const [maxima] = await reader.rows(sql`SELECT (SELECT MAX(u_id) FROM urt_channel) AS channels,(SELECT MAX(pk) FROM urt_video) AS videos,(SELECT MAX(tag_id) FROM urt_tag) AS tags`);
            const pages = {} as Inventory['pages'];
            for (const kind of ['channels', 'videos', 'tags'] as const) {
                const max = maxima?.[kind];
                if (max !== null && max !== undefined && !positiveId(max)) throw new DataQueryFailed('INVALID_SITEMAP_MAX_ID');
                pages[kind] = Math.ceil(Number(max ?? 0) / PAGE_SIZE);
                if (pages[kind] > PAGE_SIZE) throw overBudget();
            }
            let vocabulary = false;
            let keywords: Inventory['keywords'] = null;
            try {
                // Measure before JSON parsing: embedded window snapshots have an explicit
                // publication budget; full exports keep only their small metadata here.
                const [run] = await reader.rows(sql`SELECT r.id,OCTET_LENGTH(r.snapshot) AS snapshot_bytes,UNIX_TIMESTAMP(r.published_at)*1000 AS published_epoch FROM ts_vocabulary_current c JOIN ts_vocabulary_runs r ON r.id=c.run_id WHERE c.source=${'https://tag.observe.tw'} AND r.status='published' LIMIT 1`);
                vocabulary = true;
                if (run) {
                    const size = Number(run.snapshot_bytes);
                    if (run.snapshot_bytes == null || !Number.isSafeInteger(size) || size < 0) throw new DataQueryFailed('INVALID_VOCABULARY_SNAPSHOT_SIZE');
                    if (size > SNAPSHOT_BYTES) throw overBudget();
                    const [shape] = await reader.rows(sql`SELECT JSON_EXTRACT(snapshot,'$.termsStoredSeparately') AS separate_terms,JSON_LENGTH(snapshot,'$.terms') AS embedded_terms FROM ts_vocabulary_runs WHERE id=${run.id} AND status='published' LIMIT 1`);
                    const separate = ['true', '1'].includes(String(shape?.separate_terms));
                    if (separate) await reader.rows(sql`SELECT term_key FROM ts_vocabulary_terms LIMIT 0`);
                    else if (Number(shape?.embedded_terms ?? 0) > PAGE_SIZE) throw overBudget();
                    const epoch = Number(run.published_epoch);
                    if (shape && typeof run.id === 'string' && run.id && run.published_epoch != null && Number.isFinite(epoch) && epoch > 0 && epoch <= now()) {
                        keywords = {runId: run.id, lastmod: new Date(epoch).toISOString(), separate};
                    }
                }
            } catch (error) { if (!optionalMissing(error)) throw error; vocabulary = false; keywords = null; }
            let events = false;
            try {
                // Event detail requires these tables. Constant false prevents data reads.
                await reader.rows(sql`SELECT e.id FROM ts_editorial_events e,ts_editorial_sources s,ts_editorial_links l,ts_editorial_audit a,ts_editorial_audit_events ae WHERE 1=0`);
                events = true;
            } catch (error) { if (!optionalMissing(error)) throw error; }
            const value = {pages, vocabulary, keywords, events};
            metadata = {value, expires: now() + CACHE_TTL};
            return value;
        })();
        try { return await metadataPending; } finally { metadataPending = undefined; }
    }
    async function build(kind?: Kind, page?: string): Promise<string> {
        const info = await inventory();
        const staticDate = absoluteDate(options.staticLastModified, now());
        if (kind === undefined) {
            const paths: string[] = [];
            if (staticDate) paths.push('/sitemaps/static/1.xml');
            for (const name of ['channels', 'videos', 'tags'] as const) {
                for (let n = 1; n <= info.pages[name]; n++) {
                    if (paths.length >= PAGE_SIZE) throw overBudget();
                    paths.push(`/sitemaps/${name}/${n}.xml`);
                }
            }
            for (const name of ['keywords', 'events'] as const) {
                if (!info[name]) continue;
                for (let n = 0; n < 256; n++) paths.push(`/sitemaps/${name}/${n.toString(16).padStart(2, '0')}.xml`);
            }
            // Index pointers have no fabricated modification timestamp; URL entries do.
            return xmlDocument('sitemapindex', paths.map(path => `<sitemap><loc>${ORIGIN}${path}</loc></sitemap>`));
        }
        if (kind === 'static') {
            if (page !== '1' || !staticDate) throw notFound();
            return urlset(staticPaths.filter(path => (path !== '/events' || info.events) && (path !== '/keywords' || info.vocabulary)).map(path => ({path, lastmod: staticDate})));
        }
        let query: SQL;
        if (kind === 'keywords' || kind === 'events') {
            if (!page || !/^[a-f0-9]{2}$/.test(page) || !info[kind]) throw notFound();
            const [lower, upper] = bucketBounds(page);
            query = kind === 'keywords'
                ? info.keywords!.separate
                    ? sql`SELECT term_key,term FROM ts_vocabulary_terms WHERE run_id=${info.keywords!.runId} AND term_key>=${lower} AND term_key<${upper} ORDER BY term_key LIMIT ${PAGE_SIZE + 1}`
                    : sql`SELECT t.term_key,t.term FROM ts_vocabulary_runs r,JSON_TABLE(r.snapshot,'$.terms[*]' COLUMNS(term_key VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin PATH '$.key',term VARCHAR(480) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin PATH '$.term')) t WHERE r.id=${info.keywords!.runId} AND r.status='published' AND t.term_key>=${lower} AND t.term_key<${upper} ORDER BY t.term_key LIMIT ${PAGE_SIZE + 1}`
                : sql`SELECT id,updated_at AS mtime,created_at AS ctime FROM ts_editorial_events WHERE merged_into IS NULL AND id>=${lower} AND id<${upper} ORDER BY id LIMIT ${PAGE_SIZE + 1}`;
        } else {
            const n = Number(page);
            if (!page || !/^[1-9]\d*$/.test(page) || !Number.isSafeInteger(n) || n > info.pages[kind]) throw notFound();
            const lower = (n - 1) * PAGE_SIZE, upper = n * PAGE_SIZE;
            query = kind === 'channels'
                ? sql`SELECT c.u_id,c.mtime,c.ctime FROM urt_channel c WHERE c.u_id>${lower} AND c.u_id<=${upper} AND (c.flag_del IS NULL OR c.flag_del<1) ORDER BY c.u_id LIMIT ${PAGE_SIZE + 1}`
                : kind === 'tags'
                    ? sql`SELECT tag_id,mtime,ctime FROM urt_tag WHERE tag_id>${lower} AND tag_id<=${upper} AND (del_flag IS NULL OR del_flag<1) ORDER BY tag_id LIMIT ${PAGE_SIZE + 1}`
                    : sql`SELECT v.pk,v.videoId,v.mtime,v.ctime FROM urt_video v WHERE v.pk>${lower} AND v.pk<=${upper} AND (v.title IS NULL OR v.title NOT IN ('Private video','Deleted video')) AND NOT EXISTS (SELECT 1 FROM urt_video newer WHERE newer.videoId=v.videoId AND BINARY newer.videoId=BINARY v.videoId AND newer.pk>v.pk) ORDER BY v.pk LIMIT ${PAGE_SIZE + 1}`;
        }
        const rows = await reader.rows(query);
        if (rows.length > PAGE_SIZE) throw overBudget();
        return urlset((function* (): Generator<Entry> {
        for (const row of rows) {
            let path: string | null = null;
            let lastmod = modified(row, kind === 'events' ? 'utc' : 'taipei', now());
            if (kind === 'channels') { const id = positiveId(row.u_id); if (id) path = `/channels/${id}`; }
            if (kind === 'tags') { const id = positiveId(row.tag_id); if (id) path = `/tags/${id}/channels`; }
            if (kind === 'videos' && typeof row.videoId === 'string' && /^[A-Za-z0-9_-]{11}$/.test(row.videoId) && row.title !== 'Private video' && row.title !== 'Deleted video') path = `/videos/${row.videoId}`;
            if (kind === 'events' && typeof row.id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(row.id)) path = `/events/${row.id}`;
            if (kind === 'keywords' && typeof row.term_key === 'string' && /^[0-9a-f]{64}$/.test(row.term_key)) {
                path = keywordPath(row.term);
                // This is publication of maintained tag metadata, not YouTube observation time.
                lastmod = info.keywords!.lastmod;
            }
            if (path && lastmod) yield {path, lastmod};
        }
        })());
    }
    return {
        async read(kind?: string, page?: string): Promise<string> {
            // Bound cardinality before cache/pending admission and reject noncanonical paths.
            if (kind !== undefined && (!kinds.includes(kind as Kind) || !page || !/^(?:[1-9]\d{0,4}|[a-f0-9]{2})$/.test(page))) throw notFound();
            const key = kind === undefined ? 'index' : `${kind}/${page}`;
            const hit = cache.get(key);
            if (hit && hit.expires > now()) { cache.delete(key); cache.set(key, hit); return hit.body; }
            drop(key);
            const work = pending.get(key);
            if (work) return work;
            if (pending.size >= MAX_PENDING) throw overBudget();
            const promise = build(kind as Kind | undefined, page).then(body => {
                const size = Buffer.byteLength(body);
                for (const [oldKey, value] of cache) if (value.expires <= now()) drop(oldKey);
                while (cache.size >= CACHE_KEYS || bytes + size > CACHE_BYTES) drop(cache.keys().next().value!);
                cache.set(key, {body, expires: Math.min(now() + CACHE_TTL, metadata?.expires ?? Infinity), bytes: size}); bytes += size;
                return body;
            }).finally(() => { pending.delete(key); });
            pending.set(key, promise);
            return promise;
        },
    };
}

/** Register before the frontend wildcard proxy. Fastify supplies matching HEAD routes. */
export function registerSitemaps(app: FastifyInstance, reader: Reader, options: SitemapOptions = {}): void {
    const sitemaps = createSitemaps(reader, options);
    app.register(async scoped => {
        scoped.addHook('onSend', async (request, reply, payload) => {
            const vary = new Map(String(reply.getHeader('Vary') ?? '').split(',').map(v => v.trim()).filter(Boolean).map(v => [v.toLowerCase(), v]));
            for (const name of ['Cookie', 'Authorization', 'X-Api-Key', 'RSC']) vary.set(name.toLowerCase(), name);
            reply.header('Vary', vary.has('*') ? '*' : [...vary.values()].join(', '));
            const privateResponse = ['cookie', 'authorization', 'x-api-key', 'rsc'].some(name => request.headers[name] !== undefined) || reply.hasHeader('set-cookie');
            const success = reply.statusCode === 200 && /^application\/xml(?:;|$)/i.test(String(reply.getHeader('content-type')));
            reply.header('Cache-Control', privateResponse ? 'private, no-store' : success && !vary.has('*') ? 'public, max-age=0, s-maxage=3600' : 'no-store');
            return payload;
        });
        const handler = async (request: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => {
            if (request.url.includes('?')) return reply.code(400).send({error: 'Sitemaps do not accept query parameters.'});
            const params = request.params as {kind?: string; page?: string};
            try { return reply.type('application/xml; charset=utf-8').send(await sitemaps.read(params.kind, params.page)); }
            catch (error) {
                const status = error instanceof SitemapFailure ? error.statusCode : error instanceof DataSourceUnavailable ? 503 : 500;
                if (status >= 500) request.log.error({code: error instanceof DataQueryFailed ? error.driverCode : status === 503 ? 'SITEMAP_UNAVAILABLE' : 'SITEMAP_QUERY_FAILED'}, 'Sitemap read failed');
                if (status === 503) reply.header('Retry-After', '60');
                return reply.code(status).type('application/json').send({error: status === 404 ? 'Sitemap not found.' : 'Sitemap unavailable.'});
            }
        };
        scoped.get('/sitemap.xml', handler);
        scoped.get('/sitemaps/:kind/:page.xml', handler);
    });
}
