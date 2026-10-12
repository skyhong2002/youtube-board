import {keywordCloudFromEvidence,keywordDayFromEvidence} from '../../shared/cache-metrics.js';
import { reportCacheKey } from '../../shared/report-cache-key.js';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { cap, activeChannel } from './channel-jobs.js';
import { jsonMap, legacyInstant, selectOne, taipeiSql, update, upsert, whereKeys } from './legacy-db.js';
import { tagMetrics, type TagDictionary, type TagSelection } from './tag-backfill.js';
import { unsigned } from './youtube.js';
export interface CacheContext { db: Connection; now: Date; execute: boolean; assertOwnership(): Promise<void> }
export interface CacheInput extends TagSelection { from: string; to: string; days: number; channelLimit: number; videoLimit: number; uId?: number; subject?: string }
export const dateKeys = (input: TagSelection) => ({ tagid: input.tagIds.length ? input.tagIds.join(',') : null, tag_or: input.orTagIds?.length ? input.orTagIds.join(',') : null, tag_not: input.notTagIds?.length ? input.notTagIds.join(',') : null });
export const selectionKey = (input: TagSelection) => JSON.stringify([input.tagIds,input.orTagIds ?? [],input.notTagIds ?? []]);
export function daysBetween(from: string, to: string) { const output: string[] = []; for (const d of [from,to]) if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !Number.isFinite(Date.parse(d)) || new Date(d).toISOString().slice(0,10) !== d) throw new Error('Invalid cache date'); const count = (Date.parse(to)-Date.parse(from))/86400000+1; cap(count,366); for(let i=0;i<count;i++) output.push(new Date(Date.parse(from)+i*86400000).toISOString().slice(0,10)); return output; }
export function validateCacheInput(input: CacheInput) {
  daysBetween(input.from,input.to); cap(input.days,366); cap(input.channelLimit,5000); cap(input.videoLimit,100000);
  if (input.uId !== undefined) cap(input.uId,2147483647);
  for(const values of [input.tagIds,input.orTagIds ?? [],input.notTagIds ?? []]) if(values.length>20 || values.some(v=>!Number.isSafeInteger(v)||v<1||v>2147483647) || values.join(',').length>64 || [...new Set(values)].sort((a,b)=>a-b).join(',')!==values.join(',')) throw new Error('Cache taxonomy must be sorted unique bounded IDs');
  if(input.subject !== undefined && (!input.subject || [...input.subject].length>32 || /[\uD800-\uDFFF]/u.test(input.subject))) throw new Error('Invalid cache subject');
}
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
const metrics=(rows:RowDataPacket[],dictionary:TagDictionary)=>tagMetrics(rows.map(v=>({title:String(v.title??''),description:String(v.description??''),viewCount:v.viewCount})),dictionary);
export async function publishCache(ctx:CacheContext,table:string,keys:Record<string,unknown>,values:Record<string,unknown>,dictionary:TagDictionary,unknown=0) {
  if(Buffer.byteLength(JSON.stringify(values))>8*1024*1024)throw new Error('Cache payload exceeds publication cap');
  if(!ctx.execute) return;
  await ctx.assertOwnership();const at=taipeiSql(ctx.now),key=reportCacheKey(keys);
  await ctx.db.execute('INSERT INTO ts_report_cache_lineage(cache_table,cache_key,vocabulary_version,coverage,rule_version,status,generated_at,unknown_view_videos) VALUES(?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE vocabulary_version=VALUES(vocabulary_version),coverage=VALUES(coverage),rule_version=VALUES(rule_version),status=VALUES(status),generated_at=VALUES(generated_at),unknown_view_videos=VALUES(unknown_view_videos)',[table,key,dictionary.version,dictionary.coverage,dictionary.rule,'pending',at,unknown]);
  const windowTo=typeof keys.the_month==='string'?new Date(Date.UTC(Number(keys.the_month.slice(0,4)),Number(keys.the_month.slice(5,7)),0)).toISOString().slice(0,10):typeof keys.the_date==='string'?keys.the_date:at.slice(0,10),windowFrom=typeof keys.the_month==='string'?keys.the_month:typeof keys.the_date==='string'?keys.the_date:new Date(Date.parse(windowTo)-((typeof keys.days==='number'?keys.days:7)-1)*86400000).toISOString().slice(0,10);
  await ctx.db.execute('UPDATE ts_report_cache_lineage SET window_from=?,window_to=?,window_closed=? WHERE cache_table=? AND cache_key=?',[windowFrom,windowTo,windowTo<at.slice(0,10),table,key]);
  const existing=await selectOne(ctx.db,table,keys);
  await upsert(ctx.db,table,keys,{...(existing?{}:{ctime:at}),mtime:at,...values});
  await ctx.db.execute('UPDATE ts_report_cache_lineage SET status=? WHERE cache_table=? AND cache_key=?',['published',table,key]);
}
export async function tagDateCacheJob(ctx:CacheContext,input:CacheInput,dictionary:TagDictionary) {
  if(input.to>taipeiSql(ctx.now).slice(0,10))throw new Error('Future cache dates are forbidden');
  const channels=await cacheChannels(ctx,input), prepared=[];
  let preparedBytes=0;for(const day of daysBetween(input.from,input.to)){const m=metrics(await cacheVideos(ctx,input,channels,day,day),dictionary);preparedBytes+=Buffer.byteLength(JSON.stringify(m));if(preparedBytes>16*1024*1024)throw new Error('Cache date batch exceeds payload cap');prepared.push({day,m});}
  for(const {day,m} of prepared) if(ctx.execute) {
    await ctx.assertOwnership(); const at=taipeiSql(ctx.now),key=selectionKey(input);
    await ctx.db.execute('INSERT INTO ts_tag_cache_lineage(selection_key,the_date,vocabulary_version,coverage,rule_version,status,generated_at,unknown_view_videos) VALUES(?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE vocabulary_version=VALUES(vocabulary_version),coverage=VALUES(coverage),rule_version=VALUES(rule_version),status=VALUES(status),generated_at=VALUES(generated_at),unknown_view_videos=VALUES(unknown_view_videos)',[key,day,dictionary.version,dictionary.coverage,dictionary.rule,'pending',at,m.unknown_view_videos]);
    await ctx.db.execute('UPDATE ts_tag_cache_lineage SET window_from=?,window_to=?,window_closed=? WHERE selection_key=? AND the_date=?',[day,day,day<at.slice(0,10),key,day]);
    const {unknown_view_videos:_,...rest}=m;
    await publishCache(ctx,'urt_show_tag_date',{...dateKeys(input),the_date:day},{...rest,count_channels:channels.length,tags_result:JSON.stringify(m.tags_result),tags_video:JSON.stringify(m.tags_video),tags_views:JSON.stringify(m.tags_views)},dictionary,m.unknown_view_videos);
    await ctx.db.execute('UPDATE ts_tag_cache_lineage SET status=? WHERE selection_key=? AND the_date=?',['published',key,day]);
  }
  return {mode:ctx.execute?'execute':'dry-run',selected:prepared.length,applied:ctx.execute?prepared.map(p=>p.day):[],skipped:[],channels:channels.length};
}
export async function cloudCacheJob(ctx:CacheContext,input:CacheInput,dictionary:TagDictionary,kind:'tag'|'channel'|'keyword') {
  if(input.to!==taipeiSql(ctx.now).slice(0,10)||daysBetween(input.from,input.to).length!==input.days)throw new Error('Cloud identity requires the current canonical calendar window');
  const channels=await cacheChannels(ctx,input),rows=await cacheVideos(ctx,input,channels); const batches=kind==='channel'?channels.map(uId=>({uId,rows:rows.filter(r=>Number(r.u_id)===uId)})):[{uId:0,rows}];
  if(kind==='keyword'&&!input.subject)throw new Error('Keyword cloud requires subject');
  for(const batch of batches) {
    const filtered=kind==='keyword'?batch.rows.filter(r=>dictionary.match(r.title??'',r.description??'').some(m=>m.term===input.subject)):batch.rows;
    const m=metrics(filtered,dictionary);
    if(kind==='channel') await publishCache(ctx,'urt_show_cloud',{u_id:batch.uId,days:input.days},{keywords_json:JSON.stringify(m.tags_result)},dictionary,m.unknown_view_videos);
    else if(kind==='tag') await publishCache(ctx,'urt_show_tag_cloud',{...dateKeys(input),days:input.days},{count_channels:channels.length,count_videos:m.count_videos,count_tags:m.count_tags,tags_count:m.tags_count,tags_result:JSON.stringify(m.tags_result)},dictionary,m.unknown_view_videos);
    else {
      const derived=keywordCloudFromEvidence(filtered.map(v=>({videoId:v.videoId,uId:Number(v.u_id),publishedAt:v.publishedAt,viewCount:v.viewCount,matches:dictionary.match(v.title??'',v.description??'')})),input.subject!);
      const {unknown_view_videos,...values}=derived;
      await publishCache(ctx,'urt_show_tag_cloud_tag',{...dateKeys(input),tag:input.subject!,days:input.days},{...values,tags_result:JSON.stringify(values.tags_result),videos_json:JSON.stringify(values.videos_json)},dictionary,unknown_view_videos);
    }
  }
  return {mode:ctx.execute?'execute':'dry-run',selected:batches.length,applied:ctx.execute?batches.map(b=>b.uId):[],skipped:[],videos:rows.length};
}
export async function keywordRelationCacheJob(ctx:CacheContext,input:CacheInput,dictionary:TagDictionary) {
  if(!input.subject)throw new Error('Relation cache requires explicit subject');
  // Legacy relation cache identity has no channel selection. Refuse poisoning global cache with a subset.
  if(input.uId||input.tagIds.length||input.orTagIds?.length||input.notTagIds?.length)throw new Error('Keyword relations require all active channels');
  const channels=await cacheChannels(ctx,input),prepared=[];let preparedBytes=0;
  for(const day of daysBetween(input.from,input.to)) {
    const rows=await cacheVideos(ctx,input,channels,day,day),values=keywordDayFromEvidence(rows.map(v=>({videoId:v.videoId,uId:Number(v.u_id),publishedAt:v.publishedAt,viewCount:v.viewCount,matches:dictionary.match(v.title??'',v.description??'')})),input.subject);
    prepared.push({day,values:{...values,videos_json:JSON.stringify(values.videos_json),tags_json:JSON.stringify(values.tags_json)}});
  }
  for(const p of prepared){preparedBytes+=Buffer.byteLength(JSON.stringify(p.values));if(preparedBytes>16*1024*1024)throw new Error('Relation batch exceeds payload cap');}
  for(const p of prepared)await publishCache(ctx,'urt_show_video_tag_date',{the_date:p.day,tag:input.subject},p.values,dictionary);
  return {mode:ctx.execute?'execute':'dry-run',selected:prepared.length,applied:ctx.execute?prepared.map(p=>p.day):[],skipped:[]};
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
export async function keywordsCacheJob(ctx:CacheContext,input:CacheInput,dictionary:TagDictionary) {
  // Fixed legacy tags_all coverage; caller cannot silently reuse its identity for a subset.
  if(input.days!==7||daysBetween(input.from,input.to).length!==7||input.to!==taipeiSql(ctx.now).slice(0,10)||input.uId||input.tagIds.length||input.notTagIds?.length||input.orTagIds?.join(',')!=='1,2,13,14')throw new Error('tags_all requires or=1,2,13,14');
  const channels=await cacheChannels(ctx,input),rows=await cacheVideos(ctx,input,channels),recent=taipeiSql(new Date(ctx.now.getTime()-86400000));
  const all=metrics(rows,dictionary),last=metrics(rows.filter(r=>r.publishedAt>=recent),dictionary),data=Object.fromEntries(Object.keys(all.tags_video).map(term=>[term,{video:last.tags_video[term]??0,video_all:all.tags_video[term],views:last.tags_views[term]??0,views_all:all.tags_views[term]}]));
  await publishCache(ctx,'urt_show_data',{data_name:'tags_all'},{api:'api/tags_all.php',para:'or=1,2,13,14',the_result:JSON.stringify(data)},dictionary,all.unknown_view_videos);
  return {mode:ctx.execute?'execute':'dry-run',selected:rows.length,applied:ctx.execute?['tags_all']:[],skipped:[]};
}
