import {sql} from 'drizzle-orm';
import {DataSourceUnavailable,type Reader,type Row} from '../db/client.js';
import type {HomeExploration,HomeKeywordSummary,TagRow} from '../contracts.js';
import {integer,tagIds,text,object,taipeiDate,taipeiSql,timestamp,latest} from './normalize.js';
import {vocabularySourceQuality} from './vocabulary-quality.js';
import {videoTextDigest} from './video-digest.js';
class HomeSectionUnavailable extends Error {constructor(public reason:'source-cap'|'precision'){super(reason);}}
function measuredCount(value:unknown){const result=integer(value);if(result===null||result<0)throw new HomeSectionUnavailable('precision');return result;}
/** Laravel homepage's top-eight category scope. Membership sums deliberately overlap.
 * updatedAt describes the complete category source scan used to determine the top eight. */
export function homeCategories(records:Row[],names:Map<number,string>){
 const stats=new Map<number,{views:number[];ids:Set<number>}>();
 for(const r of records){const views=integer(r.view_week),id=integer(r.u_id);if(views===null&&r.view_week!==null&&r.view_week!==undefined)throw new HomeSectionUnavailable('precision');if(views===null||views<10||id===null)continue;for(const tag of tagIds(r.tags)){const row=stats.get(tag)??{views:[],ids:new Set<number>()};if(!row.ids.has(id)){row.views.push(views);row.ids.add(id);}stats.set(tag,row);}}
 const all:TagRow[]=[...stats].map(([id,r])=>{const values=r.views.sort((a,b)=>a-b),middle=Math.floor(values.length/2),total=values.reduce((a,b)=>a+b,0);if(!Number.isSafeInteger(total))throw new HomeSectionUnavailable('precision');return {id,name:names.get(id)??String(id),kind:'channel',channels:values.length,weeklyViews:total,average:total/values.length,median:values.length%2?values[middle]!:((values[middle-1]??0)+(values[middle]??0))/2};});
 all.sort((a,b)=>b.weeklyViews-a.weeklyViews||a.id-b.id);const rows=all.slice(0,8),selected=new Set(rows.map(r=>r.id)),unique=new Set<number>();for(const [id,row] of stats)if(selected.has(id))for(const channel of row.ids)unique.add(channel);
 const weeklyViews=rows.reduce((n,r)=>n+r.weeklyViews,0);if(!Number.isSafeInteger(weeklyViews))throw new HomeSectionUnavailable('precision');
 return {status:'available' as const,reason:null,rows,summary:{visibleCategories:rows.length,channelMemberships:rows.reduce((n,r)=>n+r.channels,0),uniqueChannels:unique.size,weeklyViews,overlapping:true as const},updatedAt:latest(...records.map(r=>r.mtime)),minimumWeeklyViews:10 as const};
}
export async function homeExploration(reader:Reader,now:Date):Promise<HomeExploration>{
 const to=taipeiSql(now),date=taipeiDate(now),today=date+' 00:00:00',from=new Date(Date.parse(date+'T00:00:00Z')-6*86400000).toISOString().slice(0,10)+' 00:00:00';
 const keywordBase={vocabularyCoverage:'unavailable' as const,vocabularyWindow:null,source:'https://tag.observe.tw' as const,version:null,from:timestamp(from)!,to:timestamp(to)!,updatedAt:null,rows:[],sourceVideos:null,freshVideos:null,staleVideos:null,unprocessedVideos:null,metric:'current-cumulative-views-of-window-published-videos' as const};
 const todayBase={...keywordBase,from:timestamp(today)!};
 const unavailable=(error:unknown)=>{if(error instanceof HomeSectionUnavailable)return error.reason;if(error instanceof DataSourceUnavailable)return 'data-source-unavailable';throw error;};
 const categoryTask=async()=>{
  const[counts,names]=await Promise.all([reader.rows(sql`SELECT u_id,tags,view_week,mtime FROM urt_count WHERE view_week>=10 ORDER BY u_id LIMIT 100001`),reader.rows(sql`SELECT tag_id,tag_name FROM urt_tag ORDER BY tag_id`)]);
  if(counts.length>100000)throw new HomeSectionUnavailable('source-cap');return homeCategories(counts,new Map(names.map(n=>[integer(n.tag_id)??0,text(n.tag_name)])));
 };
 const keywordTask=async():Promise<Pick<HomeExploration,'keywords'|'keywordToday'>>=>{
  const versions=await reader.rows(sql`SELECT r.id,JSON_OBJECT('coverage',JSON_EXTRACT(r.snapshot,'$.coverage'),'window',JSON_EXTRACT(r.snapshot,'$.window'),'sourceQuality',JSON_EXTRACT(r.snapshot,'$.sourceQuality')) AS source_meta FROM ts_vocabulary_current c JOIN ts_vocabulary_runs r ON r.id=c.run_id AND r.status='published' WHERE c.source='https://tag.observe.tw' LIMIT 1`),version=versions[0]?text(versions[0].id):null;
  const snapshot=object(versions[0]?.source_meta),window=object(snapshot.window),vocabularyCoverage=version?(snapshot.coverage==='all-current-indexed-article-tags'?'all-current-indexed-article-tags' as const:'observed-article-window' as const):'unavailable' as const;
  const quality=vocabularySourceQuality(snapshot.sourceQuality);
  const base={...keywordBase,...(quality?{sourceQuality:quality}:{}),vocabularyCoverage,vocabularyWindow:typeof window.since==='string'&&typeof window.until==='string'?{since:window.since,until:window.until}:null,version,reason:null};
  if(!version)return {keywords:{...base,status:'not-synchronized'},keywordToday:{...base,from:todayBase.from,status:'not-synchronized'}};
  const scope=sql`v.publishedAt>=${from} AND v.publishedAt<=${to}`,fresh=sql`m.source_pk=v.pk AND BINARY m.source_text_sha256=BINARY ${videoTextDigest()}`;
  // One bounded-date source scan per query, not one query per term or a second full window scan.
  // Partition before limiting so today can surface terms outside the weekly top forty.
  const[terms,coverage]=await Promise.all([
   reader.rows(sql`SELECT * FROM (
    SELECT window_key,term_key,term,COUNT(*) AS videos,COUNT(viewCount) AS measured_videos,SUM(viewCount) AS views,
     ROW_NUMBER() OVER(PARTITION BY window_key ORDER BY COUNT(*) DESC,term_key) AS row_rank
    FROM (SELECT DISTINCT v.pk,v.publishedAt,e.term_key,e.term,CASE WHEN v.viewCount>=0 THEN v.viewCount ELSE NULL END AS viewCount
     FROM urt_video v
     JOIN ts_video_tag_matches m ON m.video_id=v.videoId AND BINARY m.video_id=BINARY v.videoId AND m.vocabulary_version=${version}
     JOIN ts_video_tag_evidence e ON e.video_id=v.videoId AND BINARY e.video_id=BINARY v.videoId AND e.vocabulary_version=${version}
     WHERE ${scope} AND ${fresh}) matched
    CROSS JOIN (SELECT 'week' AS window_key UNION ALL SELECT 'today') windows
    WHERE window_key='week' OR publishedAt>=${today}
    GROUP BY window_key,term_key,term
   ) ranked WHERE row_rank<=40 ORDER BY window_key,row_rank`),
   reader.rows(sql`SELECT COUNT(*) AS source_videos,COALESCE(SUM(m.video_id IS NULL),0) AS unprocessed,COALESCE(SUM(m.video_id IS NOT NULL AND (${fresh})),0) AS fresh,COALESCE(SUM(m.video_id IS NOT NULL AND NOT(${fresh})),0) AS stale,MAX(CASE WHEN ${fresh} THEN UNIX_TIMESTAMP(m.matched_at)*1000 ELSE NULL END) AS latest_match,
    COALESCE(SUM(v.publishedAt>=${today}),0) AS today_source_videos,
    COALESCE(SUM(v.publishedAt>=${today} AND m.video_id IS NULL),0) AS today_unprocessed,
    COALESCE(SUM(v.publishedAt>=${today} AND m.video_id IS NOT NULL AND (${fresh})),0) AS today_fresh,
    COALESCE(SUM(v.publishedAt>=${today} AND m.video_id IS NOT NULL AND NOT(${fresh})),0) AS today_stale,
    MAX(CASE WHEN v.publishedAt>=${today} AND (${fresh}) THEN UNIX_TIMESTAMP(m.matched_at)*1000 ELSE NULL END) AS today_latest_match
    FROM urt_video v LEFT JOIN ts_video_tag_matches m ON m.video_id=v.videoId AND BINARY m.video_id=BINARY v.videoId AND m.vocabulary_version=${version} WHERE ${scope}`),
  ]);
  const c=coverage[0]??{};
  const summary=(window:'week'|'today'):HomeKeywordSummary=>{
   const prefix=window==='today'?'today_':'',matchedAt=c[prefix+'latest_match'];
   const rows=terms.filter(r=>r.window_key===window).map(r=>{const videos=measuredCount(r.videos),unknown=videos-measuredCount(r.measured_videos),views=unknown?null:integer(r.views);if(unknown<0||(!unknown&&views===null))throw new HomeSectionUnavailable('precision');return {key:text(r.term_key),term:text(r.term),videoCount:videos,views,unknownViewVideos:unknown};});
   return {...base,from:window==='today'?todayBase.from:base.from,status:'synchronized',rows,updatedAt:matchedAt!==null&&matchedAt!==undefined&&Number.isFinite(Number(matchedAt))?new Date(Number(matchedAt)).toISOString():null,sourceVideos:measuredCount(c[prefix+'source_videos']),freshVideos:measuredCount(c[prefix+'fresh']),staleVideos:measuredCount(c[prefix+'stale']),unprocessedVideos:measuredCount(c[prefix+'unprocessed'])};
  };
  return {keywords:summary('week'),keywordToday:summary('today')};
 };
 const[categories,keywordWindows]=await Promise.all([
  categoryTask().catch(error=>({status:'unavailable' as const,reason:unavailable(error),rows:[],summary:{visibleCategories:null,channelMemberships:null,uniqueChannels:null,weeklyViews:null,overlapping:true as const},updatedAt:null,minimumWeeklyViews:10 as const})),
  keywordTask().catch(error=>{const reason=unavailable(error);return {keywords:{...keywordBase,status:'unavailable' as const,reason},keywordToday:{...todayBase,status:'unavailable' as const,reason}};}),
 ]);return {categories,...keywordWindows};
}
