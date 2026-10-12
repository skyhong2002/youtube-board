import type { RowDataPacket } from 'mysql2/promise';
import { cap } from './channel-jobs.js';
import { jsonMap, legacyInstant, selectOne, taipeiSql, update, upsert } from './legacy-db.js';
import { unsigned } from './youtube.js';
import { cacheChannels, checkedSum, dateKeys, daysBetween, publishCache, selectionKey, type CacheContext, type CacheInput } from './report-caches.js';
import type { TagDictionary } from './tag-backfill.js';
export function channelDeltas(logs:unknown[],day:string) {
  const series:Record<string,unknown>=Object.create(null);for(const log of logs)Object.assign(series,jsonMap(log));
  for(const [date,raw] of Object.entries(series)) {
    daysBetween(date,date);if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('Invalid channel observation');const p=raw as Record<string,unknown>;
    if(unsigned(p.view)===null||unsigned(p.video)===null||(p.subscriber===undefined?p.hidden!==true:unsigned(p.subscriber)===null)||(p.hidden!==undefined&&typeof p.hidden!=='boolean'))throw new Error('Invalid channel observation');
  }
  let latest:Record<string,unknown>|undefined;const result:Record<string,number|null>={view_week:null,video_week:null,view_month:null,video_month:null,sub_week:null,sub_month:null};
  for(let i=0;i<30;i++) {const date=new Date(Date.parse(day)-i*86400000).toISOString().slice(0,10),p=series[date] as Record<string,unknown>|undefined;if(!p)continue;
    if(!latest){latest=p;continue;}
    for(const window of i<=7?['week','month']:['month']) {
      result['view_'+window]=Number(latest.view)-Number(p.view);result['video_'+window]=Number(latest.video)-Number(p.video);
      result['sub_'+window]=latest.hidden!==true&&p.hidden!==true&&latest.subscriber!==undefined&&p.subscriber!==undefined?Number(latest.subscriber)-Number(p.subscriber):null;
    }
  }
  if(!latest)throw new Error('No recent channel observation');return result;
}
export async function countsCacheJob(ctx:CacheContext,input:{uId?:number;limit:number}) {
  cap(input.limit,100);if(input.uId)cap(input.uId,2147483647);
  const [rows]=await ctx.db.query<RowDataPacket[]>(`SELECT c.* FROM urt_count c LEFT JOIN ts_cache_item_state p ON p.workflow='reports.counts.build' AND p.item_key=CAST(c.u_id AS CHAR) ${input.uId?'WHERE c.u_id=?':''} ORDER BY p.processed_at,c.mtime,c.u_id LIMIT ?`,[...(input.uId?[input.uId]:[]),input.limit+1]);
  const applied:number[]=[],skipped:{uId:number;reason:string}[]=[],unavailable:number[]=[];
  for(const row of rows.slice(0,input.limit)) {
    const since=new Date(ctx.now.getTime()-31*86400000),month=taipeiSql(since).slice(0,7)+'-01';
    if(ctx.execute){await ctx.assertOwnership();await ctx.db.execute("INSERT INTO ts_cache_item_state(workflow,item_key,source_stamp,processed_at) VALUES('reports.counts.build',?,?,?) ON DUPLICATE KEY UPDATE source_stamp=VALUES(source_stamp),processed_at=VALUES(processed_at)",[String(row.u_id),taipeiSql(ctx.now),taipeiSql(ctx.now)]);}
    const [logs]=await ctx.db.query<RowDataPacket[]>('SELECT thedata FROM urt_log WHERE u_id=? AND (themonth IS NULL OR themonth>=?) ORDER BY pk LIMIT 4',[row.u_id,month]);
    let values:ReturnType<typeof channelDeltas>;
    try {if(logs.length>3)throw new Error('Duplicate channel months');values=channelDeltas(logs.map(r=>r.thedata),taipeiSql(ctx.now).slice(0,10));}
    catch(error) {if(error instanceof Error&&error.message==='No recent channel observation'){unavailable.push(row.u_id);if(ctx.execute){await ctx.assertOwnership();await update(ctx.db,'urt_count',{u_id:row.u_id},{view_week:null,video_week:null,view_month:null,video_month:null,sub_week:null,sub_month:null});}}else skipped.push({uId:row.u_id,reason:'invalid-channel-history'});continue;}
    if(ctx.execute){await ctx.assertOwnership();await update(ctx.db,'urt_count',{u_id:row.u_id},{...values,mtime:taipeiSql(ctx.now)});applied.push(row.u_id);}
  }
  return {mode:ctx.execute?'execute':'dry-run',selected:Math.min(rows.length,input.limit),truncated:rows.length>input.limit,applied,skipped,unavailable};
}
export async function scheduleCacheJob(ctx:CacheContext,input:{videoId?:string;limit:number}) {
  cap(input.limit,200);const [rows]=await ctx.db.query<RowDataPacket[]>(`SELECT s.* FROM urt_video_schedule s LEFT JOIN ts_cache_item_state p ON p.workflow='reports.schedule.build' AND p.item_key=s.videoId WHERE s.mtime IS NOT NULL ${input.videoId?'AND BINARY s.videoId=BINARY ?':"AND (p.source_stamp IS NULL OR p.source_stamp<>s.mtime)"} ORDER BY s.mtime,s.pk LIMIT ?`,[...(input.videoId?[input.videoId]:[]),input.limit+1]);
  const applied:string[]=[],skipped:{videoId:string;reason:string}[]=[];
  for(const row of rows.slice(0,input.limit)) {
    const [history]=await ctx.db.query<RowDataPacket[]>('SELECT ctime,viewCount FROM urt_video_log_history WHERE BINARY videoId=BINARY ? AND viewCount IS NOT NULL ORDER BY ctime DESC,pk DESC LIMIT 2',[row.videoId]);
    const current=history[0],previous=history[1],currentTime=legacyInstant(current?.ctime),previousTime=legacyInstant(previous?.ctime??row.publishedAt),mtime=legacyInstant(row.mtime);
    if(!currentTime||!previousTime||!mtime||unsigned(current?.viewCount)===null||(previous&&unsigned(previous.viewCount)===null)||currentTime<=previousTime){if(ctx.execute){await ctx.assertOwnership();await ctx.db.execute("INSERT INTO ts_cache_item_state(workflow,item_key,source_stamp,processed_at) VALUES('reports.schedule.build',?,?,?) ON DUPLICATE KEY UPDATE source_stamp=VALUES(source_stamp),processed_at=VALUES(processed_at)",[row.videoId,row.mtime,taipeiSql(ctx.now)]);}skipped.push({videoId:row.videoId,reason:'missing-or-invalid-statistics-history'});continue;}
    const elapsed=(currentTime.getTime()-previousTime.getTime())/1000+1,delta=Math.max(1,Number(current!.viewCount)-Number(previous?.viewCount??0));let hours=1000*elapsed/3600/delta;if(hours>1000)hours=3000;hours=Math.max(2,hours);
    if(ctx.execute){await ctx.assertOwnership();await update(ctx.db,'urt_video_schedule',{pk:row.pk},{stime:taipeiSql(new Date(mtime.getTime()+Math.round(hours*3600)*1000))});await ctx.db.execute("INSERT INTO ts_cache_item_state(workflow,item_key,source_stamp,processed_at) VALUES('reports.schedule.build',?,?,?) ON DUPLICATE KEY UPDATE source_stamp=VALUES(source_stamp),processed_at=VALUES(processed_at)",[row.videoId,row.mtime,taipeiSql(ctx.now)]);applied.push(row.videoId);}
  }
  return {mode:ctx.execute?'execute':'dry-run',selected:Math.min(rows.length,input.limit),truncated:rows.length>input.limit,applied,skipped};
}
export async function liveCleanupJob(ctx:CacheContext,limit:number) {
  cap(limit,200);const stale=taipeiSql(new Date(ctx.now.getTime()-3600000)),scheduled=taipeiSql(new Date(ctx.now.getTime()-7200000)),at=taipeiSql(ctx.now);
  const predicate='(mtime IS NULL OR mtime<?) AND actualEndTime IS NULL AND (scheduledStartTime IS NULL OR scheduledStartTime<?) AND COALESCE(del_flag,0)=0 AND ctime<?';
  const [rows]=await ctx.db.query<RowDataPacket[]>(`SELECT pk,videoId FROM urt_video_live WHERE ${predicate} ORDER BY mtime,pk LIMIT ?`,[stale,scheduled,at,limit+1]);
  if(ctx.execute)for(const row of rows.slice(0,limit)){await ctx.assertOwnership();await ctx.db.execute(`UPDATE urt_video_live SET del_flag=1 WHERE pk=? AND ${predicate}`,[row.pk,stale,scheduled,at]);}
  return {mode:ctx.execute?'execute':'dry-run',selected:Math.min(rows.length,limit),truncated:rows.length>limit,applied:ctx.execute?rows.slice(0,limit).map(r=>r.videoId):[],skipped:[]};
}
export async function liveDisplayCacheJob(ctx:CacheContext,input:{hours:number;limit:number}) {
  cap(input.hours,720);cap(input.limit,500);const [rows]=await ctx.db.query<RowDataPacket[]>(`SELECT l.pk AS live_pk,v.* FROM urt_video_live l LEFT JOIN urt_video v ON BINARY v.videoId=BINARY l.videoId LEFT JOIN urt_show_video_live s ON s.pk_live=l.pk WHERE l.ctime>? AND s.pk_live IS NULL ORDER BY l.ctime,l.pk LIMIT ?`,[taipeiSql(new Date(ctx.now.getTime()-input.hours*3600000)),input.limit+1]);
  const applied:number[]=[],skipped:{pk:number;reason:string}[]=[];
  for(const r of rows.slice(0,input.limit)){if(!r.pk){skipped.push({pk:r.live_pk,reason:'missing-video-metadata'});continue;}if(ctx.execute){await ctx.assertOwnership();const values=Object.fromEntries(['videoId','u_id','publishedAt','channelId','channelTitle','title','thumbnails','description'].map(k=>[k,r[k]]));await upsert(ctx.db,'urt_show_video_live',{pk_live:r.live_pk},{v_pk:r.pk,ctime:taipeiSql(ctx.now),mtime:taipeiSql(ctx.now),...values});applied.push(r.live_pk);}}
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
    const [rows]=channels.length?await ctx.db.query<RowDataPacket[]>(`SELECT l.*,v.title FROM urt_video_live_log l LEFT JOIN urt_video v ON BINARY v.videoId=BINARY l.videoId WHERE l.the_date=? AND l.u_id IN (${channels.map(()=>'?').join(',')}) ORDER BY l.pk LIMIT ?`,[day,...channels,input.videoLimit+1]):[[]];
    if(rows.length>input.videoLimit)throw new Error('Live cache source cap reached');const values=liveDayMetrics(rows,dictionary);preparedBytes+=Buffer.byteLength(JSON.stringify(values));if(preparedBytes>16*1024*1024)throw new Error('Live cache batch payload cap reached');prepared.push({day,values});
  }
  for(const p of prepared)if(ctx.execute){await ctx.assertOwnership();await ctx.db.execute('INSERT INTO ts_live_tag_cache_lineage(selection_key,the_date,vocabulary_version,coverage,rule_version,status,generated_at,unknown_view_videos) VALUES(?,?,?,?,?,?,?,0) ON DUPLICATE KEY UPDATE vocabulary_version=VALUES(vocabulary_version),coverage=VALUES(coverage),rule_version=VALUES(rule_version),status=VALUES(status),generated_at=VALUES(generated_at),unknown_view_videos=0',[selectionKey(input),p.day,dictionary.version,dictionary.coverage,'youtube-live-hourly-peaks-v1','pending',taipeiSql(ctx.now)]);await publishCache(ctx,'urt_show_live_tag_date',{...dateKeys(input),the_date:p.day},p.values,{...dictionary,rule:'youtube-live-hourly-peaks-v1'});await ctx.db.execute('UPDATE ts_live_tag_cache_lineage SET status=?,window_from=?,window_to=?,window_closed=? WHERE selection_key=? AND the_date=?',['published',p.day,p.day,p.day<taipeiSql(ctx.now).slice(0,10),selectionKey(input),p.day]);}
  return {mode:ctx.execute?'execute':'dry-run',selected:prepared.length,applied:ctx.execute?prepared.map(p=>p.day):[],skipped:[]};
}
export async function liveCacheCleanJob(ctx:CacheContext,limit:number){
  cap(limit,200);const predicate='ctime IS NOT NULL AND the_date IS NOT NULL AND CAST(the_date AS DATETIME)>DATE_SUB(ctime,INTERVAL 2 DAY)';
  // Published TS caches may legitimately cover today; legacy invalidation must never purge them.
  const [rows]=await ctx.db.query<RowDataPacket[]>(`SELECT s.* FROM urt_show_live_tag_date s WHERE ${predicate} AND NOT EXISTS (SELECT 1 FROM ts_live_tag_cache_lineage l WHERE l.the_date=s.the_date AND JSON_COMPACT(JSON_EXTRACT(l.selection_key,'$[0]'))=CONCAT('[',COALESCE(s.tagid,''),']') AND JSON_COMPACT(JSON_EXTRACT(l.selection_key,'$[1]'))=CONCAT('[',COALESCE(s.tag_or,''),']') AND JSON_COMPACT(JSON_EXTRACT(l.selection_key,'$[2]'))=CONCAT('[',COALESCE(s.tag_not,''),']')) ORDER BY pk LIMIT ?`,[limit+1]);
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
