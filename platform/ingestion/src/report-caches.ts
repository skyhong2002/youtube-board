import {keywordCloudAccumulator,keywordDayFromEvidence,tagMetricsAccumulator} from '../../shared/cache-metrics.js';
import { reportCacheKey } from '../../shared/report-cache-key.js';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { cap, activeChannel } from './channel-jobs.js';
import { jsonMap, legacyInstant, selectOne, taipeiSql, update, upsert, whereKeys } from './legacy-db.js';
import type { TagDictionary, TagSelection } from './tag-backfill.js';
import { unsigned } from './youtube.js';
export interface CacheContext { db: Connection; now: Date; execute: boolean; assertOwnership(): Promise<void> }
export interface CacheInput extends TagSelection { from: string; to: string; days: number; channelLimit: number; videoLimit: number; uId?: number; subject?: string; subjects?: string[] }
export const dateKeys = (input: TagSelection) => ({ tagid: input.tagIds.length ? input.tagIds.join(',') : null, tag_or: input.orTagIds?.length ? input.orTagIds.join(',') : null, tag_not: input.notTagIds?.length ? input.notTagIds.join(',') : null });
export const selectionKey = (input: TagSelection) => JSON.stringify([input.tagIds,input.orTagIds ?? [],input.notTagIds ?? []]);
export function daysBetween(from: string, to: string) { const output: string[] = []; for (const d of [from,to]) if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !Number.isFinite(Date.parse(d)) || new Date(d).toISOString().slice(0,10) !== d) throw new Error('Invalid cache date'); const count = (Date.parse(to)-Date.parse(from))/86400000+1; cap(count,366); for(let i=0;i<count;i++) output.push(new Date(Date.parse(from)+i*86400000).toISOString().slice(0,10)); return output; }
/** Streamed builders (tag cloud, tags_all, tag date) hold one day of rows at a time, so the scan cap can cover 90-day production windows. */
export const STREAM_VIDEO_LIMIT = 1000000;
export function validateCacheInput(input: CacheInput) {
  daysBetween(input.from,input.to); cap(input.days,366); cap(input.channelLimit,5000); cap(input.videoLimit,STREAM_VIDEO_LIMIT);
  if (input.uId !== undefined) cap(input.uId,2147483647);
  for(const values of [input.tagIds,input.orTagIds ?? [],input.notTagIds ?? []]) if(values.length>20 || values.some(v=>!Number.isSafeInteger(v)||v<1||v>2147483647) || values.join(',').length>64 || [...new Set(values)].sort((a,b)=>a-b).join(',')!==values.join(',')) throw new Error('Cache taxonomy must be sorted unique bounded IDs');
  for(const subject of [...(input.subject!==undefined?[input.subject]:[]),...(input.subjects??[])]) if(!subject || [...subject].length>32 || /[\uD800-\uDFFF]/u.test(subject)) throw new Error('Invalid cache subject');
  if(input.subjects !== undefined && (input.subject !== undefined || !input.subjects.length || input.subjects.length>100 || new Set(input.subjects).size!==input.subjects.length)) throw new Error('Cache subjects must be 1-100 unique terms without a single subject');
}
/** One explicit subject, or the ranked subject list a scheduled run resolved; each one publishes its own cache row. */
export const cacheSubjects = (input: CacheInput) => input.subjects ?? (input.subject !== undefined ? [input.subject] : []);
export async function cacheChannels(ctx:CacheContext,input:CacheInput) {
  validateCacheInput(input); const clauses=[activeChannel], params:unknown[]=[];
  if(input.uId) { clauses.push('c.u_id=?');params.push(input.uId); }
  for(const id of input.tagIds) { clauses.push('n.tags LIKE ?');params.push(`%[${id}]%`); }
  if(input.orTagIds?.length) { clauses.push('('+input.orTagIds.map(()=>'n.tags LIKE ?').join(' OR ')+')');params.push(...input.orTagIds.map(id=>`%[${id}]%`)); }
  for(const id of input.notTagIds??[]) { clauses.push("COALESCE(n.tags,'') NOT LIKE ?");params.push(`%[${id}]%`); }
  const [rows]=await ctx.db.query<RowDataPacket[]>(`SELECT c.u_id FROM urt_channel c LEFT JOIN urt_count n ON n.u_id=c.u_id WHERE ${clauses.join(' AND ')} ORDER BY c.u_id LIMIT ?`,[...params,input.channelLimit+1]);
  if(rows.length>input.channelLimit) throw new Error('Cache channel cap reached; prior publication retained');
  return rows.map(r=>Number(r.u_id));
}
/** Laravel TagDate/TagCloud/TagsAll builders pick channels from urt_count tag markers only (no urt_channel join, NULL tags never match NOT LIKE). */
export async function legacyTagChannels(ctx:CacheContext,input:TagSelection,limit:number) {
  cap(limit,5000);const clauses:string[]=[],params:unknown[]=[];
  if(input.orTagIds?.length){clauses.push('('+input.orTagIds.map(()=>'tags LIKE ?').join(' OR ')+')');params.push(...input.orTagIds.map(id=>`%[${id}]%`));}
  for(const id of input.tagIds){clauses.push('tags LIKE ?');params.push(`%[${id}]%`);}
  for(const id of input.notTagIds??[]){clauses.push('tags NOT LIKE ?');params.push(`%[${id}]%`);}
  const [rows]=await ctx.db.query<RowDataPacket[]>(`SELECT u_id FROM urt_count${clauses.length?' WHERE '+clauses.join(' AND '):''} ORDER BY u_id LIMIT ?`,[...params,limit+1]);
  return {channels:rows.slice(0,limit).map(r=>Number(r.u_id)),truncated:rows.length>limit};
}
/** Laravel semantics: count the whole inclusive window first and block (no write) above the cap; otherwise visit every row.
 * Rows are read in one-day publishedAt slices so a 90-day window never sits in memory at once. */
