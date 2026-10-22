import type { RowDataPacket } from 'mysql2/promise';
import { cap } from './channel-jobs.js';
import { jsonMap, legacyInstant, selectOne, taipeiSql, update, upsert } from './legacy-db.js';
import { unsigned } from './youtube.js';
import { cacheChannels, checkedSum, dateKeys, daysBetween, publishCache, selectionKey, type CacheContext, type CacheInput } from './report-caches.js';
import type { TagDictionary } from './tag-backfill.js';
const numericString=/^\s*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?\s*$/;
const phpNumeric=(v:unknown)=>typeof v==='number'?Number.isFinite(v):typeof v==='string'&&numericString.test(v);
const phpInt=(v:unknown)=>Math.trunc(Number(v))||0;
export type ChannelDeltas={view_week:number;video_week:number;view_month:number;video_month:number;sub_week?:number;sub_month?:number};
/** Laravel ChannelCountsPreview::computeDeltas. `logs` are urt_log.thedata newest pk first (older months override on the same date).
 * Returns null for an invalid or empty series, and for a series without any point in the last 31 days. A single observation
 * yields 0 deltas; subscriber deltas are omitted (keep the stored value) when no earlier point carries a subscriber count. */
export function channelDeltas(logs:unknown[],day:string):ChannelDeltas|null {
  const series:Record<string,unknown>=Object.create(null);
  for(const log of logs){
    let decoded:unknown;try{decoded=JSON.parse(String(log??''));}catch{return null;}
    if(!decoded||typeof decoded!=='object')return null;
    for(const [date,point] of Object.entries(decoded)){
      if(Array.isArray(decoded)||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!point||typeof point!=='object')return null;
      const p=point as Record<string,unknown>;
      for(const metric of ['view','video'])if(!Object.hasOwn(p,metric)||!phpNumeric(p[metric])||phpInt(p[metric])<0)return null;
      if(Object.hasOwn(p,'hidden')&&typeof p.hidden!=='boolean')return null;
      if(Object.hasOwn(p,'subscriber')){if(!phpNumeric(p.subscriber)||phpInt(p.subscriber)<0)return null;}else if(p.hidden!==true)return null;
    }
    Object.assign(series,decoded);
  }
  if(!Object.keys(series).length)return null;
  let latest:{view:number;video:number}|null=null,latestSubscriber:number|null=null,week={view:0,video:0},month={view:0,video:0},weekSubscriber:number|null=null,monthSubscriber:number|null=null;
  for(let i=0;i<=30;i++){
    const date=new Date(Date.parse(day)-i*86400000).toISOString().slice(0,10),point=series[date];
    if(!point||typeof point!=='object')continue;const p=point as Record<string,unknown>,isLatest=latest===null;
    if(!latest){latest={view:phpInt(p.view),video:phpInt(p.video)};latestSubscriber=Object.hasOwn(p,'subscriber')?phpInt(p.subscriber):null;}
    const delta={view:latest.view-phpInt(p.view),video:latest.video-phpInt(p.video)},subscriber=!isLatest&&latestSubscriber!==null&&Object.hasOwn(p,'subscriber')?latestSubscriber-phpInt(p.subscriber):null;
    if(i<=7){week=delta;if(subscriber!==null)weekSubscriber=subscriber;}
    if(i<=29){month=delta;if(subscriber!==null)monthSubscriber=subscriber;}
  }
  if(!latest)return null;
  return {view_week:week.view,...(weekSubscriber===null?{}:{sub_week:weekSubscriber}),video_week:week.video,view_month:month.view,...(monthSubscriber===null?{}:{sub_month:monthSubscriber}),video_month:month.video};
}
/** Laravel ChannelCountsPreview: only urt_count rows with an urt_log since the start of the month 31 days ago, oldest mtime
 * first (limit clamped to 100). Valid rows get the deltas + mtime=now; invalid history only bumps mtime (cooldown) and keeps
 * the previous weekly/monthly values. */
