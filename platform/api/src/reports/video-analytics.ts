import {sql} from 'drizzle-orm';
import type {Reader,Row} from '../db/client.js';
import type {VideoAnalyticsData,AnalyticsAuthor,AnalyticsComment,AnalyticsHistory,AnalyticsPoint,VideoCommentSummary} from '../video-analytics-contracts.js';
import {bounded,videoId,dateFilter,NotFound,type Query} from './query.js';
import {integer,latest,text,object,timestamp,taipeiSql} from './normalize.js';
import type {Register} from './table.js';
export const ANALYTICS_LIMITS={liveRows:366,historyRows:120,commentBytes:8*1024*1024,authorBytes:2*1024*1024,logBytes:4*1024*1024,logRowBytes:65536,comments:20000};
const numeric=(v:unknown)=>{if(typeof v!=='number'&&typeof v!=='string'||typeof v==='string'&&!/^\d+$/.test(v))return null;const n=integer(v);return n!==null&&n>=0?n:null;};
function validDay(value:unknown):string|null{try{return dateFilter(value)??null;}catch{return null;}}
function map(value:unknown):Row|null{if(typeof value==='string'){try{return map(JSON.parse(value));}catch{return null;}}return value&&typeof value==='object'&&!Array.isArray(value)?value as Row:null;}
function maximum(a:number|null,b:number|null){return a===null?b:b===null?a:Math.max(a,b);}
function sum(a:number|null,b:number|null){return a===null||b===null||!Number.isSafeInteger(a+b)?null:a+b;}
function points(values:Map<string,number>,limit:number):AnalyticsPoint[]{return [...values].sort(([a],[b])=>a<b?-1:a>b?1:0).slice(-limit).map(([time,value])=>({time,value}));}
function commentTime(value:unknown):string|null{
 const raw=text(value);if(!/^\d{4}-\d{2}-\d{2}[ T](?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)?$/.test(raw)||!validDay(raw.slice(0,10)))return null;
 const normalized=timestamp(raw.includes('T')&&!/(?:Z|[+-]\d\d:\d\d)$/.test(raw)?raw.replace('T',' '):raw);return normalized&&Number.isFinite(Date.parse(normalized))?normalized:null;
}
function plain(item:Row){const original=text(item.textOriginal);if(original)return original.trim();return text(item.textDisplay).replace(/<[^<>]*>/g,'').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(_all,entity:string)=>{const named:Record<string,string>={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};if(entity[0]!=='#')return named[entity.toLowerCase()]??_all;const n=entity[1]?.toLowerCase()==='x'?Number.parseInt(entity.slice(2),16):Number(entity.slice(1));return Number.isInteger(n)&&n>0&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff)?String.fromCodePoint(n):_all;}).trim();}
export function parseVideoAnalytics(id:string,video:Row|undefined,liveRows:Row[],historyRows:Row[],comment:Row|undefined,limit:number):VideoAnalyticsData{
 const coverage:VideoAnalyticsData['evidenceCoverage']={liveRowCap:ANALYTICS_LIMITS.liveRows,historyMonthCap:ANALYTICS_LIMITS.historyRows,commentByteCap:ANALYTICS_LIMITS.commentBytes,commentEntryCap:ANALYTICS_LIMITS.comments,liveRowsRead:Math.min(liveRows.length,ANALYTICS_LIMITS.liveRows),historyRowsRead:Math.min(historyRows.length,ANALYTICS_LIMITS.historyRows),liveRowsTruncated:liveRows.length>ANALYTICS_LIMITS.liveRows,historyRowsTruncated:historyRows.length>ANALYTICS_LIMITS.historyRows,malformedLogRows:0,invalidLogPoints:0,skippedLogBytes:0,invalidComments:0,invalidCommentTimes:0,duplicateComments:0,truncatedCommentTexts:0,malformedAuthorMetadata:false,skippedLiveBytes:0,skippedHistoryBytes:0,skippedLiveRows:0,skippedHistoryRows:0,emptyLogRows:0,duplicateHistoryDays:0,commentsWithoutIds:0};
 const hourly=new Map<string,number>(),daily=new Map<string,number>(),history=new Map<string,AnalyticsHistory>();let maxCurrent:number|null=null;const bytesUsed={Live:0,History:0};
 const readLog=(raw:unknown,source:'Live'|'History',reported:unknown)=>{const bytes=numeric(reported)??(typeof raw==='string'?Buffer.byteLength(raw):0);if(bytes>ANALYTICS_LIMITS.logRowBytes||bytesUsed[source]+bytes>ANALYTICS_LIMITS.logBytes||(raw===null&&bytes>0)){coverage.skippedLogBytes=Number(coverage.skippedLogBytes)+bytes;coverage['skipped'+source+'Bytes']=Number(coverage['skipped'+source+'Bytes'])+bytes;coverage['skipped'+source+'Rows']=Number(coverage['skipped'+source+'Rows'])+1;return null;}bytesUsed[source]+=bytes;if(raw===null||raw===''){coverage.emptyLogRows=Number(coverage.emptyLogRows)+1;return null;}if(typeof raw!=='string'){coverage.malformedLogRows=Number(coverage.malformedLogRows)+1;return null;}const parsed=map(raw);if(!parsed)coverage.malformedLogRows=Number(coverage.malformedLogRows)+1;return parsed;};
 for(const r of liveRows.slice(0,ANALYTICS_LIMITS.liveRows)){
  const day=validDay(text(r.the_date).slice(0,10));if(!day){coverage.malformedLogRows=Number(coverage.malformedLogRows)+1;continue;}
  const recorded=numeric(r.max_current);maxCurrent=maximum(maxCurrent,recorded);if(recorded!==null)daily.set(day,Math.max(daily.get(day)??0,recorded));
  const log=readLog(r.log_json,'Live',r.log_bytes);if(!log)continue;
  for(const [time,value]of Object.entries(log)){const n=numeric(value);if(!/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(time)||n===null){coverage.invalidLogPoints=Number(coverage.invalidLogPoints)+1;continue;}const hour=day+'T'+time.slice(0,2)+':00:00+08:00';hourly.set(hour,Math.max(hourly.get(hour)??0,n));daily.set(day,Math.max(daily.get(day)??0,n));maxCurrent=maximum(maxCurrent,n);}
 }
 for(const r of historyRows.slice(0,ANALYTICS_LIMITS.historyRows)){
  const month=validDay(text(r.themonth).slice(0,10)),log=readLog(r.thedata,'History',r.log_bytes);if(!month||!log)continue;
  for(const [date,value]of Object.entries(log)){const v=map(value);if(!validDay(date)||date.slice(0,7)!==month.slice(0,7)||!v){coverage.invalidLogPoints=Number(coverage.invalidLogPoints)+1;continue;}if(history.has(date)){coverage.duplicateHistoryDays=Number(coverage.duplicateHistoryDays)+1;continue;}
   const row={date,views:numeric(v.view),likes:numeric(v.like),comments:numeric(v.comment)};if(row.views===null&&row.likes===null&&row.comments===null){coverage.invalidLogPoints=Number(coverage.invalidLogPoints)+1;continue;}history.set(date,row);
  }
 }
 const parsedComments=parseVideoComments(comment,limit),comments=parsedComments.comments;Object.assign(coverage,parsedComments.evidenceCoverage);
 coverage.hourlyLivePoints=hourly.size;coverage.dailyLivePoints=daily.size;coverage.historyPoints=history.size;
 return {id,title:text(video?.title)||id,channelTitle:text(video?.channelTitle),limit,updatedAt:latest(video?.mtime,video?.ctime,...liveRows.slice(0,ANALYTICS_LIMITS.liveRows).flatMap(r=>[r.mtime,r.ctime]),...historyRows.slice(0,ANALYTICS_LIMITS.historyRows).flatMap(r=>[r.mtime,r.ctime]),...(comment&&comments.status!=='pending'?[comment.mtime,comment.ctime]:[])),live:{maxCurrent,hourly:points(hourly,limit),daily:points(daily,limit)},history:[...history.values()].sort((a,b)=>a.date<b.date?-1:1).slice(-limit),comments,evidenceCoverage:coverage,notes:[`每組圖表／排名最多 ${limit} 筆；時間序列取最近時點，排名按觀測資料排序。`,`來源最多讀取最近 ${ANALYTICS_LIMITS.liveRows} 個直播日紀錄、${ANALYTICS_LIMITS.historyRows} 個統計月紀錄；資料量過大時會略過部分紀錄，可展開涵蓋範圍查看。`,'直播逐時取樣本最高值；逐日與整體高峰合併來源記錄與有效樣本取最高值，不加總；不同時間可能包含相同觀眾。','觀看、喜歡、留言歷史為累計快照；缺值維持空白，不補零或推算成長。','留言只公開已完成擷取的批次；回覆計入時間序列與作者總數。未收錄、移除或擷取失敗的留言不在其中，不推定帳號背後的真實人物。',`留言最多解析 20,000 則；格式錯誤或資料量過大的結果可能不完整，排名只描述實際解析範圍。`,'留言優先保留來源原文，每則最多顯示 10,000 字。無識別碼的舊回覆無法去重，會另列計數。','時間以 Asia/Taipei 呈現；直播時間鍵沿用資料擷取時的台北時間。沒有觀測點的時間不補零。']};
}
/** Both overview and analytics interpret the same bounded archive; display limit never changes counts. */
export function parseVideoComments(comment:Row|undefined,limit:number,summaryOnly=false){
 const coverage:VideoAnalyticsData['evidenceCoverage']={commentByteCap:ANALYTICS_LIMITS.commentBytes,commentEntryCap:ANALYTICS_LIMITS.comments,invalidComments:0,invalidCommentTimes:0,duplicateComments:0,truncatedCommentTexts:0,malformedAuthorMetadata:false,commentsWithoutIds:0};
 const comments:VideoAnalyticsData['comments']={status:comment?'complete':'missing',recordedCount:null,recordedAuthors:null,decodedCount:null,decodedAuthors:null,latestAt:null,hourly:[],daily:[],authors:[],top:[]};
 if(comment&&text(comment.pageToken)!=='')comments.status='pending';
 else if(comment){
  comments.recordedCount=numeric(comment.comments_count);comments.recordedAuthors=numeric(comment.authors_count);comments.latestAt=commentTime(comment.latest_time);
  if(Number(comment.payload_oversized??0)>0||Number(comment.comments_bytes??0)>ANALYTICS_LIMITS.commentBytes||Number(comment.authors_bytes??0)>ANALYTICS_LIMITS.authorBytes)comments.status='oversized';
  else{
   const decoded=comment.comments_json===null||comment.comments_json===''?{}:map(comment.comments_json),names=map(comment.authors_json);coverage.malformedAuthorMetadata=comment.authors_json!==null&&comment.authors_json!==undefined&&!names;if(!decoded)comments.status='malformed';else{
    const authors=new Map<string,AnalyticsAuthor>(),rows:AnalyticsComment[]=[],seen=new Set<string>(),hours=new Map<string,number>(),days=new Map<string,number>();let processed=0,decodedCount=0,truncated=false;
    const add=(key:string,value:unknown,reply:boolean)=>{if(processed>=ANALYTICS_LIMITS.comments){truncated=true;return;}processed++;const item=map(value);if(!item){coverage.invalidComments=Number(coverage.invalidComments)+1;return;}const ownId=text(item.id)||key;if(ownId&&seen.has(ownId)){coverage.duplicateComments=Number(coverage.duplicateComments)+1;return;}if(ownId)seen.add(ownId);else coverage.commentsWithoutIds=Number(coverage.commentsWithoutIds)+1;
     const publishedAt=commentTime(item.publishedAt),authorId=text(object(item.authorChannelId).value??item.authorChannelId),author=object(names?.[authorId]),authorName=text(author.DisplayName??author.displayName)||authorId||'未提供帳號',bodyPoints=Array.from(plain(item)),body=bodyPoints.slice(0,10000).join(''),likes=numeric(item.likeCount);
     if(bodyPoints.length>10000)coverage.truncatedCommentTexts=Number(coverage.truncatedCommentTexts)+1;
     if(!body&&!publishedAt&&!authorId){coverage.invalidComments=Number(coverage.invalidComments)+1;return;}
     if(publishedAt){if(!summaryOnly){const day=taipeiSql(new Date(publishedAt)).slice(0,10),hour=taipeiSql(new Date(publishedAt)).slice(0,13)+':00:00';hours.set(hour,(hours.get(hour)??0)+1);days.set(day,(days.get(day)??0)+1);}}else coverage.invalidCommentTimes=Number(coverage.invalidCommentTimes)+1;
     if(authorId){const a=authors.get(authorId)??{id:authorId,name:authorName,comments:0,replies:0,total:0,likes:0};a[reply?'replies':'comments']++;a.total++;a.likes=sum(a.likes,likes);authors.set(authorId,a);}
     decodedCount++;if(!summaryOnly)rows.push({id:ownId,authorId:authorId||null,authorName,text:body,likes,publishedAt,reply});
    };
    outer:for(const [key,value]of Object.entries(decoded)){if(processed>=ANALYTICS_LIMITS.comments){truncated=true;break;}add(key,value,false);const raw=(map(value)??{}).replies,children=Array.isArray(raw)?raw.map((v,i)=>[text(object(v).id)||'',v] as const):Object.entries(map(raw)??{});for(const [childId,child]of children){if(processed>=ANALYTICS_LIMITS.comments){truncated=true;break outer;}add(childId,child,true);}}
    comments.status=truncated?'truncated':'complete';comments.decodedCount=decodedCount;comments.decodedAuthors=authors.size;if(!summaryOnly){comments.hourly=points(hours,limit).map(p=>({...p,time:p.time.replace(' ','T')+'+08:00'}));comments.daily=points(days,limit);comments.authors=[...authors.values()].sort((a,b)=>b.total-a.total||(a.id<b.id?-1:1)).slice(0,limit);comments.top=rows.sort((a,b)=>(b.likes??-1)-(a.likes??-1)||(a.id<b.id?-1:a.id>b.id?1:0)).slice(0,limit);}
   }
  }
 }
 coverage.commentStatus=comments.status;coverage.decodedComments=['complete','truncated'].includes(comments.status)?comments.decodedCount:null;coverage.decodedAuthors=['complete','truncated'].includes(comments.status)?comments.decodedAuthors:null;coverage.commentCountMismatch=['complete','truncated'].includes(comments.status)&&comments.recordedCount!==null?comments.recordedCount!==comments.decodedCount:null;
 return {comments,evidenceCoverage:coverage};
}

