import {homeResultCache} from './home-result-cache.js';
import {matchingRuleForSnapshot} from '../../../shared/youtube-match-policy.js';
import {maintainedKeywordIdentities} from './keyword-alias.js';
import {enrichKeywordEvidence} from './keyword-evidence.js';
import {keywordCandidateSource, keywordIdentityPredicate, latestKeywordVideo} from './keyword-candidates.js';
import {keywordVideoCache} from './keyword-video-cache.js';
import {createHash} from 'node:crypto';
import {eventReport} from './event-report.js';
import {VIDEO_LIST_MAX} from '../../../shared/video-listing.js';
import {enrichVideoListings} from './video-listing.js';
import {currentLive} from './live-current.js';
import { readAiDaily } from './daily-report.js';
import {loadVideoComments,summarizeVideoComments} from './video-analytics.js';
import { CHANNEL_SORTS, type ChannelRankingScope, type ChannelSort } from '../../../shared/channel-ranking.js';
import { optionalChannelAi } from './channel-ai.js';
import { homeExploration } from './home-exploration.js';
import { sql, type SQL } from 'drizzle-orm';
import { DataQueryFailed, DataSourceUnavailable, type Reader, type Row } from '../db/client.js';
import type { ChannelData, ChannelRow, ChannelCollection, Collection, HomeData, LiveRow, TagRow, VideoData, VideoRow, VideoCollection, AiDaysData, AiEventData } from '../contracts.js';
import { channel, integer, latest, list, object, tags, text, timestamp, video, taipeiDate, taipeiSql, tagIds } from './normalize.js';
import { BadQuery, NotFound, page, tagFilter, search, positiveId, idList, dateFilter, bounded } from './query.js';
import type { Query } from './query.js';
import { videoTextDigest } from './video-digest.js';
import { dailyLineage } from './ai-lineage.js';
import { buildTopics } from './topics.js';
export interface ReportService {
    channels(query?: Query, scope?: ChannelRankingScope): Promise<ChannelCollection>;
    channel(id: number): Promise<ChannelData>;
    videos(query?: Query,scope?:'taxonomy'): Promise<VideoCollection>;
    video(id: string): Promise<VideoData>;
    live(query?: Query): Promise<Collection<LiveRow>>;
    tags(query?: Query): Promise<Collection<TagRow>>;
    aiDays(query?: Query): Promise<AiDaysData>;
    aiEvent(id: number, event?: string): Promise<AiEventData>;
    home(query?: Query): Promise<HomeData>;
}
const channelSelect = sql `c.u_id,c.youtube_id,c.title,c.thumbnails,c.description,c.publishedAt,c.mtime,c.stime,c.ctime,
  CASE WHEN n.u_id IS NULL THEN c.viewCount ELSE n.viewCount END AS viewCount,CASE WHEN n.u_id IS NULL THEN c.subscriberCount ELSE n.subscriberCount END AS subscriberCount,
  CASE WHEN n.u_id IS NULL THEN c.videoCount ELSE n.videoCount END AS videoCount,n.view_week,n.view_month,n.sub_week,n.sub_month,n.video_week,n.video_month,n.views_pred_week,n.views_pred_month,n.tags,n.mtime AS count_mtime`;