export async function countsCacheJob(ctx:CacheContext,input:{uId?:number;limit:number}) {
  cap(input.limit,100);if(input.uId)cap(input.uId,2147483647);
  const month=taipeiSql(new Date(ctx.now.getTime()-31*86400000)).slice(0,7)+'-01',at=taipeiSql(ctx.now),today=at.slice(0,10);
  const [rows]=await ctx.db.query<RowDataPacket[]>(`SELECT c.u_id FROM urt_count c WHERE ${input.uId?'c.u_id=? AND ':''}EXISTS (SELECT 1 FROM urt_log l WHERE l.u_id=c.u_id AND (l.themonth IS NULL OR l.themonth>=?)) ORDER BY c.mtime,c.u_id LIMIT ?`,[...(input.uId?[input.uId]:[]),month,input.limit+1]);
  const applied:number[]=[],skipped:{uId:number;reason:string}[]=[];
  for(const row of rows.slice(0,input.limit)) {
    const uId=Number(row.u_id),[logs]=await ctx.db.query<RowDataPacket[]>('SELECT thedata FROM urt_log WHERE u_id=? AND (themonth IS NULL OR themonth>=?) ORDER BY pk DESC LIMIT 3',[uId,month]);
    if(!logs.length)continue;
    const values=channelDeltas(logs.map(r=>r.thedata),today);
    if(!values)skipped.push({uId,reason:'invalid_log_payload'});
    if(!ctx.execute)continue;
    await ctx.assertOwnership();
    await ctx.db.execute("INSERT INTO ts_cache_item_state(workflow,item_key,source_stamp,processed_at) VALUES('reports.counts.build',?,?,?) ON DUPLICATE KEY UPDATE source_stamp=VALUES(source_stamp),processed_at=VALUES(processed_at)",[String(uId),at,at]);
    await update(ctx.db,'urt_count',{u_id:uId},{...(values??{}),mtime:at});
    if(values)applied.push(uId);
  }
  return {mode:ctx.execute?'execute':'dry-run',selected:Math.min(rows.length,input.limit),truncated:rows.length>input.limit,applied,skipped};
}
const INSUFFICIENT_HISTORY_RECHECK_MS = 2 * 3600000;
/** Laravel ScheduleReportsPreview: rows refreshed (mtime) within the last `hours` (default 1) that have view history, oldest
 * mtime first; the latest two history rows by pk give the next stime from the row mtime, and both stime and mtime=now are
 * written. A single sample at/before publication cannot establish a growth rate: explicitly defer to a new observation
 * no later than the existing minimum polling interval, preserving an earlier scheduled check so report ticks cannot
 * postpone observation indefinitely. Source timestamps stay unchanged. Invalid history
 * still only bumps mtime (cooldown) and remains a failed item. */
