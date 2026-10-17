import {readChannelIdentity,type ChannelIdentity} from './channel-identity.js';
import {sql} from 'drizzle-orm';
import type {Connection} from 'mysql2/promise';
import type {Reader} from '../db/client.js';
import {planAi,conditionSql} from '../../../ai/src/planner.js';
import {normalizeInput,PROMPT_VERSION,type Input,type Condition,type ChannelSource,type Plan} from '../../../ai/src/contracts.js';
import {BadQuery,bounded,dateFilter,positiveId,type Query} from './query.js';
import {text,taipeiDate,timestamp} from './normalize.js';
import type {Register} from './table.js';
/** Adapter is private to the reviewed planner's static SELECTs, never accepts HTTP SQL. */
function planningReader(reader:Reader,observe?:(statement:string,rows:Record<string,unknown>[])=>void):Pick<Connection,'query'>{
 return {query:async(statement:string,params:unknown[]=[])=>{
  if(!/^SELECT\s/i.test(statement))throw new Error('AI preview attempted a non-read query');
  const pieces=statement.split('?');if(pieces.length!==params.length+1)throw new Error('Planner parameter mismatch');
  const query=sql.join(pieces.flatMap((piece,i)=>i===params.length?[sql.raw(piece)]:[sql.raw(piece),sql`${params[i]}`]),sql``);
  const rows=await reader.rows(query);observe?.(statement,rows);return [rows,[]];
 }} as unknown as Pick<Connection,'query'>;
}
const scalars=(value:unknown):string[]=>(Array.isArray(value)?value.flat(Infinity):[value]).filter(v=>['string','number','boolean'].includes(typeof v)).map(v=>String(v).trim()).filter(Boolean);
/** Laravel AiDailyPromptReport rows()/events(): each media's prompt events with their cited video counts,
 * media ordered by the sum of those counts (stable sortByDesc, so ties keep the planner's newest-first order). */
export function promptMedia(source:ChannelSource[]){
 return source.map(s=>{
  const events=s.events.map(e=>({event:e.事件.trim(),description:typeof e.描述==='string'?e.描述.trim():'',videoCount:e.videoId.length,keywords:scalars(e.關鍵字)}));
  return {channelId:s.u_id,title:s.title,sourcePk:s.pk,videoCount:events.reduce((n,e)=>n+e.videoCount,0),events};
 }).map((m,i)=>[m,i] as const).sort((a,b)=>b[0].videoCount-a[0].videoCount||a[1]-b[1]).map(([m])=>m);
}
export type OmittedReason='missing_title'|'duplicate_title'|'invalid_result'|'no_qualifying_events';
/** Laravel media_without_events: channels whose source row was read but left out of the prompt, newest first.
 * Membership is exactly the planner's (read rows within the cap minus plan.source); the reason restates its skip order. */
