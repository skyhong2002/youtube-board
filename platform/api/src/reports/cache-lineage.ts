import { reportCacheKey } from '../../../shared/report-cache-key.js';
import { sql } from 'drizzle-orm';
import type { Reader, Row } from '../db/client.js';
import { idList, type Query } from './query.js';
import {ReportReadBound} from './cache-weights.js';
import { integer, text, object, timestamp, taipeiSql } from './normalize.js';
export const cacheLineageNote = '新版快取若仍在發布中，該分類日桶會暫時排除；缺少快取不等於零。日期尚未結束時僅代表截至生成時間的觀測，並非完整日總量。舊快取尚未記錄版本來源。';
/** Sidecar protects readers while a reviewed worker replaces MyISAM cache rows. */
export async function publishedTagCache(reader: Reader, records: Row[], query: Query, live = false): Promise<Row[]> {
    const sidecar = live ? 'ts_live_tag_cache_lineage' : 'ts_tag_cache_lineage';
    if (!records.length)
        return records;
    const exists = (await reader.rows(sql `SELECT COUNT(*) AS present FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=${sidecar}`))[0];
    if (!integer(exists?.present))
        return records;
    const key = JSON.stringify([[...new Set(idList(query.tagid))].sort((a, b) => a - b), [...new Set(idList(query.or))].sort((a, b) => a - b), [...new Set(idList(query.not))].sort((a, b) => a - b)]);
    const dates=records.map(r=>text(r.the_date).slice(0,10)).sort();
    const rows = await reader.rows(sql `SELECT * FROM ${sql.identifier(sidecar)} WHERE selection_key=${key} AND the_date BETWEEN ${dates[0]} AND ${dates.at(-1)} LIMIT 10001`);if(rows.length>10000)throw new ReportReadBound('Cache lineage exceeds read budget');const byDate = new Map(rows.map(r => [text(r.the_date).slice(0, 10), r]));
    return records.flatMap(r => {const lineage=byDate.get(text(r.the_date).slice(0,10));if(!lineage)return[r];if(lineage.status!=='published')return[];return[{...r,_cacheLineage:lineageIdentity(lineage),_unknownViewVideos:unknownCount(lineage),_cacheWindow:{from:lineage.window_from??r.the_date,to:lineage.window_to??r.the_date,closed:integer(lineage.window_closed)===1,observedUntil:lineage.generated_at}}];});
}

export const publishedLiveTagCache = (reader: Reader, records: Row[], query: Query) => publishedTagCache(reader, records, query, true);

export function reportSelectionKeys(query:Query) {const part=(value:unknown)=>idList(value as string|undefined).sort((a,b)=>a-b).join(',')||null;return {tagid:part(query.tagid),tag_or:part(query.or),tag_not:part(query.not)};}
export interface CacheLineage {version:string;coverage:string;rule:string}
/** Laravel cache builders add `viewCount ?? 0`, so a published row with unknown-view videos is still the page's
 * data (the TS writers sum the same way); the sidecar count is surfaced instead of hiding the row. */
function unknownCount(r:Row):number{const n=integer(r.unknown_view_videos);return n!==null&&n>0?n:0;}
/** Unknown-view videos recorded by the TS sidecar for the displayed rows; legacy rows without a sidecar add nothing. */
export function unknownViewVideos(rows:readonly (Row|undefined)[]):number{return rows.reduce((n,r)=>n+(typeof r?._unknownViewVideos==='number'?r._unknownViewVideos:0),0);}
/** Legacy wire additive field: present only when a TS sidecar recorded the count, so imported rows keep Laravel's shape. */
export function unknownViewMeta(rows:readonly (Row|undefined)[]):{unknown_view_videos?:number}{return rows.some(r=>typeof r?._unknownViewVideos==='number')?{unknown_view_videos:unknownViewVideos(rows)}:{};}
export function unknownViewNotes(count:number,scope='所採用的快取'):string[]{return count>0?[`${scope}生成時有 ${count} 部影片尚無觀看數，與舊版相同以 0 計入觀看數值，因此觀看相關數值可能偏低。`]:[];}
function lineageIdentity(r:Row):CacheLineage{return {version:text(r.vocabulary_version),coverage:text(r.coverage),rule:text(r.rule_version)};}
export interface CacheRead {status:'missing'|'legacy'|'published'|'pending';row?:Row;lineage?:CacheLineage}
export async function inspectReportRows(reader:Reader,table:string,inputs:{keys:Record<string,unknown>;row:Row|undefined}[]):Promise<CacheRead[]>{
 if(inputs.length>400)throw new ReportReadBound('Cache selection exceeds read budget');if(!inputs.length)return [];
 const exists=(await reader.rows(sql`SELECT COUNT(*) AS present FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='ts_report_cache_lineage'`))[0];
 if(!integer(exists?.present))return inputs.map(({row})=>({status:row?'legacy':'missing',row}));
 const keys=inputs.map(i=>reportCacheKey(i.keys)),rows=await reader.rows(sql`SELECT cache_key,vocabulary_version,coverage,rule_version,status,unknown_view_videos,window_from,window_to,window_closed,generated_at FROM ts_report_cache_lineage WHERE cache_table=${table} AND cache_key IN (${sql.join(keys.map(k=>sql`${k}`),sql`,`)})`),byKey=new Map(rows.map(r=>[text(r.cache_key),r]));
 return inputs.map(({row},i)=>{const r=byKey.get(keys[i]!);if(!r)return {status:row?'legacy':'missing',row};const lineage=lineageIdentity(r);if(r.status!=='published')return {status:'pending',lineage};if(!row)return {status:'missing',lineage};return {status:'published',lineage,row:{...row,_cacheLineage:lineage,_unknownViewVideos:unknownCount(r),_cacheWindow:{from:r.window_from,to:r.window_to,closed:integer(r.window_closed)===1,observedUntil:r.generated_at}}};});
}
/** Imported legacy caches have no sidecar; once TS owns a row, a pending publication is hidden. */
export async function publishedReportRow(reader:Reader,table:string,keys:Record<string,unknown>,row:Row|undefined):Promise<Row|undefined>{
 if(!row)return undefined;return (await inspectReportRows(reader,table,[{keys,row}]))[0]?.row;
}

/** Keep internal publication identity exact; normalize only the public window DTO. */
export function publicCacheWindow(value:unknown){
 if(value===null||value===undefined)return null;
 const window=object(value);return {from:window.from,to:window.to,closed:window.closed,observedUntil:timestamp(window.observedUntil)};
}
export function cacheObservationTime(value:unknown){const instant=timestamp(value);return instant?taipeiSql(new Date(instant)):null;}
export function cacheWindowNotes(rows:Row[]):string[] {
 const open=new Map<string,string>();for(const row of rows){const w=row._cacheWindow as {from?:unknown;to?:unknown;closed?:boolean;observedUntil?:unknown}|undefined;if(w&&w.closed===false)open.set(String(w.from)+'～'+String(w.to),cacheObservationTime(w.observedUntil)??'未知');}
 return [...open].slice(0,10).map(([period,until])=>`${period} 為部分期間觀測，資料截至台北時間 ${until}。`);
}