export function reports(reader: Reader, clock: () => Date = () => new Date()): ReportService {
    const cachedHome=homeResultCache();
    const cachedKeywordVideos=keywordVideoCache<VideoCollection>({cacheable:(value,query)=>query.cursor===undefined&&value.totalStatus!=='unavailable'&&value.evidenceCoverage?.coverageStatus!=='unavailable'});
    const names = async () => new Map((await reader.rows(sql `SELECT tag_id,tag_name FROM urt_tag ORDER BY tag_id`)).map(r => [integer(r.tag_id) ?? 0, text(r.tag_name)]));
    const channelWhere = (query: Query): SQL => {
        const term = search(query.q);
        return sql `(c.flag_del IS NULL OR c.flag_del<1) AND ${tagFilter(query)} ${term ? sql `AND (c.title LIKE ${term} ESCAPE '=' OR c.youtube_id LIKE ${term} ESCAPE '=')` : sql ``}`;
    };
    const channelsRows = async (query: Query = {}, scope: ChannelRankingScope = 'directory'): Promise<ChannelCollection> => {
        const { limit, offset } = page(query);
        const column=query.column===undefined||query.column===''?(scope==='tag'?'view_month':'view_week'):query.column;
        if(typeof column!=='string'||!CHANNEL_SORTS.some(([key])=>key===column))throw new BadQuery('Invalid channel sort column.');
        const min=query.min===undefined||query.min===''?(scope==='tag'?0:null):bounded(query.min,0,0,Number.MAX_SAFE_INTEGER);
        const minMetric=idList(query.or).length?'views':'subscribers',minColumn=minMetric==='views'?'viewCount':'subscriberCount';
        const metric=(key:string)=>['viewCount','subscriberCount','videoCount'].includes(key)&&scope==='directory'?sql`CASE WHEN n.u_id IS NULL THEN ${sql.identifier('c')}.${sql.identifier(key)} ELSE ${sql.identifier('n')}.${sql.identifier(key)} END`:sql`${sql.identifier('n')}.${sql.identifier(key)}`;
        const where=sql`${channelWhere(query)} ${scope==='tag'?sql`AND n.u_id IS NOT NULL`:sql``} ${min===null?sql``:sql`AND ${metric(minColumn)}>=${min}`}`;
        const order=metric(column);
        const [rows, count, tagNames] = await Promise.all([
            reader.rows(sql `SELECT ${channelSelect} FROM urt_channel c LEFT JOIN urt_count n ON n.u_id=c.u_id WHERE ${where} ORDER BY ${order} DESC,c.u_id LIMIT ${limit} OFFSET ${offset}`),
            reader.rows(sql `SELECT COUNT(*) AS total FROM urt_channel c LEFT JOIN urt_count n ON n.u_id=c.u_id WHERE ${where}`), names(),
        ]);
        return { rows: rows.map(r => channel(r, tagNames)), total: integer(count[0]?.total) ?? 0, limit, offset, ranking:{column:column as ChannelSort,scope,min,minMetric}, evidenceCoverage:{rankingColumn:column,minimum:min,minimumMetric:minMetric,rankingScope:scope} };
    };
    const videoRows = async (query: Query = {},requestedScope?:'taxonomy'): Promise<VideoCollection> => {
        const limit=bounded(query.limit,50,1,VIDEO_LIST_MAX),offset=bounded(query.offset,0,0,100000), term = search(query.q), ids = idList(query.channelIds),now=clock();
        if (ids.length > 20)
            throw new BadQuery('Select at most 20 channels.');
        const optional = (value: unknown) => value === '' ? undefined : value;
        const channelId = optional(query.channelId) === undefined ? null : positiveId(query.channelId);
        const from = dateFilter(optional(query.from)), to = dateFilter(optional(query.to));
        const hours = optional(query.hours) === undefined ? null : bounded(query.hours, 24, 1, 8760);
        const min = optional(query.min) === undefined ? null : bounded(query.min, 0, 0, Number.MAX_SAFE_INTEGER);
        const column = optional(query.column) ?? 'publishedAt';
        if (typeof column !== 'string' || !['publishedAt', 'viewCount', 'likeCount', 'commentCount'].includes(column)) throw new BadQuery('Invalid video sort column.');
        const keyword = query.keyword === undefined ? null : text(query.keyword);
        if (keyword !== null && (!keyword || keyword.length > 240))
            throw new BadQuery('Invalid vocabulary term.');
        if (from && to && from > to)
            throw new BadQuery('from must not follow to.');
        const days=keyword&&optional(query.days)!==undefined?bounded(query.days,7,1,90):null,dayFrom=days===null?null:new Date(Date.parse(taipeiDate(now))-days*86400000).toISOString().slice(0,10);
        const scope = sql `${tagFilter(query)} ${requestedScope==='taxonomy'?sql`AND n.u_id IS NOT NULL`:sql``}
      ${channelId === null ? sql `` : sql `AND v.u_id=${channelId}`}
      ${ids.length ? sql `AND v.u_id IN (${sql.join(ids.map(v => sql `${v}`), sql `, `)})` : sql ``}
      ${term ? sql `AND (v.title LIKE ${term} ESCAPE '=' OR v.description LIKE ${term} ESCAPE '=')` : sql ``}
      ${from ? sql `AND v.publishedAt>=${from + ' 00:00:00'}` : sql ``}
      ${to ? sql `AND v.publishedAt<=${to + ' 23:59:59'}` : sql ``}
      ${hours === null ? sql `` : sql `AND v.publishedAt>=${taipeiSql(new Date(now.getTime() - hours * 3600000))}`}
      ${min === null ? sql `` : sql `AND v.viewCount>=${min}`}
      ${dayFrom===null?sql``:sql`AND v.publishedAt>=${dayFrom+' 00:00:00'} AND v.publishedAt<=${taipeiDate(now)+' 23:59:59'}`}`;
        const pinned = keyword ? (await reader.rows(sql `SELECT c.run_id,JSON_UNQUOTE(JSON_EXTRACT(r.snapshot,'$.matchingRule')) AS matching_rule FROM ts_vocabulary_current c JOIN ts_vocabulary_runs r ON r.id=c.run_id AND r.status='published' WHERE c.source='https://tag.observe.tw' LIMIT 1`))[0] : undefined;
        const version=pinned?text(pinned.run_id)||null:null,rule=matchingRuleForSnapshot({matchingRule:pinned?.matching_rule??undefined});
        if (keyword && !version)
            return { rows: [], total: 0, hasNext:false,totalStatus:'exact',limit, offset, evidenceCoverage: { status: 'not-synchronized', vocabularyVersion: null } };
        const fresh = sql `m.rule_version=${rule} AND m.source_pk=v.pk AND BINARY m.source_text_sha256=BINARY ${videoTextDigest()}`;
        // utf8mb4_bin still uses PAD SPACE equality; an upstream label with a
        // trailing space must not match another exact vocabulary identity.
        const keywordKey=keyword?createHash('sha256').update('https://tag.observe.tw\0'+keyword).digest('hex'):null;
        const identities=keyword&&version?await maintainedKeywordIdentities(reader,version,keyword):[];
        const evidence = sql `EXISTS(SELECT 1 FROM ts_video_tag_evidence e WHERE e.video_id=m.video_id AND BINARY e.video_id=BINARY m.video_id AND e.vocabulary_version=${version} AND e.rule_version=${rule} AND ${keywordIdentityPredicate(identities)})`;
        const where = sql `${scope} ${keyword ? sql `AND EXISTS(SELECT 1 FROM ts_video_tag_matches m WHERE m.video_id=CONVERT(v.videoId USING ascii) AND BINARY m.video_id=BINARY v.videoId AND m.vocabulary_version=${version} AND ${fresh} AND ${evidence}) AND ${latestKeywordVideo()}` : sql ``}`;
        const fields=sql`v.pk,v.videoId,v.u_id,LEFT(v.channelId,128) AS channelId,LEFT(v.channelTitle,256) AS channelTitle,LEFT(v.title,512) AS title,LEFT(v.thumbnails,2048) AS thumbnails,v.publishedAt,v.viewCount,v.likeCount,v.commentCount,v.dislikeCount,v.mtime,v.ctime,LEFT(n.tags,4096) AS tags`;
        const order=sql`${sql.identifier('v')}.${sql.identifier(column)} DESC,v.pk DESC`;
        const source=keyword ? keywordCandidateSource(version!, keywordKey!, keyword,identities) : sql`FROM urt_video v LEFT JOIN urt_count n ON n.u_id=v.u_id`;
        const selection=async():Promise<{rows:Row[];hasNext:boolean}>=>{
            // The single-column metric index can stop at the requested boundary.
            // Include every tie at that boundary before applying the original pk
            // tie-break; sorting only the first N metric rows would lose ties.
            const metric=sql`${sql.identifier('v')}.${sql.identifier(column)}`;
            const boundary=(await reader.rows(sql`SELECT MIN(boundary.sort_value) AS cutoff,COUNT(*) AS selected,COALESCE(SUM(boundary.sort_value IS NULL),0) AS nulls FROM (SELECT STRAIGHT_JOIN ${metric} AS sort_value ${source} WHERE ${where} ORDER BY ${metric} DESC LIMIT ${offset+limit+1}) boundary`))[0];
            const selected=integer(boundary?.selected),nulls=integer(boundary?.nulls);
            if(selected===null||nulls===null||selected<0||selected>offset+limit+1||nulls<0||nulls>selected)throw new DataQueryFailed('INVALID_VIDEO_BOUNDARY');
            if(selected<=offset)return {rows:[],hasNext:false};
            const cutoff=boundary?.cutoff;
            if(cutoff===null&&nulls!==selected||cutoff===undefined)throw new DataQueryFailed('INVALID_VIDEO_BOUNDARY');
            // DESC sorts NULL last. If the boundary includes NULL, retain those
            // ties as well; a large tie partition is still subject to the SQL deadline.
            const range=cutoff===null?sql`${metric} IS NULL`:nulls?sql`(${metric}>=${cutoff} OR ${metric} IS NULL)`:sql`${metric}>=${cutoff}`;
            // Recheck source text/taxonomy/evidence: Laravel may update between
            // statements. No cross-statement source snapshot is claimed.
            const rows=await reader.rows(sql`SELECT ${fields} ${source} WHERE ${where} AND ${range} ORDER BY ${order} LIMIT ${limit+1} OFFSET ${offset}`);
            return {rows:rows.slice(0,limit),hasNext:rows.length>limit};
        };
        const count=async():Promise<{total:number|null;totalStatus:VideoCollection['totalStatus']}>=>{
            // Exact substring counts require scanning the full text table and can
            // exceed the production deadline. Never invent a total from page size.
            if(term)return {total:null,totalStatus:'not-computed'};
            try{const rows=await reader.rows(sql`SELECT COUNT(*) AS total ${source} WHERE ${where}`);return {total:integer(rows[0]?.total)??0,totalStatus:'exact'};}
            catch(error){if(error instanceof DataSourceUnavailable)return {total:null,totalStatus:'unavailable'};throw error;}
        };
        // The unbounded historical coverage scan is independent of the indexed
        // keyword result and can hash every description in the archive. Do not
        // run it on a public cache miss; a bounded period can request coverage.
        const omitHistoricalCoverage=!!keyword&&!from&&!dayFrom&&hours===null&&channelId===null;
        const coverage=async():Promise<Row[]|null>=>{
            if(!keyword)return [];
            if(omitHistoricalCoverage)return null;
            try{return await reader.rows(sql `SELECT COUNT(*) AS sourceVideos,COALESCE(SUM(m.video_id IS NULL),0) AS unprocessedVideos,COALESCE(SUM(m.video_id IS NOT NULL AND (${fresh})),0) AS freshVideos,COALESCE(SUM(m.video_id IS NOT NULL AND NOT(${fresh})),0) AS staleVideos FROM urt_video v LEFT JOIN urt_count n ON n.u_id=v.u_id LEFT JOIN ts_video_tag_matches m ON m.video_id=CONVERT(v.videoId USING ascii) AND BINARY m.video_id=BINARY v.videoId AND m.vocabulary_version=${version} WHERE ${scope} AND ${latestKeywordVideo()}`);}
            catch(error){if(error instanceof DataSourceUnavailable)return null;throw error;}
        };
        const [selected, counted, coverageRows] = await Promise.all([selection(),count(),coverage()]);
        const {rows,hasNext}=selected,{total,totalStatus}=counted;
        const c = coverageRows?.[0];
        const listingScope=keyword?'keyword':requestedScope??(channelId!==null?'channel':idList(query.tagid).length||idList(query.or).length||idList(query.not).length?'taxonomy':'general');
        const enriched=await enrichVideoListings(reader,rows,listingScope,listingScope==='taxonomy'?await names():new Map());
        if(keyword&&version)await enrichKeywordEvidence(reader,enriched,version,rule,identities);
        return { rows: enriched, total,hasNext,totalStatus, limit, offset,evidenceCoverage:{totalStatus,...(keyword? { status: 'synchronized', vocabularyVersion: version, coverageStatus:omitHistoricalCoverage?'not-calculated':coverageRows===null?'unavailable':'available',sourceVideos:coverageRows===null?null:integer(c?.sourceVideos) ?? 0, freshVideos:coverageRows===null?null:integer(c?.freshVideos) ?? 0, staleVideos:coverageRows===null?null:integer(c?.staleVideos) ?? 0, unprocessedVideos:coverageRows===null?null:integer(c?.unprocessedVideos) ?? 0, keywordMatchedVideos: total }:{})} };
    };
    const liveRows = (query: Query = {}) => currentLive(reader,query,clock,names);
    const tagRows = async (query: Query = {}): Promise<Collection<TagRow>> => {
        const { limit, offset } = page(query), tagNames = await names();
        const sortKeys = {num:'channels',total:'weeklyViews',ave:'average',median:'median'} as const;
        const sort = query.sort === undefined || query.sort === '' ? 'num' : query.sort;
        if (typeof sort !== 'string' || !Object.hasOwn(sortKeys, sort)) throw new BadQuery('Invalid category sort.');
        const sortKey = sortKeys[sort as keyof typeof sortKeys];
        const counts = await reader.rows(sql `SELECT tags,view_week FROM urt_count WHERE view_week>=${bounded(query.min === '' ? undefined : query.min, 10, 0, 2147483647)} ORDER BY u_id LIMIT 100001`);
        if (counts.length > 100000) throw Object.assign(new Error('Category aggregation exceeds 100000 channels.'),{statusCode:422});
        const values = new Map<number, number[]>();
        for (const row of counts) {
            const views = integer(row.view_week);
            if (views === null || views < 0) throw Object.assign(new Error('Category views exceed safe precision.'),{statusCode:422});
            for (const id of tagIds(row.tags)) {
                const bucket = values.get(id) ?? []; bucket.push(views); values.set(id, bucket);
            }
        }
        const rows = [...values].map(([id, views]) => { views.sort((a, b) => a - b); const sum = views.reduce((a, b) => a + b, 0), middle = Math.floor(views.length / 2); return { id, name: tagNames.get(id) ?? String(id), kind: 'channel' as const, channels: views.length, weeklyViews: sum, average: sum / views.length, median: views.length % 2 ? views[middle]! : ((views[middle - 1] ?? 0) + (views[middle] ?? 0)) / 2 }; });
        if (rows.some(row => !Number.isSafeInteger(row.weeklyViews))) throw Object.assign(new Error('Category sum exceeds safe precision.'),{statusCode:422});
        rows.sort((a, b) => b[sortKey] - a[sortKey] || a.id - b.id);
        return { rows: rows.slice(offset, offset + limit), total: rows.length, limit, offset };
    };
    const aiDays = async (query: Query = {}) => readAiDaily(reader,query);
    const api: ReportService = {
        channels: channelsRows, videos: (query={},scope)=>query.keyword===undefined?videoRows(query,scope):cachedKeywordVideos(query,scope,()=>videoRows(query,scope)), live: liveRows, tags: tagRows, aiDays,
        channel: async (id) => {
            const r = (await reader.rows(sql `SELECT ${channelSelect} FROM urt_channel c LEFT JOIN urt_count n ON n.u_id=c.u_id WHERE c.u_id=${id} AND (c.flag_del IS NULL OR c.flag_del<1) LIMIT 1`))[0];
            if (!r)
                throw new NotFound();
            const [aiSummary,dailySummary,trend,videos,tagNames]=await Promise.all([optionalChannelAi(reader,id,'overview'),optionalChannelAi(reader,id,'daily'),reader.rows(sql`SELECT EXISTS(SELECT 1 FROM urt_log WHERE u_id=${id} LIMIT 1) AS present`),videoRows({channelId:String(id),limit:'50'}),names()]);
            return { channel:channel(r,tagNames),videos:videos.rows,aiSummary,dailySummary,trendAvailable:integer(trend[0]?.present)===1 };
        },
        video: async (id) => {
            const r = (await reader.rows(sql `SELECT * FROM urt_video WHERE videoId=${id} AND BINARY videoId=BINARY ${id} ORDER BY pk DESC LIMIT 1`))[0];
            if (!r)
                throw new NotFound();
            const [durations, logs, liveLogs,comments] = await Promise.all([reader.rows(sql `SELECT duration,caption FROM urt_video_duration WHERE videoId=${id} AND BINARY videoId=BINARY ${id} ORDER BY pk_video DESC LIMIT 1`), reader.rows(sql `SELECT themonth,thedata FROM urt_video_log WHERE videoId=${id} AND BINARY videoId=BINARY ${id} ORDER BY themonth DESC LIMIT 120`), reader.rows(sql `SELECT the_date,log_json FROM urt_video_live_log WHERE videoId=${id} AND BINARY videoId=BINARY ${id} ORDER BY the_date DESC,pk DESC LIMIT 366`),loadVideoComments(reader,id)]);
            const history = new Map<string, VideoData['history'][number]>();
            for (const log of logs)
                for (const [date, value] of Object.entries(object(log.thedata))) {
                    const o = object(value);
                    if (!history.has(date))
                        history.set(date, { date, views: integer(o.view), likes: integer(o.like), comments: integer(o.comment), measured: true });
                }
            const liveHistory = new Map<string, VideoData['liveHistory'][number]>();
            for (const log of liveLogs)
                for (const [time, value] of Object.entries(object(log.log_json))) {
                    const viewers = integer(value), at = timestamp(`${text(log.the_date).slice(0, 10)} ${time.length === 5 ? time + ':00' : time}`);
                    if (at && viewers !== null && !liveHistory.has(at))
                        liveHistory.set(at, { time: at, viewers, measured: true });
                }
            const caption = durations[0]?.caption;
            return { video: video(r), commentSummary:summarizeVideoComments(comments[0]), durationSeconds: integer(durations[0]?.duration), captionAvailable: caption == null ? null : caption === 'true' || caption === '1', history: [...history.values()].sort((a, b) => a.date.localeCompare(b.date)), liveHistory: [...liveHistory.values()].sort((a, b) => a.time.localeCompare(b.time)) };
        },
        aiEvent: (id,event)=>eventReport(reader,aiDays,id,event),
        home: () => cachedHome(async () => {
            const [channels, tags, live, days, exploration, totals] = await Promise.all([channelsRows({ limit: '12' }), tagRows({ limit: '20' }).then(v => ({rows:v.rows,status:'available' as const})).catch(error => {if(error?.statusCode===422)return {rows:[],status:'bounded' as const};throw error;}), liveRows({ limit: '20' }), aiDays(), homeExploration(reader, clock()), reader.rows(sql `SELECT (SELECT COUNT(*) FROM urt_channel WHERE flag_del IS NULL OR flag_del<1) AS channels,(SELECT COUNT(*) FROM urt_video) AS videos,(SELECT COALESCE(SUM(view_week),0) FROM urt_count) AS weeklyViews,(SELECT COUNT(DISTINCT u_id) FROM urt_video_live WHERE actualEndTime IS NULL AND concurrentViewers>0 AND mtime>=${taipeiSql(new Date(clock().getTime() - 3600000))}) AS liveChannels,(SELECT COALESCE(SUM(concurrentViewers),0) FROM urt_video_live WHERE actualEndTime IS NULL AND concurrentViewers>0 AND mtime>=${taipeiSql(new Date(clock().getTime() - 3600000))}) AS liveViewers`)]);
            const t = totals[0] ?? {};
            return { exploration, summary: { channels: integer(t.channels) ?? 0, videos: integer(t.videos) ?? 0, weeklyViews: integer(t.weeklyViews) ?? 0, liveChannels: integer(t.liveChannels) ?? 0, liveViewers: integer(t.liveViewers) ?? 0 }, channels: channels.rows, tags: tags.rows, tagsStatus:tags.status, live: live.rows, events: days.rows, aiDate: days.date };
        }),
    };
    return api;
}
