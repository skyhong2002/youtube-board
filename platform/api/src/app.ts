import {trustedProxies} from './trusted-proxy.js';
import {RateLimitError} from './rate-limit.js';
import {enrichPublicMedia} from './reports/media.js';
import {registerMediaAssets} from './media-assets/index.js';
import {channelHistoryPaths,channelIdentityCoverage,readChannelIdentity,type ChannelIdentity} from './reports/channel-identity.js';
import {AuthStoreFailure} from './auth/store.js';
import { registerFilterOptions } from './reports/filter-options.js';
import { registerAiEventHistory } from './reports/ai-event-history.js';
import { registerVideoAnalytics } from './reports/video-analytics.js';
import { registerEditorialPublic } from './reports/editorial.js';
import { registerPromptPreview } from './reports/prompt-preview.js';
import { registerEventExtra } from './reports/event-extra.js';
import { registerMayorPerson } from './reports/mayor-person.js';
import { registerLiveWall } from './reports/live-wall.js';
import { registerComparisons } from './reports/comparison.js';
import { registerLiveExtra } from './reports/live-extra.js';
import { registerLegacyApi } from './legacy/index.js';
import { registerAuthors } from './reports/author.js';
import { registerAspects } from './reports/aspects.js';
import { registerGroups } from './reports/groups.js';
import { registerMayor } from './reports/mayor.js';
import { registerLiveHistory } from './reports/live-history.js';
import { registerAiHistory } from './reports/ai-history.js';
import { registerCloud } from './reports/cloud.js';
import { registerTagDays } from './reports/tag-days.js';
import { registerComments } from './reports/comments.js';
import { registerChannelHistory } from './reports/channel-history.js';
import Fastify from 'fastify';
import { sql } from 'drizzle-orm';
import { createReader, DataSourceUnavailable, DataQueryFailed, type Reader } from './db/client.js';
import { reports } from './reports/service.js';
import { addVocabularyQualityNotice } from './reports/vocabulary-quality.js';
import { vocabulary, videoTagEvidence } from './reports/vocabulary.js';
import { BadQuery, NotFound, mergeTagId, positiveId, videoId, type Query } from './reports/query.js';
import { latest, integer, text, object } from './reports/normalize.js';
import type { ReportMeta } from './contracts.js';
export const routeRegistry = [
    '/home', '/channels', '/channels/:id', '/channels/:id/videos', '/videos', '/videos/:id', '/videos/:id/tags',
    '/live/current', '/tags', '/tags/:id/channels', '/tags/:id/videos', '/ai/days', '/ai/events/:id', '/vocabulary', '/keywords',
] as const;
interface AppOptions {
    reader?: Reader;
    databaseUrl?: string;
    dataset?: 'fixture' | 'live' | 'unknown';
    clock?: () => Date;
}
export function buildApp(options: AppOptions = {}) {
    const app = Fastify({ logger: false, trustProxy: trustedProxies(process.env.AUTH_TRUSTED_PROXY_CIDRS), requestTimeout: 15000, bodyLimit: 16384 }), reader = options.reader ?? createReader(options.databaseUrl ?? process.env.DATABASE_URL), clock = options.clock ?? (() => new Date()), service = reports(reader, clock);
    app.addHook('onSend', async (_request, reply, payload) => { reply.header('Strict-Transport-Security','max-age=31536000'); return payload; });
    const meta = (data: unknown): ReportMeta => ({ schemaVersion: 1, requestedAt: clock().toISOString(), updatedAt: deepUpdatedAt(data), timezone: 'Asia/Taipei', source: 'mariadb', dataset: options.dataset ?? (process.env.DATASET_KIND === 'fixture' ? 'fixture' : 'unknown'), coverage: {}, warnings: [] });
    registerMediaAssets(app);
    const registered: string[] = [];
    const register = (path: string, handler: (params: Record<string, string>, query: Query, channel?:ChannelIdentity) => Promise<unknown>) => {
        registered.push('/api/v1' + path);
        return app.get(`/api/v1${path}`, async (request, reply) => {
            const params=request.params as Record<string,string>;
            const channel=channelHistoryPaths.has(path)?await readChannelIdentity(reader,positiveId(params.id)):undefined;
            const data = await handler(params, request.query as Query,channel);
            await enrichPublicMedia(reader, data);
            const m = meta(data), record = object(data);
            if (record.evidenceCoverage && typeof record.evidenceCoverage === 'object')
                m.coverage = record.evidenceCoverage as ReportMeta['coverage'];
            if(channel)m.coverage={...m.coverage,...channelIdentityCoverage(channel)};
            if (path === '/vocabulary' || path === '/keywords') {
                m.updatedAt = text(record.publishedAt) || null;
                m.coverage = { scope: text(record.coverage), totalTerms: integer(record.total), upstreamSnapshotConsistent: record.upstreamSnapshotConsistent === true };
                addVocabularyQualityNotice(m, record.sourceQuality);
                m.warnings.push(record.coverage === 'all-current-indexed-article-tags' ? '上游目前已索引文章完整詞彙快照；來源未逐詞區分記者、編輯或規則補標。' : '觀測期間文章標籤；不代表上游完整詞典，來源未逐詞區分記者、編輯或規則補標。');
            }
            if (path === '/home') {
                const exploration=object(record.exploration);addVocabularyQualityNotice(m,object(exploration.keywords).sourceQuality);for(const key of ['categories','keywords'])if(object(exploration[key]).status==='unavailable')m.warnings.push(key==='categories'?'分類統計目前無法完整讀取。':'關鍵字統計目前無法完整讀取。');
            }
            if (path === '/ai/days') {
                m.coverage = { ...m.coverage, rawVideoRows: integer(record.rawVideoRows), sourceChannels: integer(record.sourceChannels), channels: integer(record.channels) };
                m.warnings.push(record.source==='channel-summaries'?'本頁以既有頻道摘要的共同訊號重新分組；不是新生成的 AI 摘要，也不代表已證實為同一事件。影片引用數可跨議題重複。':'本頁讀取既有每日彙整；影片引用數可跨議題重複。');
            }
            if (path === '/tags' || path.startsWith('/tags/:id'))
                m.warnings.push('此處為 YouTube 頻道分類；共用新聞內容詞彙請見 /vocabulary。');
            if (m.dataset === 'fixture')
                m.warnings.push('此環境使用合成範例 YouTube 資料。');
            reply.header('Cache-Control', 'public, max-age=15');
            return { data, meta: m };
        });
    };
    app.get('/up', async () => ({ status: 'ok', service: 'youtube-board-api' }));
    app.get('/healthz', async () => ({ status: 'ok', service: 'youtube-board-api' }));
    app.get('/ready', async (_req, reply) => {
        try {
            await reader.rows(sql `SELECT 1 AS available`);
            return { status: 'ready' };
        }
        catch {
            reply.code(503);
            return { status: 'unavailable' };
        }
    });
    app.get('/api/v1/status', async () => ({ data: { routes: registered, readOnly: true }, meta: meta(null) }));
    registerFilterOptions(register, reader);
    register('/home', () => service.home());
    register('/channels', (_p, q) => service.channels(q));
    register('/channels/:id', (p) => service.channel(positiveId(p.id)));
    register('/channels/:id/videos', (p, q) => service.videos({ ...q, channelId: String(positiveId(p.id)) }));
    register('/tags/videos', (_p, q) => service.videos(q,'taxonomy'));
    register('/videos', (_p, q) => service.videos(q));
    register('/keywords/:keyword/videos', (p, q) => service.videos({ ...q, keyword: p.keyword }));
    register('/videos/:id', (p) => service.video(videoId(p.id)));
    register('/videos/:id/tags', (p) => videoTagEvidence(reader, videoId(p.id)));
    register('/live/current', (_p, q) => service.live(q));
    register('/tags', (_p, q) => service.tags(q));
    register('/tags/:id/channels', (p, q) => service.channels({ ...q, tagid: mergeTagId(q.tagid, positiveId(p.id)) }, 'tag'));
    register('/tags/:id/videos', (p, q) => service.videos({ ...q, tagid: mergeTagId(q.tagid, positiveId(p.id)) },'taxonomy'));
    register('/ai/days', (_p, q) => service.aiDays(q));
    register('/ai/events/:id', (p, q) => {
        if (q.event !== undefined && (typeof q.event !== 'string' || q.event.length > 256))
            throw new BadQuery('Invalid event name.');
        return service.aiEvent(positiveId(p.id), q.event as string | undefined);
    });
    register('/ai/days/:id/events', (p, q) => {
        if (typeof q.event !== 'string' || !q.event.trim() || q.event.length > 256)
            throw new BadQuery('Provide an event name.');
        return service.aiEvent(positiveId(p.id), q.event);
    });
    register('/vocabulary', (_p, q) => vocabulary(reader, q));
    // Content keywords now originate from the maintained upstream vocabulary.
    register('/keywords', (_p, q) => vocabulary(reader, q));
    registerVideoAnalytics(register, reader);
    registerAuthors(register, reader);
    registerAspects(register, reader);
    registerGroups(register, reader, clock);
    registerMayor(register, reader, clock);
    registerMayorPerson(register, reader, clock);
    registerEditorialPublic(register, reader);
    registerPromptPreview(register, reader, clock);
    registerEventExtra(register, service);
    registerAiEventHistory(register, reader);
    registerLiveHistory(register, reader, clock);
    registerLiveExtra(register, reader, clock);
    registerLiveWall(register);
    registerComparisons(register, reader, clock);
    registerAiHistory(register, reader, clock);
    registerCloud(register, reader, clock);
    registerTagDays(register, reader, clock);
    registerComments(register, reader, clock);
    registerChannelHistory(register, reader, clock);
    registerLegacyApi(app, reader, clock, options.dataset ?? (process.env.DATASET_KIND === 'fixture' ? 'fixture' : 'unknown'));
    app.setNotFoundHandler((request, reply) => {
        if (request.method !== 'GET' && request.method !== 'HEAD')
            return reply.code(405).send({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Only read-only GET requests are supported.' } });
        reply.code(request.url.startsWith('/api/v1/') ? 501 : 404).send({ error: { code: request.url.startsWith('/api/v1/') ? 'REPORT_NOT_IMPLEMENTED' : 'NOT_FOUND', message: request.url.startsWith('/api/v1/') ? 'This report has not yet been migrated to the TypeScript API.' : 'Route not found.' } });
    });
    app.setErrorHandler((error, _request, reply) => {
        if(error instanceof RateLimitError)return reply.header('Cache-Control','private, no-store').header('Retry-After',String(error.retryAfter)).code(429).send({error:{code:'RATE_LIMITED'}});
        if(error instanceof AuthStoreFailure)return reply.header('Cache-Control','private, no-store').code(503).send({error:{code:'AUTH_UNAVAILABLE'}});
        const status = (error as {
            statusCode?: number;
        }).statusCode;
        const code = error instanceof BadQuery ? 400 : error instanceof NotFound ? 404 : error instanceof DataSourceUnavailable ? 503 : status && status >= 400 && status < 500 ? status : 500;
        const key = code === 400 ? 'INVALID_QUERY' : code === 404 ? 'NOT_FOUND' : code === 503 ? 'DATA_SOURCE_UNAVAILABLE' : code < 500 ? 'INVALID_REQUEST' : 'INTERNAL_ERROR';
        const message = error instanceof BadQuery || error instanceof NotFound ? error.message : code === 503 ? 'Dashboard data source is unavailable. Check the database connection and access permissions.' : 'The request could not be completed.';
        if (code === 500)
            process.stderr.write(`youtube-board-api: internal request error${error instanceof DataQueryFailed ? ' [' + error.driverCode + ']' : ''}\n`);
        reply.code(code).header('Cache-Control', 'no-store').send({ error: { code: key, message } });
    });
    app.addHook('onClose', async () => reader.close());
    return app;
}
/** Freshness is derived only from source timestamps carried by report rows. */
function deepUpdatedAt(value: unknown): string | null {
    if (!value || typeof value !== 'object')
        return null;
    if (Array.isArray(value))
        return latest(...value.map(deepUpdatedAt));
    const row = value as Record<string, unknown>;
    return latest(row.updatedAt, ...Object.entries(row).filter(([k]) => k !== 'updatedAt').map(([, v]) => deepUpdatedAt(v)));
}
