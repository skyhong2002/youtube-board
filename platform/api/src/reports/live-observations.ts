import {sql,type SQL} from 'drizzle-orm';
import type {Reader,Row} from '../db/client.js';
import {ReportReadBound} from './cache-weights.js';
import {integer,text,tags} from './normalize.js';
export const liveChannelTitleSql=sql`COALESCE(c.title,s.channelTitle,v.channelTitle)`;
export const LIVE_READ_LIMITS={rows:20000,rowBytes:128*1024,totalBytes:8*1024*1024};
export const LIVE_VISIBLE_TAG_IDS=new Set([1,2,3,4,5,6,60,43,48,49,81]);
export const visibleLiveTags=(raw:unknown,names:Map<number,string>)=>tags(raw,names).filter(t=>LIVE_VISIBLE_TAG_IDS.has(t.id));
export const observedCount=(value:unknown)=>{if(typeof value!=='number'&&(typeof value!=='string'||!/^\d+$/.test(value)))return null;const n=integer(value);return n!==null&&n>=0?n:null;};
export function liveSamples(value:unknown){
 const samples=new Map<string,number>();let invalid=0,malformed=false;
 if(value===null||value===undefined||value==='')return {samples,invalid,malformed};
 let decoded:unknown;try{if(typeof value!=='string')throw Error();decoded=JSON.parse(value);if(!decoded||typeof decoded!=='object'||Array.isArray(decoded))throw Error();}catch{return {samples,invalid,malformed:true};}
 for(const[time,raw]of Object.entries(decoded as Row)){const n=observedCount(raw);if(!/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(time)||n===null){invalid++;continue;}const normalized=time.length===5?time+':00':time;samples.set(normalized,Math.max(samples.get(normalized)??0,n));}
 return {samples,invalid,malformed};
}
/** Metadata first; payload reads have independent SQL-time row and cumulative byte caps. */
export async function loadLiveLogs(reader:Reader,where:SQL,withDisplay=false){
 const joins=withDisplay?sql`LEFT JOIN urt_video v ON v.pk=(SELECT MAX(v2.pk) FROM urt_video v2 WHERE v2.videoId=l.videoId AND BINARY v2.videoId=BINARY l.videoId) LEFT JOIN urt_show_video_live s ON s.pk_live=(SELECT MAX(s2.pk_live) FROM urt_show_video_live s2 WHERE s2.videoId=l.videoId AND BINARY s2.videoId=BINARY l.videoId) LEFT JOIN urt_channel c ON c.u_id=l.u_id JOIN urt_count n ON n.u_id=l.u_id`:sql``;
 const display=withDisplay?sql`,COALESCE(s.title,v.title) AS title,${liveChannelTitleSql} AS channel_title,n.tags`:sql``;
 const metadata=await reader.rows(sql`SELECT l.pk,l.videoId,l.u_id,l.the_date,l.ctime,l.mtime,l.max_current,OCTET_LENGTH(l.log_json) AS log_bytes ${display} FROM urt_video_live_log l ${joins} WHERE ${where} ORDER BY l.the_date DESC,l.pk DESC LIMIT ${LIVE_READ_LIMITS.rows+1}`);
 if(metadata.length>LIVE_READ_LIMITS.rows)throw new ReportReadBound('Narrow live filters: source exceeds 20,000 log rows.');
 const coverage={sourceRows:metadata.length,sourceRowCap:LIVE_READ_LIMITS.rows,logRowByteCap:LIVE_READ_LIMITS.rowBytes,logTotalByteCap:LIVE_READ_LIMITS.totalBytes,skippedLogRows:0,skippedLogBytes:0,malformedLogRows:0,invalidLogSamples:0,changedLogRows:0};
 let plannedBytes=0;const accepted:unknown[]=[];
 for(const r of metadata){const bytes=observedCount(r.log_bytes)??0;if(bytes&&bytes<=LIVE_READ_LIMITS.rowBytes&&plannedBytes+bytes<=LIVE_READ_LIMITS.totalBytes){accepted.push(r.pk);plannedBytes+=bytes;}}
 const bodies=accepted.length?await reader.rows(sql`SELECT pk,OCTET_LENGTH(log_json) AS log_bytes,CASE WHEN OCTET_LENGTH(log_json)<=${LIVE_READ_LIMITS.rowBytes} AND SUM(COALESCE(OCTET_LENGTH(log_json),0)) OVER(ORDER BY the_date DESC,pk DESC ROWS UNBOUNDED PRECEDING)<=${LIVE_READ_LIMITS.totalBytes} THEN log_json ELSE NULL END AS log_json FROM urt_video_live_log WHERE pk IN (${sql.join(accepted.map(pk=>sql`${pk}`),sql`,`)}) ORDER BY the_date DESC,pk DESC`):[];
 const byPk=new Map(bodies.map(r=>[String(r.pk),r]));
 const rows=metadata.map(r=>{const body=byPk.get(String(r.pk)),before=observedCount(r.log_bytes)??0,bytes=observedCount(body?.log_bytes)??before;if(body&&bytes!==before)coverage.changedLogRows++;if(bytes>0&&(!body||body.log_json===null)){coverage.skippedLogRows++;coverage.skippedLogBytes+=bytes;}
  const parsed=liveSamples(body?.log_json);coverage.invalidLogSamples+=parsed.invalid;if(parsed.malformed)coverage.malformedLogRows++;
  return {...r,samples:parsed.samples,partial:(bytes>0&&(!body||body.log_json===null))||parsed.malformed||parsed.invalid>0||(body!==undefined&&bytes!==before)} as Row & {samples:Map<string,number>;partial:boolean};
 });
 return {rows,coverage:{...coverage,partialLogEvidence:coverage.skippedLogRows>0||coverage.malformedLogRows>0||coverage.invalidLogSamples>0||coverage.changedLogRows>0}};
}
export const liveCoverageNote='日誌資料量過大時會略過部分取樣，只保留來源已記錄的峰值；缺少觀測不補零。可縮小日期或分類以查看較完整的取樣。';
