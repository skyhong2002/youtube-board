import {createHash} from 'node:crypto';
import {sql,type SQL} from 'drizzle-orm';
import {DataQueryFailed,type Reader,type Row} from '../db/client.js';
import type {ReportData} from '../report-contracts.js';
import {BadQuery,mergeTagId,page,positiveId,search,tagFilter,type Query} from './query.js';
import {integer,latest,text,timestamp} from './normalize.js';
import {livePeriod,livePeriodControls} from './live-period.js';
import {LIVE_READ_LIMITS,LIVE_VISIBLE_TAG_IDS,liveSamples,observedCount,visibleLiveTags,liveChannelTitleSql} from './live-observations.js';
import {link,type Register} from './table.js';
/** Exact byte identity remains explicit even when an imported database uses CI columns. */
export const liveDisplayJoins=sql`LEFT JOIN urt_show_video_live s ON s.pk_live=(SELECT MAX(s2.pk_live) FROM urt_show_video_live s2 WHERE s2.videoId=l.videoId AND BINARY s2.videoId=BINARY l.videoId) LEFT JOIN urt_video v ON v.pk=(SELECT MAX(v2.pk) FROM urt_video v2 WHERE v2.videoId=l.videoId AND BINARY v2.videoId=BINARY l.videoId) LEFT JOIN urt_channel c ON c.u_id=l.u_id JOIN urt_count n ON n.u_id=l.u_id`;
export const liveDisplayColumns=sql`LEFT(COALESCE(NULLIF(s.title,''),v.title),512) AS title,LEFT(${liveChannelTitleSql},256) AS channel_title,COALESCE(s.publishedAt,v.publishedAt) AS published_at,CASE WHEN OCTET_LENGTH(n.tags)<=4096 THEN n.tags ELSE NULL END AS tags,OCTET_LENGTH(n.tags) AS tags_bytes`;
export async function liveTaxonomyNames(reader:Reader){const ids=[...LIVE_VISIBLE_TAG_IDS],rows=await reader.rows(sql`SELECT tag_id,LEFT(tag_name,256) AS tag_name FROM urt_tag WHERE tag_id IN (${sql.join(ids.map(id=>sql`${id}`),sql`,`)}) ORDER BY tag_id LIMIT ${ids.length}`);if(rows.length>ids.length)throw new DataQueryFailed('LIVE_TAG_NAME_BOUND');return new Map(rows.map(row=>[integer(row.tag_id)??0,text(row.tag_name)]));}
export function liveSearch(term:string|null):SQL{return term?sql`AND(COALESCE(s.title,v.title,'') COLLATE utf8mb4_unicode_ci LIKE ${term} ESCAPE '=' OR COALESCE(${liveChannelTitleSql},'') COLLATE utf8mb4_unicode_ci LIKE ${term} ESCAPE '=')`:sql``;}
export function liveTotal(rows:Row[]):number{const total=observedCount(rows[0]?.total);if(total===null)throw new DataQueryFailed('LIVE_TOTAL_INVALID');return total;}
export function liveRowIdentity(row:Row){const pk=observedCount(row.pk),channel=observedCount(row.u_id),id=text(row.videoId);if(!pk||!channel||!/^[-_A-Za-z0-9]{1,32}$/.test(id))throw new DataQueryFailed('LIVE_ROW_IDENTITY');return {pk,channel,id};}
function sourceSignature(row:Row){return JSON.stringify(['pk','videoId','u_id','the_date','ctime','mtime','max_current'].map(key=>row[key]===null?null:String(row[key])));}
/** Only the selected page's bodies are fetched; hashes reject same-byte-size source changes. */
export async function taxonomyPageSamples(reader:Reader,metadata:Row[]){
 const coverage={selectedLogRows:metadata.length,sampleRowByteCap:LIVE_READ_LIMITS.rowBytes,sampleTotalByteCap:LIVE_READ_LIMITS.totalBytes,skippedSampleRows:0,changedSampleRows:0,malformedSampleRows:0,invalidSamples:0,emptySampleRows:0};
 let planned=0;const accepted:Row[]=[],samples=new Map<number,{values:number[];status:string}>();
 for(const row of metadata){const pk=liveRowIdentity(row).pk,bytes=row.sample_bytes===null?0:observedCount(row.sample_bytes);if(bytes===null)throw new DataQueryFailed('LIVE_SAMPLE_BYTES_INVALID');if(!bytes){coverage.emptySampleRows++;samples.set(pk,{values:[],status:'無取樣'});continue;}if(bytes>LIVE_READ_LIMITS.rowBytes||planned+bytes>LIVE_READ_LIMITS.totalBytes){coverage.skippedSampleRows++;samples.set(pk,{values:[],status:'取樣超過讀取上限'});continue;}planned+=bytes;accepted.push(row);}
 const bodies=accepted.length?await reader.rows(sql`SELECT pk,videoId,u_id,the_date,ctime,mtime,max_current,OCTET_LENGTH(log_json) AS sample_bytes,CASE WHEN OCTET_LENGTH(log_json)<=${LIVE_READ_LIMITS.rowBytes} AND SUM(COALESCE(OCTET_LENGTH(log_json),0)) OVER(ORDER BY pk ROWS UNBOUNDED PRECEDING)<=${LIVE_READ_LIMITS.totalBytes} THEN log_json ELSE NULL END AS log_json FROM urt_video_live_log WHERE pk IN (${sql.join(accepted.map(r=>sql`${r.pk}`),sql`,`)}) ORDER BY pk LIMIT ${accepted.length}`):[];
 if(bodies.length>accepted.length||new Set(bodies.map(r=>String(r.pk))).size!==bodies.length)throw new DataQueryFailed('LIVE_SAMPLE_ROW_BOUND');
 const byPk=new Map(bodies.map(r=>[String(r.pk),r]));
 for(const row of accepted){const pk=liveRowIdentity(row).pk,body=byPk.get(String(row.pk)),raw=body?.log_json;
  if(!body||sourceSignature(row)!==sourceSignature(body)||typeof raw!=='string'||Buffer.byteLength(raw)>LIVE_READ_LIMITS.rowBytes||Buffer.byteLength(raw)!==Number(row.sample_bytes)||createHash('sha256').update(raw).digest('hex')!==row.sample_hash){coverage.changedSampleRows++;samples.set(pk,{values:[],status:'取樣讀取時變更，請重試'});continue;}
  const parsed=liveSamples(raw);coverage.invalidSamples+=parsed.invalid;if(parsed.malformed)coverage.malformedSampleRows++;const values=[...parsed.samples].sort(([a],[b])=>a.localeCompare(b)).slice(-24).map(([,value])=>value);if(!values.length&&!parsed.malformed&&!parsed.invalid)coverage.emptySampleRows++;
  samples.set(pk,{values,status:parsed.malformed?'取樣格式無法解析':parsed.invalid?'部分取樣無效':values.length?'有效取樣':'無取樣'});
 }
 return {samples,coverage:{...coverage,partialSampleEvidence:coverage.skippedSampleRows+coverage.changedSampleRows+coverage.malformedSampleRows+coverage.invalidSamples>0}};
}
export function registerLiveTaxonomyVideos(register:Register,reader:Reader,clock:()=>Date){
 const report=async(q:Query,path:string)=>{
  const clean={...q};for(const key of ['date','from','to','days'])if(clean[key]==='')delete clean[key];
  if(clean.today!==undefined&&clean.today!=='')throw new BadQuery('Use date or from/to for taxonomy live periods.');
  // Laravel's taxonomy report selects a single date unless from starts a range.
  // Keep days as an explicit bounded convenience from the rewrite, never a default week.
  const period=livePeriod(clean,clock),{limit,offset}=page(clean),term=search(clean.q),scope=tagFilter(clean);
  const where=sql`l.the_date BETWEEN ${period.from} AND ${period.to} AND l.max_current>0 AND ${scope} ${liveSearch(term)}`;
  const joins=term?liveDisplayJoins:sql`JOIN urt_count n ON n.u_id=l.u_id`;
  const [metadata,count]=await Promise.all([reader.rows(sql`SELECT l.pk,l.videoId,l.u_id,l.the_date,l.ctime,l.mtime,l.max_current,OCTET_LENGTH(l.log_json) AS sample_bytes,SHA2(COALESCE(l.log_json,''),256) AS sample_hash,${liveDisplayColumns} FROM urt_video_live_log l ${liveDisplayJoins} WHERE ${where} ORDER BY l.max_current DESC,l.the_date DESC,l.pk DESC LIMIT ${limit} OFFSET ${offset}`),reader.rows(sql`SELECT COUNT(*) AS total FROM urt_video_live_log l ${joins} WHERE ${where}`)]);
  if(metadata.length>limit||new Set(metadata.map(row=>String(row.pk))).size!==metadata.length)throw new DataQueryFailed('LIVE_TAXONOMY_PAGE_BOUND');
  for(const row of metadata){liveRowIdentity(row);if((observedCount(row.max_current)??0)<=0||!period.dates.includes(text(row.the_date).slice(0,10)))throw new DataQueryFailed('LIVE_TAXONOMY_ROW_SCOPE');}
  const [names,sampling]=await Promise.all([metadata.length?liveTaxonomyNames(reader):Promise.resolve(new Map<number,string>()),taxonomyPageSamples(reader,metadata)]);
  const controls=livePeriodControls(clean,period,path);controls.filters=[...controls.filters!,{key:'days',label:'回看日數（未填單日／起訖，1–90）',type:'number',value:text(clean.days)}];if(clean.days&&!clean.date&&!clean.from)controls.filters=controls.filters.map(filter=>filter.key==='date'?{...filter,value:''}:filter);
  const rows=metadata.map(row=>{const {pk,channel,id}=liveRowIdentity(row),sample=sampling.samples.get(pk)!;return {sourceLogId:pk,date:text(row.the_date).slice(0,10),video:link(text(row.title)||id,`/live/videos/${encodeURIComponent(id)}/trend`),channel:link(text(row.channel_title)||'頻道名稱待補',`/channels/${channel}`),publishedAt:timestamp(row.published_at),peak:observedCount(row.max_current),tags:visibleLiveTags(row.tags,names).map(t=>t.name).join(' · '),samples:{value:sample.values.slice(-8).join(' → ')||null,detail:`${sample.status}；最近最多 24 個有效取樣中顯示最後 8 個`},sampleCount:sample.values.length,sampleStatus:sample.status};});
  return {title:'分類直播來源排行',columns:[{key:'sourceLogId',label:'日誌編號',kind:'number'},{key:'date',label:'觀測日期',kind:'date'},{key:'video',label:'影片'},{key:'channel',label:'頻道'},{key:'tags',label:'頻道分類'},{key:'publishedAt',label:'發布時間',kind:'datetime'},{key:'peak',label:'來源記錄峰值',kind:'number'},{key:'samples',label:'最近取樣（人）'},{key:'sampleStatus',label:'取樣狀態'}],rows,total:liveTotal(count),limit,offset,updatedAt:latest(...metadata.flatMap(r=>[r.mtime,r.ctime])),...controls,notes:['每列為一筆正值來源日誌，同一影片不同日期或重複日誌均保留；峰值使用該列 max_current，不跨日合併，也不以取樣改寫。','標題與發布時間優先使用保留的直播展示資料；缺少發布時間保留空值。頻道分類與維護內容詞彙分開。','預設為台北今日單日；起訖最多 90 日，每頁預設 50／最多 200 列。只讀取目前頁面取樣，超額、變更或無效資料明確標示。'],evidenceCoverage:{...sampling.coverage,from:period.from,to:period.to,observationUnit:'positive-source-log-row',totalSnapshot:'independent-read',displayMetadata:'latest-exact-video-id',oversizedTaxonomyRows:metadata.filter(r=>(observedCount(r.tags_bytes)??0)>4096).length}} satisfies ReportData&{evidenceCoverage:unknown};
 };
 register('/tags/live/videos',(_p,q)=>report(q,'/tags/live/videos'));
 register('/tags/:id/live/videos',(p,q)=>report({...q,tagid:mergeTagId(q.tagid,positiveId(p.id))},`/tags/${positiveId(p.id)}/live/videos`));
}
