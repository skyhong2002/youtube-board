import {gzip,gunzip} from 'node:zlib';
import {promisify} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import {sql, type SQL} from 'drizzle-orm';
import type {FastifyInstance} from 'fastify';
import {DataQueryFailed, DataSourceUnavailable, type Reader, type Row} from '../db/client.js';

const gzipAsync=promisify(gzip),gunzipAsync=promisify(gunzip);
const ORIGIN = 'https://youtube.observe.tw';
const NS = 'http://www.sitemaps.org/schemas/sitemap/0.9';
const XML_HEAD = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="${NS}">`;
const XML_TAIL = '</urlset>';
const kinds = ['static','channels','videos','tags'] as const;
type Kind = typeof kinds[number];
const staticPaths = [
    '/', '/videos', '/channels', '/tags', '/keywords', '/events', '/groups', '/mayor',
    '/ai/days', '/ai/hours', '/ai/periods', '/ai/aspects', '/live/current', '/live/channels',
    '/live/hours', '/live/tags', '/live/periods', '/live/trends/daily', '/compare/titles', '/about',
] as const;
export interface SitemapOptions {
    /** Explicit source-content release timestamp; never the request/build clock. */
    staticLastModified?: string;
    now?: () => number;
    /** Monotonic deadline clock; independently injectable for deterministic tests. */
    budgetNow?: () => number;
    ttlMs?: number;
    retryMs?: number;
    batchSize?: number;
    maxPageUrls?: number;
    maxPageBytes?: number;
    /** Retained compressed XML cap; plaintext is separately budgeted. */
    maxGenerationBytes?: number;
    maxGenerationPlaintextBytes?: number;
    pauseMs?: number;
    onDiagnostic?: (record:SitemapDiagnostic)=>void;
    maxGenerationRows?: number;
    maxGenerationMs?: number;
}
export interface SitemapDiagnostic {code:'SITEMAP_PREPARED'|'SITEMAP_PREPARATION_FAILED';reason?:string;rows:number;pages:number;compressedBytes:number;plaintextBytes:number;durationMs:number}
interface Document {compressed:Buffer;bytes:number;lastmod:string;urls:number}
interface Snapshot {index:string;children:ReadonlyMap<string,Document>;expires:number}
interface Entry {path:string;lastmod:string}
class SitemapFailure extends Error {
    constructor(readonly statusCode:number,message:string){super(message);}
}
const notFound=()=>new SitemapFailure(404,'Sitemap not found.');
const unavailable=()=>new SitemapFailure(503,'Sitemap snapshot is preparing or unavailable.');
const overBudget=()=>new SitemapFailure(503,'Sitemap snapshot exceeds its preparation budget.');
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

/** Entire read-only family is prepared once and published atomically. Children
 * never initiate SQL; arbitrary client page numbers cannot drive database scans.
 * A refresh failure retains the last complete snapshot and retries after cooldown. */
export function createSitemaps(reader:Reader,options:SitemapOptions={}){
    const now=options.now??Date.now,budgetNow=options.budgetNow??(()=>performance.now());
    const ttlMs=options.ttlMs??3_600_000,retryMs=options.retryMs??60_000;
    const batchSize=options.batchSize??5_000,maxPageUrls=options.maxPageUrls??50_000;
    const maxPageBytes=options.maxPageBytes??8*1024*1024;
    const maxGenerationBytes=options.maxGenerationBytes??32*1024*1024,maxGenerationPlaintextBytes=options.maxGenerationPlaintextBytes??128*1024*1024,pauseMs=options.pauseMs??100;
    const maxGenerationRows=options.maxGenerationRows??1_000_000,maxGenerationMs=options.maxGenerationMs??120_000;
    for(const [value,max] of [[ttlMs,86_400_000],[retryMs,3_600_000],[batchSize,5_000],[maxPageUrls,50_000],[maxPageBytes,8*1024*1024],[maxGenerationBytes,32*1024*1024],[maxGenerationPlaintextBytes,128*1024*1024],[maxGenerationRows,2_000_000],[maxGenerationMs,300_000]]){
        if(!Number.isSafeInteger(value)||value!<1||value!>max!)throw new Error('Invalid sitemap snapshot budget');
    }
    if(!Number.isSafeInteger(pauseMs)||pauseMs<0||pauseMs>1000)throw new Error('Invalid sitemap pacing');
    let current:Snapshot|undefined,previous:{children:ReadonlyMap<string,Document>;until:number}|undefined,pending:Promise<void>|undefined,nextAttempt=0;
    let failedStatus:500|503=503,decodeActive=false;
    // One active gunzip plus at most 32 queued distinct documents. Same-page
    // callers share one promise; queued entries retain compressed bytes only.
    const decodes=new Map<Document,Promise<string>>();
    const decodeQueue:{document:Document;resolve:(body:string)=>void;reject:(error:unknown)=>void}[]=[];
    async function drainDecodeQueue():Promise<void>{
        if(decodeActive)return;
        const entry=decodeQueue.shift();if(!entry)return;
        decodeActive=true;
        try{
            const buffer=await gunzipAsync(entry.document.compressed,{maxOutputLength:maxPageBytes});
            if(buffer.byteLength!==entry.document.bytes)throw new DataQueryFailed('INVALID_SITEMAP_XML_SIZE');
            entry.resolve(buffer.toString('utf8'));
        }catch(error){entry.reject(error);}
        finally{decodes.delete(entry.document);decodeActive=false;void drainDecodeQueue();}
    }
    function decode(document:Document):Promise<string>{
        const existing=decodes.get(document);if(existing)return existing;
        if(decodes.size>=33)return Promise.reject(unavailable());
        let resolve!:(body:string)=>void,reject!:(error:unknown)=>void;
        const promise=new Promise<string>((yes,no)=>{resolve=yes;reject=no;});
        decodes.set(document,promise);decodeQueue.push({document,resolve,reject});
        void drainDecodeQueue();return promise;
    }
    let stats={rows:0,pages:0,compressedBytes:0,plaintextBytes:0,durationMs:0};
    const emit=(record:SitemapDiagnostic)=>{try{options.onDiagnostic?.(record);}catch{/* Diagnostic failures cannot affect publication. */}};
    async function generate():Promise<Snapshot>{
        const started=budgetNow(),children=new Map<string,Document>();
        let totalBytes=0,totalPlaintext=0,scanned=0,batches=0;
        stats={rows:0,pages:0,compressedBytes:0,plaintextBytes:0,durationMs:0};
        const check=()=>{stats.durationMs=Math.max(0,Math.round(budgetNow()-started));if(stats.durationMs>maxGenerationMs)throw overBudget();};
        const read=async(query:SQL)=>{check();const rows=await reader.rows(query);check();return rows;};
        function pages(kind:Kind){
            let number=0,parts:string[]=[],urls=0,bytes=Buffer.byteLength(XML_HEAD+XML_TAIL),lastmod='';
            const flush=async()=>{
                if(!urls)return;
                check();
                const body=XML_HEAD+parts.join('')+XML_TAIL,plainBytes=bytes,pageLastmod=lastmod,pageUrls=urls;
                // Release fragment arrays before async compression; only one page
                // is ever compressed at a time and no completed plaintext is retained.
                parts=[];urls=0;bytes=Buffer.byteLength(XML_HEAD+XML_TAIL);lastmod='';
                const compressed=await gzipAsync(body,{level:1});check();
                if(totalBytes+compressed.byteLength>maxGenerationBytes||totalPlaintext+plainBytes>maxGenerationPlaintextBytes)throw overBudget();
                totalBytes+=compressed.byteLength;totalPlaintext+=plainBytes;
                children.set(`${kind}/${++number}`,{compressed,bytes:plainBytes,lastmod:pageLastmod,urls:pageUrls});
                stats.pages=children.size;stats.compressedBytes=totalBytes;stats.plaintextBytes=totalPlaintext;
            };
            return {
                async add(entry:Entry){
                    check();
                    const fragment=`<url><loc>${escapeXml(ORIGIN+entry.path)}</loc><lastmod>${entry.lastmod}</lastmod></url>`,size=Buffer.byteLength(fragment);
                    if(size+Buffer.byteLength(XML_HEAD+XML_TAIL)>maxPageBytes)throw overBudget();
                    if(urls===maxPageUrls||bytes+size>maxPageBytes)await flush();
                    if(totalPlaintext+bytes+size>maxGenerationPlaintextBytes)throw overBudget();
                    parts.push(fragment);urls++;bytes+=size;if(entry.lastmod>lastmod)lastmod=entry.lastmod;
                },flush,
            };
        }
        const staticDate=absoluteDate(options.staticLastModified,now());
        if(staticDate){const out=pages('static');for(const path of staticPaths)await out.add({path,lastmod:staticDate});await out.flush();}
        // Snapshot ceiling is one indexed endpoint lookup, not a bucket inventory.
        // It keeps concurrent inserts from extending a generation indefinitely.
        for(const kind of ['channels','videos','tags'] as const){
            const table=kind==='channels'?'urt_channel':kind==='videos'?'urt_video':'urt_tag';
            const column=kind==='channels'?'u_id':kind==='videos'?'pk':'tag_id';
            const endpoint=(await read(sql`SELECT ${sql.identifier(column)} AS ceiling FROM ${sql.identifier(table)} ORDER BY ${sql.identifier(column)} DESC LIMIT 1`))[0]?.ceiling;
            if(endpoint===null||endpoint===undefined)continue;
            const high=positiveId(endpoint);if(!high)throw new DataQueryFailed('INVALID_SITEMAP_SOURCE_ID');
            let cursor='0';const out=pages(kind);
            while(Number(cursor)<Number(high)){
                let query:SQL;
                if(kind==='channels')query=sql`SELECT c.u_id AS cursor_id,c.u_id,c.mtime,c.ctime FROM urt_channel c WHERE c.u_id>${cursor} AND c.u_id<=${high} AND (c.flag_del IS NULL OR c.flag_del<1) ORDER BY c.u_id LIMIT ${batchSize}`;
                else if(kind==='tags')query=sql`SELECT tag_id AS cursor_id,tag_id,mtime,ctime FROM urt_tag WHERE tag_id>${cursor} AND tag_id<=${high} AND (del_flag IS NULL OR del_flag<1) ORDER BY tag_id LIMIT ${batchSize}`;
                else query=sql`SELECT v.pk AS cursor_id,v.pk,v.videoId,v.mtime,v.ctime FROM urt_video v WHERE v.pk>${cursor} AND v.pk<=${high} AND (v.title IS NULL OR v.title NOT IN ('Private video','Deleted video')) AND NOT EXISTS (SELECT 1 FROM urt_video newer WHERE newer.videoId=v.videoId AND BINARY newer.videoId=BINARY v.videoId AND newer.pk>v.pk) ORDER BY v.pk LIMIT ${batchSize}`;
                if(batches++>0&&pauseMs)await delay(pauseMs);
                const rows=await read(query);
                if(rows.length>batchSize)throw new DataQueryFailed('INVALID_SITEMAP_BATCH_SIZE');
                if(!rows.length)break;
                stats.rows=scanned+=rows.length;
                if(scanned>maxGenerationRows)throw overBudget();
                for(const row of rows){
                    const id=positiveId(row.cursor_id);
                    if(!id||Number(id)<=Number(cursor)||Number(id)>Number(high))throw new DataQueryFailed('INVALID_SITEMAP_CURSOR');
                    cursor=id;
                    const lastmod=modified(row,'taipei',now());if(!lastmod)continue;
                    let path:string|null=null;
                    if(kind==='channels'&&positiveId(row.u_id))path=`/channels/${row.u_id}`;
                    if(kind==='tags'&&positiveId(row.tag_id))path=`/tags/${row.tag_id}/channels`;
                    if(kind==='videos'&&typeof row.videoId==='string'&&/^[A-Za-z0-9_-]{11}$/.test(row.videoId)&&row.title!=='Private video'&&row.title!=='Deleted video')path=`/videos/${row.videoId}`;
                    if(path)await out.add({path,lastmod});
                }
                if(rows.length<batchSize)break;
            }
            await out.flush();
        }
        check();
        if(children.size>50_000)throw overBudget();
        const index=`<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="${NS}">${[...children].map(([key,doc])=>`<sitemap><loc>${ORIGIN}/sitemaps/${key}.xml</loc><lastmod>${doc.lastmod}</lastmod></sitemap>`).join('')}</sitemapindex>`;
        if(Buffer.byteLength(index)>8*1024*1024||totalBytes+Buffer.byteLength(index)>maxGenerationBytes||totalPlaintext+Buffer.byteLength(index)>maxGenerationPlaintextBytes)throw overBudget();
        stats.compressedBytes=totalBytes+Buffer.byteLength(index);stats.plaintextBytes=totalPlaintext+Buffer.byteLength(index);check();
        return {index,children,expires:now()+ttlMs};
    }
    function prepare():Promise<void>{
        if(pending)return pending;
        if(current&&current.expires>now())return Promise.resolve();
        if(now()<nextAttempt)return Promise.reject(unavailable());
        pending=generate().then(snapshot=>{
            const orphaned=new Map<string,Document>();
            if(current)for(const[key,doc]of current.children)if(!snapshot.children.has(key))orphaned.set(key,doc);
            previous=orphaned.size?{children:orphaned,until:now()+ttlMs}:undefined;
            current=snapshot;nextAttempt=0;emit({code:'SITEMAP_PREPARED',...stats});
        }).catch(error=>{
            nextAttempt=now()+retryMs;
            failedStatus=error instanceof DataSourceUnavailable||error instanceof SitemapFailure&&error.statusCode===503?503:500;
            const reason=error instanceof DataQueryFailed&&/^[A-Z][A-Z0-9_]{0,79}$/.test(error.driverCode)?error.driverCode:error instanceof SitemapFailure?'SITEMAP_CAPACITY':failedStatus===503?'SITEMAP_DATA_SOURCE_UNAVAILABLE':'SITEMAP_QUERY_FAILED';
            emit({code:'SITEMAP_PREPARATION_FAILED',reason,...stats});throw error;
        }).finally(()=>{pending=undefined;});
        return pending;
    }
    function refresh(){if(!pending&&now()>=nextAttempt)void prepare().catch(()=>{/* No incomplete generation or error details are published. */});}
    return {
        /** Explicit warm-up for the canary/operator, never a new write-capable job. */
        prepare,start:refresh,ready:()=>current!==undefined,
        async read(kind?:string,page?:string):Promise<string>{
            if(kind!==undefined&&(!kinds.includes(kind as Kind)||!page||!/^[1-9]\d{0,4}$/.test(page)))throw notFound();
            if(!current){if(kind===undefined)refresh();throw new SitemapFailure(failedStatus,'Sitemap snapshot is not prepared.');}
            // Capture one complete family before a background refresh can publish.
            const snapshot=current;
            if(kind===undefined){if(snapshot.expires<=now())refresh();return snapshot.index;}
            if(previous&&previous.until<=now())previous=undefined;
            const child=snapshot.children.get(`${kind}/${page}`)??previous?.children.get(`${kind}/${page}`);
            if(!child)throw notFound();
            return decode(child);
        },
    };
}

/** Register before the frontend wildcard proxy. Fastify supplies matching HEAD routes. */
export function registerSitemaps(app: FastifyInstance, reader: Reader, options: SitemapOptions = {}) {
    const sitemaps = createSitemaps(reader, {...options,onDiagnostic:options.onDiagnostic??(record=>{
        if(!process.stderr.writableNeedDrain)process.stderr.write(JSON.stringify(record)+'\n');
    })});
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
    return sitemaps;
}