export async function scheduleCacheJob(ctx:CacheContext,input:{videoId?:string;limit:number;hours?:number}) {
  cap(input.limit,200);const hours=cap(input.hours??1,168),at=taipeiSql(ctx.now);
  const [rows]=await ctx.db.query<RowDataPacket[]>(`SELECT s.pk,s.videoId,s.publishedAt,s.mtime,s.stime FROM urt_video_schedule s WHERE s.mtime>=? ${input.videoId?'AND s.videoId=? AND s.videoId=BINARY ?':''} AND EXISTS (SELECT 1 FROM urt_video_log_history h WHERE h.videoId=s.videoId) ORDER BY s.mtime,s.videoId LIMIT ?`,[taipeiSql(new Date(ctx.now.getTime()-hours*3600000)),...(input.videoId?[input.videoId,input.videoId]:[]),input.limit+1]);
  const applied:string[]=[],skipped:{videoId:string;reason:string}[]=[],deferred:{videoId:string;reason:'insufficient_history';nextCheckAt:string}[]=[];
  for(const row of rows.slice(0,input.limit)) {
    const [history]=await ctx.db.query<RowDataPacket[]>('SELECT ctime,viewCount FROM urt_video_log_history WHERE videoId=? AND videoId=BINARY ? ORDER BY pk DESC LIMIT 2',[row.videoId,row.videoId]);
    const current=history[0],previous=history[1],currentTime=legacyInstant(current?.ctime),publishedTime=legacyInstant(row.publishedAt),previousTime=previous?.ctime?legacyInstant(previous.ctime):publishedTime,mtime=legacyInstant(row.mtime);
    const elapsed=currentTime&&previousTime?Math.floor(currentTime.getTime()/1000)-Math.floor(previousTime.getTime()/1000)+1:0;
    let stime:string|null=null;
    if(currentTime&&mtime&&!previous&&(!row.publishedAt||publishedTime&&currentTime.getTime()<=publishedTime.getTime())){
      const existingCheck=legacyInstant(row.stime);
      stime=taipeiSql(new Date(Math.min(existingCheck?.getTime()??Infinity,ctx.now.getTime()+INSUFFICIENT_HISTORY_RECHECK_MS)));
      deferred.push({videoId:row.videoId,reason:'insufficient_history',nextCheckAt:stime});
    }else if(currentTime&&previousTime&&mtime&&elapsed>0){
      const delta=Math.max(1,phpInt(current!.viewCount)-phpInt(previous?.viewCount??0)),perHour=delta/(elapsed/3600);
      let hoursPer1000=perHour>0?1000/perHour:3000;if(hoursPer1000>1000)hoursPer1000=3000;if(hoursPer1000<2)hoursPer1000=2;
      stime=taipeiSql(new Date(mtime.getTime()+Math.round(hoursPer1000*3600)*1000));
    }
    if(!stime)skipped.push({videoId:row.videoId,reason:'invalid_history_payload'});
    if(!ctx.execute)continue;
    await ctx.assertOwnership();
    await update(ctx.db,'urt_video_schedule',{pk:row.pk},{...(stime?{stime}:{}),mtime:at});
    await ctx.db.execute("INSERT INTO ts_cache_item_state(workflow,item_key,source_stamp,processed_at) VALUES('reports.schedule.build',?,?,?) ON DUPLICATE KEY UPDATE source_stamp=VALUES(source_stamp),processed_at=VALUES(processed_at)",[row.videoId,row.mtime,at]);
    if(stime)applied.push(row.videoId);
  }
  return {mode:ctx.execute?'execute':'dry-run',selected:Math.min(rows.length,input.limit),truncated:rows.length>input.limit,applied,skipped,deferred};
}
export async function liveCleanupJob(ctx:CacheContext,limit:number) {
  cap(limit,200);const stale=taipeiSql(new Date(ctx.now.getTime()-3600000)),scheduled=taipeiSql(new Date(ctx.now.getTime()-7200000)),at=taipeiSql(ctx.now);
  // Laravel LiveCleanupPreview: only del_flag IS NULL rows (a stored 0 is left alone), oldest mtime then videoId first.
  const predicate='(mtime IS NULL OR mtime<?) AND actualEndTime IS NULL AND (scheduledStartTime IS NULL OR scheduledStartTime<?) AND del_flag IS NULL AND ctime<?';
  const [rows]=await ctx.db.query<RowDataPacket[]>(`SELECT pk,videoId FROM urt_video_live WHERE ${predicate} ORDER BY mtime,videoId LIMIT ?`,[stale,scheduled,at,limit+1]);
  if(ctx.execute)for(const row of rows.slice(0,limit)){await ctx.assertOwnership();await ctx.db.execute(`UPDATE urt_video_live SET del_flag=1 WHERE pk=? AND ${predicate}`,[row.pk,stale,scheduled,at]);}
  return {mode:ctx.execute?'execute':'dry-run',selected:Math.min(rows.length,limit),truncated:rows.length>limit,applied:ctx.execute?rows.slice(0,limit).map(r=>r.videoId):[],skipped:[]};
}
/** Laravel LiveDisplayCachePreview: live rows created within `hours` without a display row and WITH video metadata, newest
 * live ctime first (limit clamped to 100). Live rows lacking urt_video metadata never consume the limit; they are reported as
 * failures (Laravel counts every one of them in failed_rows). */