export function summarizeVideoComments(comment:Row|undefined):VideoCommentSummary{
 const {comments,evidenceCoverage}=parseVideoComments(comment,1,true),available=comments.status==='complete'||comments.status==='truncated';
 return {status:comments.status,recordedCount:comments.recordedCount,recordedAuthors:comments.recordedAuthors,decodedCount:available?comments.decodedCount:null,decodedAuthors:available?comments.decodedAuthors:null,latestAt:comments.latestAt,updatedAt:comments.status==='pending'?null:latest(comment?.mtime,comment?.ctime),evidenceCoverage};
}
/** Excludes unfinished and over-budget payloads in SQL; indexed lookup is additionally byte-exact. */
export async function loadVideoComments(reader:Reader,id:string):Promise<Row[]>{return reader.rows(sql`SELECT pk,pageToken,comments_count,authors_count,latest_time,ctime,mtime,OCTET_LENGTH(comments_json) AS comments_bytes,OCTET_LENGTH(authors_json) AS authors_bytes,(COALESCE(OCTET_LENGTH(comments_json),0)+COALESCE(OCTET_LENGTH(authors_json),0)>GREATEST(0,@@max_allowed_packet-65536)) AS payload_oversized,CASE WHEN COALESCE(pageToken,'')='' AND COALESCE(OCTET_LENGTH(comments_json),0)+COALESCE(OCTET_LENGTH(authors_json),0)<=GREATEST(0,@@max_allowed_packet-65536) AND OCTET_LENGTH(comments_json)<=${ANALYTICS_LIMITS.commentBytes} AND COALESCE(OCTET_LENGTH(authors_json),0)<=${ANALYTICS_LIMITS.authorBytes} THEN comments_json ELSE NULL END AS comments_json,CASE WHEN COALESCE(pageToken,'')='' AND COALESCE(OCTET_LENGTH(comments_json),0)+COALESCE(OCTET_LENGTH(authors_json),0)<=GREATEST(0,@@max_allowed_packet-65536) AND COALESCE(OCTET_LENGTH(comments_json),0)<=${ANALYTICS_LIMITS.commentBytes} AND OCTET_LENGTH(authors_json)<=${ANALYTICS_LIMITS.authorBytes} THEN authors_json ELSE NULL END AS authors_json FROM urt_comment WHERE videoId=${id} AND BINARY videoId=BINARY ${id} ORDER BY pk DESC LIMIT 1`);}
export function registerVideoAnalytics(register:Register,reader:Reader){register('/videos/:id/analytics',async(p,q:Query)=>{
 const id=videoId(p.id),limit=bounded(q.limit,50,1,200);
 const [video,live,history,comment]=await Promise.all([
  reader.rows(sql`SELECT videoId,title,channelTitle,mtime,ctime FROM urt_video WHERE videoId=${id} AND BINARY videoId=BINARY ${id} ORDER BY pk DESC LIMIT 1`),
  reader.rows(sql`SELECT pk,the_date,max_current,ctime,mtime,OCTET_LENGTH(log_json) AS log_bytes,CASE WHEN OCTET_LENGTH(log_json)<=${ANALYTICS_LIMITS.logRowBytes} AND SUM(COALESCE(OCTET_LENGTH(log_json),0)) OVER (ORDER BY the_date DESC,pk DESC ROWS UNBOUNDED PRECEDING)<=${ANALYTICS_LIMITS.logBytes} THEN log_json ELSE NULL END AS log_json FROM (SELECT pk,the_date,max_current,log_json,ctime,mtime FROM urt_video_live_log WHERE videoId=${id} AND BINARY videoId=BINARY ${id} ORDER BY the_date DESC,pk DESC LIMIT ${ANALYTICS_LIMITS.liveRows+1}) bounded_live ORDER BY the_date DESC,pk DESC`),
  reader.rows(sql`SELECT pk,themonth,ctime,mtime,OCTET_LENGTH(thedata) AS log_bytes,CASE WHEN OCTET_LENGTH(thedata)<=${ANALYTICS_LIMITS.logRowBytes} AND SUM(COALESCE(OCTET_LENGTH(thedata),0)) OVER (ORDER BY themonth DESC,pk DESC ROWS UNBOUNDED PRECEDING)<=${ANALYTICS_LIMITS.logBytes} THEN thedata ELSE NULL END AS thedata FROM (SELECT pk,themonth,thedata,ctime,mtime FROM urt_video_log WHERE videoId=${id} AND BINARY videoId=BINARY ${id} ORDER BY themonth DESC,pk DESC LIMIT ${ANALYTICS_LIMITS.historyRows+1}) bounded_history ORDER BY themonth DESC,pk DESC`),
  loadVideoComments(reader,id),
 ]);
 if(!video.length&&!live.length&&!history.length&&(!comment.length||text(comment[0]?.pageToken)!==''))throw new NotFound();
 return parseVideoAnalytics(id,video[0],live,history,comment[0],limit);
});}