export function omittedMedia(rows:Record<string,unknown>[],plan:Pick<Plan,'source'|'input'>){
 const included=new Set((plan.source as ChannelSource[]).map(s=>s.pk)),titles=new Map<string,number>();
 for(const r of rows){const title=String(r.title??'');titles.set(title,(titles.get(title)??0)+1);}
 return rows.slice(0,plan.input.limit).filter(r=>!included.has(String(r.pk))).map(r=>{
  const title=String(r.title??'');let reason:OmittedReason;
  if(!title.trim())reason='missing_title';else if(titles.get(title)!==1)reason='duplicate_title';
  else{try{const payload=JSON.parse(String(r.result_json));reason=Array.isArray(Array.isArray(payload)?payload:payload?.events)?'no_qualifying_events':'invalid_result';}catch{reason='invalid_result';}}
  return {channelId:Number(r.u_id),title:title.trim()||null,sourcePk:String(r.pk),reason};
 });
}
export function registerPromptPreview(register:Register,reader:Reader,clock:()=>Date){
 const preview=async(q:Query,channelId?:number,path:Query={},identity?:ChannelIdentity)=>{
  const allowed=new Set(['date','from','to','type','condition','limit']);
  for(const [key,value]of Object.entries(q)){
   if(['tagid','or','not'].includes(key))throw new BadQuery('Legacy tagid/or/not filters are not supported by the new AI planner. Remove these filters and explicitly select a supported condition; taxonomy scopes are not automatically converted.');
   if(!allowed.has(key))throw new BadQuery(`Unsupported AI preview query: ${key}.`);
   if(typeof value!=='string')throw new BadQuery(`AI preview ${key} must be a single string.`);
   if(path[key]!==undefined&&path[key]!==value)throw new BadQuery(`AI preview ${key} conflicts with the route.`);
  }
  q={...q,...path};
  const type=text(q.type)||'oneday';if(!['oneday','todate','week'].includes(type))throw new BadQuery('Invalid AI data type.');
  const condition=text(q.condition)||'all';if(!['all','green','blue','neutral','finance','world'].includes(condition))throw new BadQuery('Invalid AI condition.');
  if(channelId&&q.condition!==undefined)throw new BadQuery('Channel AI previews do not accept a condition; their source scope is the selected channel.');
  let selected=dateFilter(q.date),from=dateFilter(q.from),to=dateFilter(q.to);
  if(selected&&[from,to].some(endpoint=>endpoint!==null&&endpoint!==selected))throw new BadQuery('AI preview date conflicts with from/to.');
  if(from&&to&&from>to)throw new BadQuery('AI preview from must not be after to.');
  // Laravel AiDailyPromptReport::period(): from/to read the channel summaries stored for exactly from 00:00:00 – to 23:59:59.
  const days=!channelId&&from!==null&&to!==null&&from!==to,options={dailyDays:days};
  const limit=q.limit===undefined?undefined:bounded(q.limit,1,1,channelId?500:1000);
  const makeInput=(start:string,end:string):Input=>({kind:channelId?'channel':'daily',from:start+' 00:00:00',to:end+' 23:59:59',...(limit===undefined?{}:{limit}),dataType:type as Input['dataType'],userToken:'CLI',...(channelId?{channelId}:{condition:condition as Condition})});
  // Validate the explicit period before any source read; a lone endpoint is a complete day.
  const provisionalFrom=from??selected??to??taipeiDate(clock()),provisionalTo=to??selected??from??taipeiDate(clock());
  let normalized:ReturnType<typeof normalizeInput>;
  try{normalized=normalizeInput(makeInput(provisionalFrom,provisionalTo),options);}catch{throw new BadQuery(`AI preview period/type must match the selected workflow (daily requires ${days?'complete days spanning at most 31 days':'one complete day'}).`);}
  if(channelId&&!identity)await readChannelIdentity(reader,channelId);
  if(!selected&&!from&&!to){
   let rows:Record<string,unknown>[];
   if(channelId)rows=await reader.rows(sql`SELECT MAX(publishedAt) AS date FROM urt_video WHERE u_id=${channelId}`);
   else{
    const filter=conditionSql(normalized,'a');
    const [source]=await planningReader(reader).query(`SELECT MAX(a.date_from) AS date FROM urt_channel_ai a WHERE a.data_type=? AND BINARY a.user_token=BINARY ? AND a.del_flag IS NULL AND TIME(a.date_from)='00:00:00' AND a.date_to=DATE(a.date_from)+INTERVAL 1 DAY-INTERVAL 1 SECOND${filter.sql}`,[type,'CLI',...filter.params]);
    rows=source as Record<string,unknown>[];
   }
   selected=text(rows[0]?.date).slice(0,10)||taipeiDate(clock());
  }
  from??=selected??to??taipeiDate(clock());to??=selected??from;
  const input=makeInput(from,to);
  try{normalizeInput(input,options);}catch{throw new BadQuery('AI preview period/type must match the selected workflow (daily requires one complete day).');}
  let read:Record<string,unknown>[]=[];
  const plan=await planAi(planningReader(reader,(statement,rows)=>{if(statement.includes('a.result_json'))read=rows;}),input,options);
  const sources=channelId?{}:{media:promptMedia(plan.source as ChannelSource[]),omittedMedia:omittedMedia(read,plan)};
  return {title:channelId?`頻道 ${channelId} 提示詞預覽`:days?`${from} – ${to} 彙整提示詞預覽`:`${from} 每日彙整提示詞預覽`,promptVersion:PROMPT_VERSION,prompt:plan.prompt,schema:plan.schema,sourceCount:plan.sourceCount,sourceLimit:plan.input.limit,omitted:plan.omitted,bounds:plan.bounds,blocked:plan.blocked,period:{from:timestamp(input.from),to:timestamp(input.to)},...sources,updatedAt:null,notes:['此頁使用與新版 AI 任務相同的規劃器，只讀取來源及組合提示詞，不呼叫模型或寫入資料。','顯示當下來源的預覽，不宣稱是過去 AI 生成時使用的不可變快照。','每日預覽省略 condition 時等同明確選擇 all；舊版 tagid/or/not 不會自動轉換，必須移除並重新選擇新版來源範圍。']};
 };
 register('/channels/:id/prompt',(p,q,identity)=>preview(q,positiveId(p.id),{},identity));
 register('/ai/days/prompt',(_p,q)=>preview(q));
 register('/ai/days/:date/prompt',(p,q)=>preview(q,undefined,{date:p.date}));
 register('/ai/days/:date/:condition/prompt',(p,q)=>preview(q,undefined,{date:p.date,condition:p.condition}));
}
