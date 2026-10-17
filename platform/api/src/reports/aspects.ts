import {sql} from 'drizzle-orm';
import type {Reader,Row} from '../db/client.js';
import {BadQuery,idList,page,tagFilter,type Query} from './query.js';
import {text,latest,integer,tagIds} from './normalize.js';
import {table,link,type Register} from './table.js';
import {publishedChannelAi} from './channel-ai.js';
import {aspectNames,aspectValues} from './aspect-shapes.js';
import type {AspectReportData,AspectTag} from '../report-contracts.js';
const maxSources=2000,maxBytes=16*1024*1024;
/** LegacyTagFilter::visibleTags: the only channel tags Laravel's AiAspectReport printed under a channel. */
export const aspectVisibleTagIds=[1,2,3,4,5,6,60,43,48,49,81] as const;
const partialNote='部分分數缺值，以 0 計入';
/** AiAspectReport row tags and title/filter names: visible tags of the listed channels in their
 * urt_count.tags order (tagsFromString: unique, unknown names fall back to the id), and the names
 * of the effective tagid/or/not ids. Two bounded reads, only for the returned page. */
async function aspectTags(reader:Reader,uIds:number[],filterIds:number[]){
 const visible=new Set<number>(aspectVisibleTagIds),nameIds=[...new Set([...aspectVisibleTagIds,...filterIds])];
 if(!uIds.length&&!filterIds.length)return {channelTags:{},filterTags:[]};
 const [counts,names]=await Promise.all([
  uIds.length?reader.rows(sql`SELECT u_id,tags FROM urt_count WHERE u_id IN(${sql.join(uIds.map(id=>sql`${id}`),sql`,`)}) ORDER BY u_id LIMIT ${uIds.length}`):Promise.resolve([]),
  reader.rows(sql`SELECT tag_id,LEFT(tag_name,256) AS tag_name FROM urt_tag WHERE tag_id IN(${sql.join(nameIds.map(id=>sql`${id}`),sql`,`)}) ORDER BY tag_id LIMIT ${nameIds.length}`),
 ]);
 const byId=new Map(names.filter(r=>r.tag_name!==null&&r.tag_name!==undefined).map(r=>[integer(r.tag_id)??0,text(r.tag_name)])),tag=(id:number):AspectTag=>({id,name:byId.get(id)??String(id)});
 const channelTags:Record<string,AspectTag[]>=Object.fromEntries(uIds.map(id=>[String(id),[]]));
 for(const r of counts){const id=String(integer(r.u_id));if(id in channelTags)channelTags[id]=tagIds(r.tags).filter(t=>visible.has(t)).map(tag);}
 return {channelTags,filterTags:filterIds.map(tag)};
}
export async function aspectReport(reader:Reader,query:Query):Promise<AspectReportData&{evidenceCoverage:Record<string,number>}>{
 const q:Query={limit:'100',...query},condition=text(q.condition);page(q);
 if(condition&&!['blue','green','neutral','finance','world','all'].includes(condition))throw new BadQuery('Unsupported aspect condition.');
 if(condition==='blue')q.tagid='3';if(condition==='green')q.tagid='4';if(condition==='neutral')q.not='3,4,5,6,31,41';if(condition==='finance')q.tagid='31';if(condition==='world')q.tagid='41';
 // Inspect sizes before loading JSON; guard the subsequent read against growing rows.
 const metadata=await reader.rows(sql`SELECT ai.pk,OCTET_LENGTH(ai.result_json) AS bytes FROM urt_channel_ai ai JOIN urt_channel c ON c.u_id=ai.u_id WHERE ai.pk IN(SELECT MAX(pk) FROM urt_channel_ai WHERE data_type='aspect' AND del_flag IS NULL AND LENGTH(result_json)>10 GROUP BY u_id) AND (c.flag_del IS NULL OR c.flag_del<1) AND EXISTS(SELECT 1 FROM urt_count n WHERE n.u_id=ai.u_id AND ${tagFilter(q)}) ORDER BY c.u_id LIMIT ${maxSources+1}`);
 if(metadata.length>maxSources||metadata.reduce((n,r)=>n+Number(r.bytes),0)>maxBytes)throw Object.assign(new Error('Aspect report exceeds the 2000-source / 16 MiB read bound. Narrow the channel categories.'),{statusCode:422});
 const records:Row[]=[];let withheld=0,diverged=0,malformed=0,changed=0;
 for(let offset=0;offset<metadata.length;offset+=200){
  const batch=metadata.slice(offset,offset+200),raw=await reader.rows(sql`SELECT ai.pk,ai.u_id,ai.date_from,ai.date_to,ai.data_type,ai.user_token,ai.ctime,ai.mtime,ai.result_json,c.title FROM urt_channel_ai ai JOIN urt_channel c ON c.u_id=ai.u_id WHERE ai.del_flag IS NULL AND ai.data_type='aspect' AND NOT EXISTS(SELECT 1 FROM urt_channel_ai newer WHERE newer.u_id=ai.u_id AND newer.pk>ai.pk AND newer.data_type='aspect' AND newer.del_flag IS NULL AND LENGTH(newer.result_json)>10) AND (c.flag_del IS NULL OR c.flag_del<1) AND (${sql.join(batch.map(r=>sql`(ai.pk=${r.pk} AND OCTET_LENGTH(ai.result_json)=${r.bytes})`),sql` OR `)}) ORDER BY ai.u_id`);
  changed+=batch.length-raw.length;const visible=await publishedChannelAi(reader,raw);records.push(...visible.rows);withheld+=visible.withheld;diverged+=visible.diverged;malformed+=visible.malformed;
 }
 const parsed=records.map(r=>({source:r,...aspectValues(r.result_json)})).sort((a,b)=>(a.sortBalance===b.sortBalance?Number(a.source.u_id)-Number(b.source.u_id):a.sortBalance>b.sortBalance?-1:1));
 const {limit,offset}=page(q),filterIds=[...new Set([...idList(q.tagid),...idList(q.or),...idList(q.not)])];
 const {channelTags,filterTags}=await aspectTags(reader,[...new Set(parsed.slice(offset,offset+limit).map(r=>Number(r.source.u_id)))],filterIds);
 // AiAspectReport computed 傾向 server-side with missing scores as 0; it stays empty only when no score exists.
 const balance=(r:typeof parsed[number])=>{const known=aspectNames.filter(n=>r.values[n].value!==null).length,n=Number(r.sortBalance);return {value:known>0&&Number.isSafeInteger(n)?n:null,detail:known>0&&known<aspectNames.length?partialNote:''};};
 return {...table('AI 分析立場描述',[{key:'channel',label:'頻道'},...aspectNames.map(key=>({key,label:key,kind:'number' as const})),{key:'balance',label:'傾向',kind:'number'},{key:'source',label:'分析來源'}],parsed.map(r=>({channel:link(text(r.source.title),`/channels/${r.source.u_id}`),...r.values,balance:balance(r),source:link(`#${r.source.pk}`,`/channels/${r.source.u_id}/ai?pk=${r.source.pk}`)})),q,{updatedAt:latest(...records.flatMap(r=>[r.mtime,r.ctime])),notes:['這是模型對觀測內容的分析分數，不是記者共編標籤，也不是經驗證的政治身分或客觀立場。未有分析項目保留空值。','「傾向」依原報表公式（泛綠＋泛白－泛藍－泛紅＋台灣－中國）計算並由高到低排序；缺值按 0 計入，六項皆缺時留空。分數截去小數，保留來源描述與精確分析連結。','每頻道選最新未刪除且長度大於 10 位元組的分析；未發布或與發布紀錄不符的結果暫不呈現，不退回舊版。']}),channelTags,filterTags,evidenceCoverage:{sourceRows:records.length,selectedSources:metadata.length,withheldSources:withheld,divergedSources:diverged,malformedSources:malformed,changedSources:changed,sourceBytes:metadata.reduce((n,r)=>n+Number(r.bytes),0)}};
}
export function registerAspects(register:Register,reader:Reader){register('/ai/aspects',async(_p,q)=>aspectReport(reader,q));}
