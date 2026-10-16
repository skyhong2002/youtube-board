import {createHash} from 'node:crypto';
import {sql} from 'drizzle-orm';
import type {Reader} from '../db/client.js';
import {bounded,dateFilter,NotFound,videoId} from './query.js';
import {latest,text,timestamp} from './normalize.js';
import {table,type Register} from './table.js';
import {LIVE_READ_LIMITS,liveSamples,observedCount} from './live-observations.js';

/** Raw historical evidence; never substitute stored max_current for a missing sample. */
export function registerLiveVideoTrend(register:Register,reader:Reader){
 register('/live/videos/:id/trend',async(p,q)=>{
  const id=videoId(p.id),count=bounded(q.limit,50,1,200),cap=367;
  const [source,display]=await Promise.all([
   reader.rows(sql`SELECT pk,the_date,ctime,mtime,OCTET_LENGTH(log_json) AS log_bytes,SHA2(COALESCE(log_json,''),256) AS log_hash FROM urt_video_live_log WHERE videoId=${id} AND BINARY videoId=BINARY ${id} ORDER BY the_date DESC,pk DESC LIMIT ${cap+1}`),
   reader.rows(sql`SELECT LEFT(title,512) AS title FROM urt_show_video_live WHERE videoId=${id} AND BINARY videoId=BINARY ${id} ORDER BY pk_live DESC LIMIT 1`),
  ]);
  if(!source.length&&!display.length)throw new NotFound();
  const metadata=source.slice(0,cap),coverage={sourceRows:metadata.length,sourceRowCap:cap,olderRowsOmitted:source.length>cap,rowByteCap:LIVE_READ_LIMITS.rowBytes,totalByteCap:LIVE_READ_LIMITS.totalBytes,skippedRows:0,changedRows:0,malformedRows:0,invalidSamples:0,invalidDates:0,missingLogRows:0,emptyLogRows:0,validSamples:0};
  let planned=0;const accepted=metadata.filter(row=>{const size=observedCount(row.log_bytes)??0;if(!size){coverage.missingLogRows++;return false;}if(size>LIVE_READ_LIMITS.rowBytes||planned+size>LIVE_READ_LIMITS.totalBytes){coverage.skippedRows++;return false;}planned+=size;return true;});
  const bodies=accepted.length?await reader.rows(sql`SELECT pk,the_date,ctime,mtime,OCTET_LENGTH(log_json) AS log_bytes,CASE WHEN OCTET_LENGTH(log_json)<=${LIVE_READ_LIMITS.rowBytes} AND SUM(COALESCE(OCTET_LENGTH(log_json),0)) OVER(ORDER BY the_date DESC,pk DESC ROWS UNBOUNDED PRECEDING)<=${LIVE_READ_LIMITS.totalBytes} THEN log_json ELSE NULL END AS log_json FROM urt_video_live_log WHERE videoId=${id} AND BINARY videoId=BINARY ${id} AND pk IN (${sql.join(accepted.map(r=>sql`${r.pk}`),sql`,`)}) ORDER BY the_date DESC,pk DESC LIMIT ${cap}`):[];
  const byPk=new Map(bodies.map(r=>[String(r.pk),r])),hourly=new Map<string,number>(),daily=new Map<string,number>();
  for(const row of accepted){
   const body=byPk.get(String(row.pk)),raw=body?.log_json;
   if(!body||typeof raw!=='string'||Buffer.byteLength(raw)>LIVE_READ_LIMITS.rowBytes||Buffer.byteLength(raw)!==Number(row.log_bytes)||createHash('sha256').update(raw).digest('hex')!==row.log_hash||['the_date','mtime','ctime'].some(key=>text(body[key])!==text(row[key]))){coverage.changedRows++;continue;}
   let date:string|null;try{date=dateFilter(text(row.the_date).slice(0,10));}catch{date=null;}if(!date){coverage.invalidDates++;continue;}
   const parsed=liveSamples(raw);coverage.invalidSamples+=parsed.invalid;coverage.validSamples+=parsed.samples.size;if(parsed.malformed)coverage.malformedRows++;else if(!parsed.samples.size&&!parsed.invalid)coverage.emptyLogRows++;
   for(const [time,value]of parsed.samples){const hour=timestamp(`${date} ${time.slice(0,2)}:00:00`)!;hourly.set(hour,Math.max(hourly.get(hour)??0,value));daily.set(date,Math.max(daily.get(date)??0,value));}
  }
  const points=(values:Map<string,number>)=>[...values].sort(([a],[b])=>a.localeCompare(b)).slice(-Math.min(count+1,200)).map(([time,value])=>({time,value}));
  const hp=points(hourly),dp=points(daily),partial=coverage.olderRowsOmitted||coverage.skippedRows+coverage.changedRows+coverage.malformedRows+coverage.invalidSamples+coverage.invalidDates+coverage.missingLogRows>0;
  return {...table(text(display[0]?.title)||id,[{key:'time',label:'觀測時間',kind:'datetime'},{key:'value',label:'每小時峰值',kind:'number'}],hp,{...q,limit:String(Math.min(count+1,200))},{updatedAt:latest(...metadata.flatMap(r=>[r.mtime,r.ctime])),series:[{name:'每小時峰值',unit:'人',points:hp},{name:'每日峰值',unit:'人',points:dp}],notes:['使用來源日誌內的實測取樣；重複日期／影片的小時取樣取最大值。沒有觀測不補零，也不以 max_current 代填。','至多讀取最近 367 筆日誌，每筆 128 KiB、合計 8 MiB；最多呈現 200 個圖表點。',...(partial?['部分日誌缺少取樣、超出上限、讀取時變更或格式無效，曲線只顯示可核對的觀測；缺少區段不代表零人。']:[])]}),evidenceCoverage:{...coverage,partialLogEvidence:partial}};
 });
}