export async function scanVideos(ctx:CacheContext,channels:number[],from:string,to:string,limit:number,visit:(row:RowDataPacket)=>void) {
  cap(limit,STREAM_VIDEO_LIMIT);if(!channels.length)return {count:0,truncated:false};
  const ids=channels.map(()=>'?').join(',');
  const [sizes]=await ctx.db.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM urt_video WHERE u_id IN (${ids}) AND publishedAt>=? AND publishedAt<=?`,[...channels,from,to]);
  const count=Number(sizes[0]?.n??0);if(count>limit)return {count,truncated:true};
  let seen=0;
  for(let start=from;start<=to;){
    const next=taipeiSql(new Date(legacyInstant(start)!.getTime()+86400000)),last=next>to;
    const [rows]=await ctx.db.query<RowDataPacket[]>(`SELECT pk,videoId,u_id,title,description,viewCount,publishedAt FROM urt_video WHERE u_id IN (${ids}) AND publishedAt>=? AND publishedAt${last?'<=':'<'}? ORDER BY publishedAt,pk`,[...channels,start,last?to:next]);
    seen+=rows.length;if(seen>limit)throw new Error('Cache video cap reached during scan; prior publication retained');
    for(const row of rows)visit(row);
    if(last)break;start=next;
  }
  return {count:seen,truncated:false};
}
export async function cacheVideos(ctx:CacheContext,input:CacheInput,channels:number[],from=input.from,to=input.to) {
  if(!channels.length) return [];
  const [sizes]=await ctx.db.query<RowDataPacket[]>(`SELECT COUNT(*) AS n,COALESCE(SUM(OCTET_LENGTH(title)+OCTET_LENGTH(COALESCE(description,''))),0) AS bytes FROM (SELECT title,description FROM urt_video WHERE u_id IN (${channels.map(()=>'?').join(',')}) AND publishedAt>=? AND publishedAt<=? ORDER BY publishedAt,pk LIMIT ?) bounded`,[...channels,from+' 00:00:00',to+' 23:59:59',input.videoLimit+1]);
  if(Number(sizes[0]?.n)>input.videoLimit||Number(sizes[0]?.bytes)>16*1024*1024)throw new Error('Cache source cap reached; prior publication retained');
  const [rows]=await ctx.db.query<RowDataPacket[]>(`SELECT pk,videoId,u_id,title,description,viewCount,publishedAt FROM urt_video WHERE u_id IN (${channels.map(()=>'?').join(',')}) AND publishedAt>=? AND publishedAt<=? ORDER BY publishedAt,pk LIMIT ?`,[...channels,from+' 00:00:00',to+' 23:59:59',input.videoLimit+1]);
  if(rows.length>input.videoLimit) throw new Error('Cache video cap reached; prior publication retained');
  const ids=new Set<string>();for(const r of rows) { if(ids.has(r.videoId))throw new Error('Duplicate video identity');ids.add(r.videoId); }
  return rows;
}
export function checkedSum(a:number,b:number) { const sum=a+b;if(!Number.isSafeInteger(sum))throw new Error('Cache count exceeds safe integer range');return sum; }
export async function publishCache(ctx:CacheContext,table:string,keys:Record<string,unknown>,values:Record<string,unknown>,dictionary:TagDictionary,unknown=0,window?:{from:string;to:string}) {
  if(Buffer.byteLength(JSON.stringify(values))>8*1024*1024)throw new Error('Cache payload exceeds publication cap');
  if(!ctx.execute) return;
  await withReportLineage(ctx,table,keys,dictionary,unknown,window,async at=>{
    const existing=await selectOne(ctx.db,table,keys);
    await upsert(ctx.db,table,keys,{...(existing?{}:{ctime:at}),mtime:at,...values});
  });
}
/** Marks the generic sidecar pending, runs the MyISAM write, then publishes; an interrupted write stays visibly pending. */
export async function withReportLineage(ctx:CacheContext,table:string,keys:Record<string,unknown>,dictionary:Pick<TagDictionary,'version'|'coverage'|'rule'>,unknown:number,window:{from:string;to:string}|undefined,write:(at:string)=>Promise<void>) {
  await ctx.assertOwnership();const at=taipeiSql(ctx.now),key=reportCacheKey(keys);
  await ctx.db.execute('INSERT INTO ts_report_cache_lineage(cache_table,cache_key,vocabulary_version,coverage,rule_version,status,generated_at,unknown_view_videos) VALUES(?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE vocabulary_version=VALUES(vocabulary_version),coverage=VALUES(coverage),rule_version=VALUES(rule_version),status=VALUES(status),generated_at=VALUES(generated_at),unknown_view_videos=VALUES(unknown_view_videos)',[table,key,dictionary.version,dictionary.coverage,dictionary.rule,'pending',at,unknown]);
  const windowTo=window?window.to:typeof keys.the_month==='string'?new Date(Date.UTC(Number(keys.the_month.slice(0,4)),Number(keys.the_month.slice(5,7)),0)).toISOString().slice(0,10):typeof keys.the_date==='string'?keys.the_date:at.slice(0,10),windowFrom=window?window.from:typeof keys.the_month==='string'?keys.the_month:typeof keys.the_date==='string'?keys.the_date:new Date(Date.parse(windowTo)-((typeof keys.days==='number'?keys.days:7)-1)*86400000).toISOString().slice(0,10);
  await ctx.db.execute('UPDATE ts_report_cache_lineage SET window_from=?,window_to=?,window_closed=? WHERE cache_table=? AND cache_key=?',[windowFrom,windowTo,windowTo<at.slice(0,10),table,key]);
  await write(at);
  await ctx.db.execute('UPDATE ts_report_cache_lineage SET status=? WHERE cache_table=? AND cache_key=?',['published',table,key]);
}
const streamMetrics=(dictionary:TagDictionary)=>{const inner=tagMetricsAccumulator(),acc={...inner,result:()=>inner.result(dictionary.divisor?.bind(dictionary))};return {acc,visit:(v:RowDataPacket)=>acc.add({viewCount:v.viewCount,matches:dictionary.match(String(v.title??''),String(v.description??''))})};};
/** A channel's standing footer ("訂閱我們、加入 LINE、追蹤 IG") repeats under every video and would outweigh its topics.
 * Over a window of at least 10 videos, a term in the description of half of them but in the title of under 5% is
 * treated as that footer and left out of the channel cloud. */
export function channelBoilerplate(){
  const seen=new Map<string,{title:number;description:number}>();let videos=0;
  return {
    add(matches:{term:string;field:'title'|'description'}[]){videos++;for(const field of ['title','description'] as const)for(const term of new Set(matches.filter(m=>m.field===field).map(m=>m.term))){const s=seen.get(term)??{title:0,description:0};s[field]++;seen.set(term,s);}},
    terms(){return videos<10?new Set<string>():new Set([...seen].filter(([,s])=>s.description>=videos/2&&s.title<videos*0.05).map(([term])=>term));},
  };
}
const channelMetrics=(dictionary:TagDictionary)=>{const {acc}=streamMetrics(dictionary),footer=channelBoilerplate();
  return {acc,footer,visit:(v:RowDataPacket)=>{const matches=dictionary.match(String(v.title??''),String(v.description??''));footer.add(matches);acc.add({viewCount:v.viewCount,matches});}};};
/** Laravel TagDateCacheBuilder: urt_count channel markers, one row per calendar date, and a date over the per-date
 * video cap (or a channel cap overflow) is blocked on its own while the other dates still publish. */
export async function tagDateCacheJob(ctx:CacheContext,input:CacheInput&{dateLimit?:number},dictionary:TagDictionary) {
  if(input.to>taipeiSql(ctx.now).slice(0,10))throw new Error('Future cache dates are forbidden');
  validateCacheInput(input);const dates=daysBetween(input.from,input.to);if(input.dateLimit!==undefined&&dates.length>cap(input.dateLimit,400))throw new Error('Tag date range exceeds date limit');
  const {channels,truncated}=await legacyTagChannels(ctx,input,input.channelLimit),prepared:{day:string;m:ReturnType<ReturnType<typeof streamMetrics>["acc"]["result"]>}[]=[],skipped:{date:string;reason:string}[]=[];
  let preparedBytes=0;for(const day of dates){
    if(truncated){skipped.push({date:day,reason:'channel_scan_limit_exceeded'});continue;}
    const {acc,visit}=streamMetrics(dictionary);if((await scanVideos(ctx,channels,day+' 00:00:00',day+' 23:59:59',input.videoLimit,visit)).truncated){skipped.push({date:day,reason:'video_scan_limit_exceeded'});continue;}
    const m=acc.result();preparedBytes+=Buffer.byteLength(JSON.stringify(m));if(preparedBytes>16*1024*1024)throw new Error('Cache date batch exceeds payload cap');prepared.push({day,m});
  }
  for(const {day,m} of prepared) if(ctx.execute) {
    await ctx.assertOwnership(); const at=taipeiSql(ctx.now),key=selectionKey(input);
    await ctx.db.execute('INSERT INTO ts_tag_cache_lineage(selection_key,the_date,vocabulary_version,coverage,rule_version,status,generated_at,unknown_view_videos) VALUES(?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE vocabulary_version=VALUES(vocabulary_version),coverage=VALUES(coverage),rule_version=VALUES(rule_version),status=VALUES(status),generated_at=VALUES(generated_at),unknown_view_videos=VALUES(unknown_view_videos)',[key,day,dictionary.version,dictionary.coverage,dictionary.rule,'pending',at,m.unknown_view_videos]);
    await ctx.db.execute('UPDATE ts_tag_cache_lineage SET window_from=?,window_to=?,window_closed=? WHERE selection_key=? AND the_date=?',[day,day,day<at.slice(0,10),key,day]);
    const {unknown_view_videos:_,...rest}=m;
    await publishCache(ctx,'urt_show_tag_date',{...dateKeys(input),the_date:day},{...rest,stime:at,count_channels:channels.length,tags_result:JSON.stringify(m.tags_result),tags_video:JSON.stringify(m.tags_video),tags_views:JSON.stringify(m.tags_views)},dictionary,m.unknown_view_videos);
    await ctx.db.execute('UPDATE ts_tag_cache_lineage SET status=? WHERE selection_key=? AND the_date=?',['published',key,day]);
  }
  return {mode:ctx.execute?'execute':'dry-run',selected:prepared.length,applied:ctx.execute?prepared.map(p=>p.day):[],skipped,channels:channels.length};
}
/** Laravel TagCloudCacheBuilder::buildMany: every period is the rolling window [now - days, now] in one run;
 * each period is blocked independently (no write) when its window exceeds the per-period video cap. */
export async function tagCloudCacheJob(ctx:CacheContext,input:CacheInput,daysList:number[],dictionary:TagDictionary) {
  validateCacheInput(input);
  if(!daysList.length||daysList.length>10||new Set(daysList).size!==daysList.length||daysList.some(d=>!Number.isSafeInteger(d)||d<1||d>365))throw new Error('Tag cloud periods must be 1-10 unique day counts up to 365');
  const {channels,truncated}=await legacyTagChannels(ctx,input,input.channelLimit),applied:number[]=[],skipped:{days:number;reason:string}[]=[],periods:{days:number;videos:number;terms:number}[]=[];
  for(const days of daysList){
    if(truncated){skipped.push({days,reason:'channel_scan_limit_exceeded'});continue;}
    const {acc,visit}=streamMetrics(dictionary);
    if((await scanVideos(ctx,channels,taipeiSql(new Date(ctx.now.getTime()-days*86400000)),taipeiSql(ctx.now),input.videoLimit,visit)).truncated){skipped.push({days,reason:'video_scan_limit_exceeded'});continue;}
    const m=acc.result();
    await publishCache(ctx,'urt_show_tag_cloud',{...dateKeys(input),days},{count_channels:channels.length,count_videos:m.count_videos,count_tags:m.count_tags,tags_count:m.tags_count,tags_result:JSON.stringify(m.tags_result)},dictionary,m.unknown_view_videos);
    periods.push({days,videos:m.count_videos,terms:m.tags_count});if(ctx.execute)applied.push(days);
  }
  return {mode:ctx.execute?'execute':'dry-run',selected:daysList.length,applied,skipped,channels:channels.length,periods};
}
/** Channel and keyword clouds; the category tag cloud (urt_show_tag_cloud) is tagCloudCacheJob with Laravel rolling windows. */
export async function cloudCacheJob(ctx:CacheContext,input:CacheInput,dictionary:TagDictionary,kind:'channel'|'keyword') {
  if(input.to!==taipeiSql(ctx.now).slice(0,10)||daysBetween(input.from,input.to).length!==input.days)throw new Error('Cloud identity requires the current canonical calendar window');
  if(kind==='keyword')return keywordCloudCacheJob(ctx,input,dictionary);
  // Stream the window one day at a time with one running total per channel: a 7-day all-channel window
  // (about 30k videos) is over cacheVideos' 16 MB text bound.
  const channels=await cacheChannels(ctx,input),totals=new Map(channels.map(uId=>[uId,channelMetrics(dictionary)]));
  const scan=await scanVideos(ctx,channels,input.from+' 00:00:00',input.to+' 23:59:59',input.videoLimit,v=>totals.get(Number(v.u_id))?.visit(v));
  if(scan.truncated)return {mode:ctx.execute?'execute':'dry-run',selected:0,applied:[],skipped:[{reason:'video_scan_limit_exceeded'}],videos:scan.count};
  for(const [uId,{acc,footer}] of totals) {
    const m=acc.result(),drop=footer.terms();
    await publishCache(ctx,'urt_show_cloud',{u_id:uId,days:input.days},{keywords_json:JSON.stringify(Object.fromEntries(Object.entries(m.tags_result).filter(([term])=>!drop.has(term))))},dictionary,m.unknown_view_videos);
  }
  return {mode:ctx.execute?'execute':'dry-run',selected:channels.length,applied:ctx.execute?channels:[],skipped:[],videos:scan.count};
}
/** Keyword clouds stream the window one day at a time (a 30-day all-channel window is over 100k videos) and
 * match every video once into one running total per subject, so one run fills the cloud of each ranked
 * subject without holding the videos. A ranked run skips a subject over the publication cap and keeps going. */
async function keywordCloudCacheJob(ctx:CacheContext,input:CacheInput,dictionary:TagDictionary) {
  const subjects=cacheSubjects(input);if(!subjects.length)throw new Error('Keyword cloud requires subject');
  const channels=await cacheChannels(ctx,input),totals=new Map(subjects.map(s=>[s,keywordCloudAccumulator(s)]));
  const scan=await scanVideos(ctx,channels,input.from+' 00:00:00',input.to+' 23:59:59',input.videoLimit,v=>{
    const matches=dictionary.match(String(v.title??''),String(v.description??'')),terms=new Set(matches.map(m=>m.term));
    for(const [subject,total] of totals) if(terms.has(subject)) total.add({videoId:String(v.videoId),uId:Number(v.u_id),publishedAt:v.publishedAt,viewCount:v.viewCount,matches});
  });
  if(scan.truncated)return {mode:ctx.execute?'execute':'dry-run',selected:0,applied:[],skipped:subjects.map(subject=>({subject,reason:'video_scan_limit_exceeded'})),videos:scan.count};
  const applied:string[]=[],skipped:{subject:string;reason:string}[]=[];
  for(const [subject,total] of totals) {
    const {unknown_view_videos,...values}=total.result();totals.delete(subject);
    const row={...values,tags_result:JSON.stringify(values.tags_result),videos_json:JSON.stringify(values.videos_json)};
    if(input.subjects&&Buffer.byteLength(JSON.stringify(row))>8*1024*1024){skipped.push({subject,reason:'payload_cap_exceeded'});continue;}
    await publishCache(ctx,'urt_show_tag_cloud_tag',{...dateKeys(input),tag:subject,days:input.days},row,dictionary,unknown_view_videos);
    if(ctx.execute)applied.push(subject);
  }
  return {mode:ctx.execute?'execute':'dry-run',selected:subjects.length,applied,skipped,videos:scan.count};
}
export async function keywordRelationCacheJob(ctx:CacheContext,input:CacheInput,dictionary:TagDictionary) {
  const subjects=cacheSubjects(input);if(!subjects.length)throw new Error('Relation cache requires explicit subject');
  // Legacy relation cache identity has no channel selection. Refuse poisoning global cache with a subset.
  if(input.uId||input.tagIds.length||input.orTagIds?.length||input.notTagIds?.length)throw new Error('Keyword relations require all active channels');
  // One day of videos at a time; only each subject's finished day row is kept until publication.
  const channels=await cacheChannels(ctx,input),days=daysBetween(input.from,input.to),prepared=new Map(subjects.map(s=>[s,[] as {day:string;values:Record<string,unknown>}[]]));
  for(const day of days) {
    const rows=await cacheVideos(ctx,input,channels,day,day),videos=rows.map(v=>({videoId:v.videoId,uId:Number(v.u_id),publishedAt:v.publishedAt,viewCount:v.viewCount,matches:dictionary.match(v.title??'',v.description??'')}));
    for(const subject of subjects){const values=keywordDayFromEvidence(videos,subject);prepared.get(subject)!.push({day,values:{...values,videos_json:JSON.stringify(values.videos_json),tags_json:JSON.stringify(values.tags_json)}});}
  }
  // The payload cap stays per subject: each subject's dates publish together or not at all. A ranked run
  // skips an oversized subject and keeps going; an explicit single subject still fails the run.
  const skipped:{subject:string;reason:string}[]=[];
  for(const [subject,rows] of prepared) {
    if(rows.reduce((n,p)=>n+Buffer.byteLength(JSON.stringify(p.values)),0)>16*1024*1024){if(!input.subjects)throw new Error('Relation batch exceeds payload cap');skipped.push({subject,reason:'payload_cap_exceeded'});continue;}
    for(const p of rows)await publishCache(ctx,'urt_show_video_tag_date',{the_date:p.day,tag:subject},p.values,dictionary);
  }
  return {mode:ctx.execute?'execute':'dry-run',selected:days.length,applied:ctx.execute?days:[],skipped,...(input.subjects?{subjects:subjects.length}:{})};
}
export async function tagMonthCacheJob(ctx:CacheContext,input:CacheInput,dictionary:TagDictionary) {
  validateCacheInput(input);if(!input.subject)throw new Error('Month cache requires subject');
  const month=input.from.slice(0,7)+'-01',end=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).toISOString().slice(0,10);if(input.from!==month||input.to!==end||end>=taipeiSql(ctx.now).slice(0,10))throw new Error('Month cache requires one complete closed calendar month');
  const where=whereKeys(dateKeys(input));const [rows]=await ctx.db.query<RowDataPacket[]>(`SELECT * FROM urt_show_tag_date WHERE ${where.sql} AND the_date>=? AND the_date<=? ORDER BY the_date,pk`,[...where.values,input.from,input.to]);
  const dates=new Set<string>(),daily:Record<string,unknown>={};let views=0,videos=0;
  for(const row of rows){const day=String(row.the_date);if(dates.has(day))throw new Error('Duplicate daily cache');dates.add(day);
    const [lineage]=await ctx.db.query<RowDataPacket[]>('SELECT * FROM ts_tag_cache_lineage WHERE selection_key=? AND the_date=?',[selectionKey(input),day]);
    if(lineage.length!==1||lineage[0]!.status!=='published'||Number(lineage[0]!.window_closed)!==1||String(lineage[0]!.generated_at)<=day+' 23:59:59'||lineage[0]!.vocabulary_version!==dictionary.version||lineage[0]!.coverage!==dictionary.coverage||lineage[0]!.rule_version!==dictionary.rule||Number(lineage[0]!.unknown_view_videos)!==0)throw new Error('Month source requires complete same-version published daily lineage');
    const v=jsonMap(row.tags_video)[input.subject]??0,w=jsonMap(row.tags_views)[input.subject]??0,score=jsonMap(row.tags_result)[input.subject];if(unsigned(v)===null||unsigned(w)===null)throw new Error('Invalid daily count');
    daily[day]={tags_video:Number(v),count_videos:Number(v),tags_views:Number(w),total_views:Number(w),...(score===undefined?{}:{tags_result:score})};videos=checkedSum(videos,Number(v));views=checkedSum(views,Number(w));
  }
  // Missing days remain missing, never synthetic zero. Require the requested full date window before publication.
  if(dates.size!==daysBetween(input.from,input.to).length)throw new Error('Month source has missing dates');
  await publishCache(ctx,'urt_show_tag_month',{...dateKeys(input),the_month:month,tag:input.subject},{count_videos:videos,total_views:views,tags_result:JSON.stringify(daily)},dictionary);
  return {mode:ctx.execute?'execute':'dry-run',selected:rows.length,applied:ctx.execute?[month]:[],skipped:[]};
}
/** Laravel TagsAllCacheBuilder (`--days=31 --recent-days=7`): calendar window [today-(days-1), today], channels with any
 * category marker 1,2,13,14 in urt_count, and "recent" = published on or after the start of (today - recentDays), i.e. today
 * plus recentDays previous days. Entries are ordered by recent views desc (ties: first seen in pk order). Over the video cap
 * the run is blocked and the previous row is kept. */
export async function keywordsCacheJob(ctx:CacheContext,input:CacheInput&{recentDays?:number},dictionary:TagDictionary) {
  validateCacheInput(input);cap(input.days,90);const recentDays=Math.min(cap(input.recentDays??7,2147483647),input.days);
  if(daysBetween(input.from,input.to).length!==input.days||input.to!==taipeiSql(ctx.now).slice(0,10)||input.uId||input.tagIds.length||input.notTagIds?.length||input.orTagIds?.join(',')!=='1,2,13,14')throw new Error('tags_all requires or=1,2,13,14 and the current calendar window');
  const mode=ctx.execute?'execute':'dry-run',{channels,truncated}=await legacyTagChannels(ctx,{tagIds:[],orTagIds:[1,2,13,14]},input.channelLimit);
  if(truncated)return {mode,selected:0,applied:[],skipped:[{reason:'channel_scan_limit_exceeded'}]};
  const recentFrom=taipeiSql(new Date(ctx.now.getTime()-recentDays*86400000)).slice(0,10)+' 00:00:00',data=new Map<string,{video:number;video_all:number;views:number;views_all:number;pk:number}>();let unknown=0;
  const scan=await scanVideos(ctx,channels,input.from+' 00:00:00',input.to+' 23:59:59',input.videoLimit,v=>{
    if(v.viewCount===null||v.viewCount===undefined)unknown++;
    const views=Number(v.viewCount??0),recent=String(v.publishedAt)>=recentFrom;if(!Number.isSafeInteger(views)||views<0)throw new Error('Invalid video view count in cache source');
    for(const term of new Set(dictionary.match(String(v.title??''),String(v.description??'')).map(m=>m.term))){
      let m=data.get(term);if(!m)data.set(term,m={video:0,video_all:0,views:0,views_all:0,pk:Number(v.pk)});else m.pk=Math.min(m.pk,Number(v.pk));
      m.video_all++;m.views_all=checkedSum(m.views_all,views);if(recent){m.video++;m.views=checkedSum(m.views,views);}
    }
  });
  if(scan.truncated)return {mode,selected:scan.count,applied:[],skipped:[{reason:'video_scan_limit_exceeded'}]};
  const result=Object.fromEntries([...data].sort((a,b)=>b[1].views-a[1].views||a[1].pk-b[1].pk).map(([term,m])=>[term,{video:m.video,video_all:m.video_all,views:m.views,views_all:m.views_all}]));
  await publishCache(ctx,'urt_show_data',{data_name:'tags_all'},{api:'api/tags_all.php',para:'or=1,2,13,14',the_result:JSON.stringify(result)},dictionary,unknown,{from:input.from,to:input.to});
  return {mode,selected:scan.count,applied:ctx.execute?['tags_all']:[],skipped:[],channels:channels.length,terms:data.size,recentFrom};
}
