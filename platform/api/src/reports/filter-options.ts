import {readChannelAvatars} from '../../../shared/media-cache/index.js';
import {sql} from 'drizzle-orm';
import {filterOptionsQuery,type FilterOptions} from '../../../shared/filter-options.js';
import {DataQueryFailed,type Reader} from '../db/client.js';
import {BadQuery} from './query.js';
import type {Register} from './table.js';
export function registerFilterOptions(register:Register,reader:Reader){
 register('/filter-options/:kind',async(p,q):Promise<FilterOptions>=>{
  const input=filterOptionsQuery(p.kind,q);if(!input)throw new BadQuery('Invalid filter option request.');
  const channel=input.kind==='channels',id=sql.identifier(channel?'u_id':'tag_id'),label=sql.identifier(channel?'title':'tag_name'),table=sql.identifier(channel?'urt_channel':'urt_tag');
  const active=channel?sql`(flag_del IS NULL OR flag_del<1)`:sql`(del_flag IS NULL OR del_flag<1)`,like='%'+input.q.replace(/[=%_]/g,v=>'='+v)+'%';
  const where=input.ids.length?sql`${id} IN (${sql.join(input.ids.map(value=>sql`${Number(value)}`),sql`,`)})`:sql`TRIM(COALESCE(${label},''))<>'' ${input.q?sql`AND ${label} LIKE ${like} ESCAPE '='`:sql``}`;
  const rows=await reader.rows(sql`SELECT ${id} AS id,LEFT(${label},256) AS label${channel?sql`,youtube_id`:sql``} FROM ${table} WHERE ${active} AND ${where} ORDER BY ${label},${id} LIMIT ${input.ids.length||input.limit+1}`);
  if(rows.length>(input.ids.length||input.limit+1))throw new DataQueryFailed('FILTER_OPTIONS_ROW_BOUND');
  const normalized=rows.map(row=>{const value=typeof row.id==='number'?String(row.id):row.id;if(typeof value!=='string'||!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value))||Number(value)<1||row.label!==null&&typeof row.label!=='string')throw new DataQueryFailed('FILTER_OPTIONS_SCALAR');const label=typeof row.label==='string'?row.label.trim():'';if(new TextEncoder().encode(label).length>1024)throw new DataQueryFailed('FILTER_OPTIONS_BYTE_BOUND');return {id:String(Number(value)),label};});
  if(new Set(normalized.map(row=>row.id)).size!==normalized.length)throw new DataQueryFailed('FILTER_OPTIONS_DUPLICATE_ID');
  const available=normalized.filter(row=>row.label),rowsOut=input.ids.length?available:available.slice(0,input.limit);
  const avatars=channel?await readChannelAvatars(rowsOut.map(row=>({id:Number(row.id),channelId:String(rows.find(r=>String(r.id)===row.id)?.youtube_id??'')}))).catch(()=>new Map()):new Map();
  return {kind:input.kind,rows:channel?rowsOut.map(row=>({...row,avatar:avatars.get(Number(row.id))??null})):rowsOut,hasMore:!input.ids.length&&normalized.length>input.limit,missingIds:input.ids.filter(id=>!available.some(row=>row.id===id))};
 });
}