export async function liveDisplayCacheJob(ctx:CacheContext,input:{hours:number;limit:number}) {
  cap(input.hours,720);cap(input.limit,100);const since=taipeiSql(new Date(ctx.now.getTime()-input.hours*3600000)),at=taipeiSql(ctx.now);
  const missing='FROM urt_video_live l LEFT JOIN urt_show_video_live s ON s.pk_live=l.pk WHERE l.ctime>? AND s.pk_live IS NULL';
  const [rows]=await ctx.db.query<RowDataPacket[]>(`SELECT l.pk AS live_pk,l.u_id AS live_u_id,l.publishedAt AS live_published_at,v.* ${missing.replace('WHERE','JOIN urt_video v ON v.videoId=l.videoId AND BINARY v.videoId=BINARY l.videoId WHERE')} ORDER BY l.ctime DESC,l.pk DESC LIMIT ?`,[since,input.limit+1]);
  const [orphans]=await ctx.db.query<RowDataPacket[]>(`SELECT l.pk AS live_pk ${missing} AND NOT EXISTS (SELECT 1 FROM urt_video v WHERE v.videoId=l.videoId AND BINARY v.videoId=BINARY l.videoId) ORDER BY l.ctime DESC,l.pk DESC LIMIT ?`,[since,input.limit]);
  const applied:number[]=[],skipped:{pk:number;reason:string}[]=orphans.map(r=>({pk:Number(r.live_pk),reason:'missing-video-metadata'}));
  for(const r of rows.slice(0,input.limit)){if(!ctx.execute)continue;await ctx.assertOwnership();const values=Object.fromEntries(['videoId','channelId','channelTitle','title','thumbnails','description'].map(k=>[k,r[k]]));await upsert(ctx.db,'urt_show_video_live',{pk_live:r.live_pk},{ctime:at,mtime:at,v_pk:r.pk,...values,u_id:r.u_id??r.live_u_id,publishedAt:r.publishedAt??r.live_published_at});applied.push(r.live_pk);}
  return {mode:ctx.execute?'execute':'dry-run',selected:Math.min(rows.length,input.limit),truncated:rows.length>input.limit,applied,skipped};
}
export function liveDayMetrics(rows:RowDataPacket[],dictionary:TagDictionary) {
  const videoHours=new Map<string,Record<string,number>>(),tagViews=new Map<string,Record<string,number>>(),tagVideos=new Map<string,Record<string,number>>(),hoursViews:Record<string,number>={},hoursVideos:Record<string,number>={},channels=new Set<number>();let totalViews=0,countTags=0;
  for(const r of rows){if(typeof r.title!=='string'||!r.videoId||videoHours.has(r.videoId))throw new Error('Missing or duplicate live video metadata: '+String(r.videoId).slice(0,32));
    const points=jsonMap(r.log_json),peaks:Record<string,number>={};
    for(const [time,value] of Object.entries(points)){if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)||unsigned(value)===null)throw new Error('Invalid live history point: '+String(r.videoId).slice(0,32));const hour=time.slice(0,2);peaks[hour]=Math.max(peaks[hour]??0,Number(value));}
    if(!Object.keys(peaks).length)throw new Error('Missing live history observations');
    videoHours.set(r.videoId,peaks);if(Number(r.u_id)>0)channels.add(Number(r.u_id));totalViews=checkedSum(totalViews,Math.max(...Object.values(peaks)));
    const terms=new Set(dictionary.match(r.title,'').map(m=>m.term));countTags+=terms.size;
    for(const [hour,views]of Object.entries(peaks)){hoursViews[hour]=checkedSum(hoursViews[hour]??0,views);hoursVideos[hour]=(hoursVideos[hour]??0)+1;for(const term of terms){const v=tagViews.get(term)??{},n=tagVideos.get(term)??{};v[hour]=checkedSum(v[hour]??0,views);n[hour]=(n[hour]??0)+1;tagViews.set(term,v);tagVideos.set(term,n);}}
  }
  return {count_channels:channels.size,count_videos:videoHours.size,count_tags:countTags,tags_count:tagViews.size,total_views:totalViews,hour_result:JSON.stringify(Object.fromEntries(Object.keys(hoursViews).sort().map(h=>[h,{count:hoursVideos[h],views:hoursViews[h]}]))),videos_result:JSON.stringify(Object.fromEntries(videoHours)),all_result:JSON.stringify({videos:hoursVideos,views:hoursViews}),tags_video:JSON.stringify(Object.fromEntries(tagVideos)),tags_views:JSON.stringify(Object.fromEntries(tagViews))};
}
export async function liveTagDateCacheJob(ctx:CacheContext,input:CacheInput,dictionary:TagDictionary){
  if(input.to>taipeiSql(ctx.now).slice(0,10))throw new Error('Future live cache dates are forbidden');
  const channels=await cacheChannels(ctx,input),prepared=[];let preparedBytes=0;
  for(const day of daysBetween(input.from,input.to)){
    if(channels.length){const [sizes]=await ctx.db.query<RowDataPacket[]>(`SELECT COUNT(*) AS n,COALESCE(SUM(OCTET_LENGTH(log_json)),0) AS bytes FROM (SELECT log_json FROM urt_video_live_log WHERE the_date=? AND u_id IN (${channels.map(()=>'?').join(',')}) ORDER BY pk LIMIT ?) bounded`,[day,...channels,input.videoLimit+1]);if(Number(sizes[0]?.n)>input.videoLimit||Number(sizes[0]?.bytes)>16*1024*1024)throw new Error('Live cache source cap reached');}
    const [rows]=channels.length?await ctx.db.query<RowDataPacket[]>(`SELECT l.*,v.title FROM urt_video_live_log l LEFT JOIN urt_video v ON v.videoId=l.videoId AND BINARY v.videoId=BINARY l.videoId WHERE l.the_date=? AND l.u_id IN (${channels.map(()=>'?').join(',')}) ORDER BY l.pk LIMIT ?`,[day,...channels,input.videoLimit+1]):[[]];
    if(rows.length>input.videoLimit)throw new Error('Live cache source cap reached');const values=liveDayMetrics(rows,dictionary);preparedBytes+=Buffer.byteLength(JSON.stringify(values));if(preparedBytes>16*1024*1024)throw new Error('Live cache batch payload cap reached');prepared.push({day,values});
  }
  for(const p of prepared)if(ctx.execute){await ctx.assertOwnership();await ctx.db.execute('INSERT INTO ts_live_tag_cache_lineage(selection_key,the_date,vocabulary_version,coverage,rule_version,status,generated_at,unknown_view_videos) VALUES(?,?,?,?,?,?,?,0) ON DUPLICATE KEY UPDATE vocabulary_version=VALUES(vocabulary_version),coverage=VALUES(coverage),rule_version=VALUES(rule_version),status=VALUES(status),generated_at=VALUES(generated_at),unknown_view_videos=0',[selectionKey(input),p.day,dictionary.version,dictionary.coverage,'youtube-live-hourly-peaks-v1','pending',taipeiSql(ctx.now)]);await publishCache(ctx,'urt_show_live_tag_date',{...dateKeys(input),the_date:p.day},p.values,{...dictionary,rule:'youtube-live-hourly-peaks-v1'});await ctx.db.execute('UPDATE ts_live_tag_cache_lineage SET status=?,window_from=?,window_to=?,window_closed=? WHERE selection_key=? AND the_date=?',['published',p.day,p.day,p.day<taipeiSql(ctx.now).slice(0,10),selectionKey(input),p.day]);}
  return {mode:ctx.execute?'execute':'dry-run',selected:prepared.length,applied:ctx.execute?prepared.map(p=>p.day):[],skipped:[]};
}
/** Laravel LiveCleanupPreview::tagDateCachePreview: newest ctime first, limit clamped to 200. TS-published rows (with live
 * lineage) are never treated as premature legacy caches. */
export async function liveCacheCleanJob(ctx:CacheContext,limit:number){
  cap(limit,200);const predicate='ctime IS NOT NULL AND the_date IS NOT NULL AND CAST(the_date AS DATETIME)>DATE_SUB(ctime,INTERVAL 2 DAY)';
  // Published TS caches may legitimately cover today; legacy invalidation must never purge them.
  const [rows]=await ctx.db.query<RowDataPacket[]>(`SELECT s.* FROM urt_show_live_tag_date s WHERE ${predicate} AND NOT EXISTS (SELECT 1 FROM ts_live_tag_cache_lineage l WHERE l.the_date=s.the_date AND JSON_COMPACT(JSON_EXTRACT(l.selection_key,'$[0]'))=CONCAT('[',COALESCE(s.tagid,''),']') AND JSON_COMPACT(JSON_EXTRACT(l.selection_key,'$[1]'))=CONCAT('[',COALESCE(s.tag_or,''),']') AND JSON_COMPACT(JSON_EXTRACT(l.selection_key,'$[2]'))=CONCAT('[',COALESCE(s.tag_not,''),']')) ORDER BY ctime DESC,pk LIMIT ?`,[limit+1]);
  const applied:number[]=[];
  for(const r of rows.slice(0,limit))if(ctx.execute){
    // Verify lineage using the exact application key; the SQL prefilter intentionally isn't trusted for deletion.
    const parse=(v:unknown)=>v===null||v===''?[]:String(v).split(',').map(Number);const key=JSON.stringify([parse(r.tagid),parse(r.tag_or),parse(r.tag_not)]);
    const [lineage]=await ctx.db.query<RowDataPacket[]>('SELECT 1 FROM ts_live_tag_cache_lineage WHERE selection_key=? AND the_date=?',[key,r.the_date]);if(lineage.length)continue;
    await ctx.assertOwnership();await ctx.db.execute('INSERT INTO ts_report_cache_archive(cache_table,source_pk,archived_at,reason,payload) VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE archived_at=VALUES(archived_at),payload=VALUES(payload)',['urt_show_live_tag_date',r.pk,taipeiSql(ctx.now),'legacy-premature-date-cache',JSON.stringify(r)]);
    await ctx.db.execute(`DELETE FROM urt_show_live_tag_date WHERE pk=? AND ${predicate}`,[r.pk]);applied.push(r.pk);
  }
  return {mode:ctx.execute?'execute':'dry-run',selected:Math.min(rows.length,limit),truncated:rows.length>limit,applied,skipped:[]};
}
