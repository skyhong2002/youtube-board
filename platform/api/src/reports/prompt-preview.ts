import {readChannelIdentity,type ChannelIdentity} from './channel-identity.js';
import {sql} from 'drizzle-orm';
import type {Connection} from 'mysql2/promise';
import type {Reader} from '../db/client.js';
import {planAi,conditionSql} from '../../../ai/src/planner.js';
import {normalizeInput,PROMPT_VERSION,type Input,type Condition} from '../../../ai/src/contracts.js';
import {BadQuery,bounded,dateFilter,positiveId,type Query} from './query.js';
import {text,taipeiDate,timestamp} from './normalize.js';
import type {Register} from './table.js';
/** Adapter is private to the reviewed planner's static SELECTs, never accepts HTTP SQL. */
function planningReader(reader:Reader):Pick<Connection,'query'>{
 return {query:async(statement:string,params:unknown[]=[])=>{
  if(!/^SELECT\s/i.test(statement))throw new Error('AI preview attempted a non-read query');
  const pieces=statement.split('?');if(pieces.length!==params.length+1)throw new Error('Planner parameter mismatch');
  const query=sql.join(pieces.flatMap((piece,i)=>i===params.length?[sql.raw(piece)]:[sql.raw(piece),sql`${params[i]}`]),sql``);
  return [await reader.rows(query),[]];
 }} as unknown as Pick<Connection,'query'>;
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
  const limit=q.limit===undefined?undefined:bounded(q.limit,1,1,channelId?500:1000);
  const makeInput=(start:string,end:string):Input=>({kind:channelId?'channel':'daily',from:start+' 00:00:00',to:end+' 23:59:59',...(limit===undefined?{}:{limit}),dataType:type as Input['dataType'],userToken:'CLI',...(channelId?{channelId}:{condition:condition as Condition})});
  // Validate the explicit period before any source read; a lone endpoint is a complete day.
  const provisionalFrom=from??selected??to??taipeiDate(clock()),provisionalTo=to??selected??from??taipeiDate(clock());
  let normalized:ReturnType<typeof normalizeInput>;
  try{normalized=normalizeInput(makeInput(provisionalFrom,provisionalTo));}catch{throw new BadQuery('AI preview period/type must match the selected workflow (daily requires one complete day).');}
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
  try{normalizeInput(input);}catch{throw new BadQuery('AI preview period/type must match the selected workflow (daily requires one complete day).');}
  const plan=await planAi(planningReader(reader),input);
  return {title:channelId?`頻道 ${channelId} 提示詞預覽`:`${from} 每日彙整提示詞預覽`,promptVersion:PROMPT_VERSION,prompt:plan.prompt,schema:plan.schema,sourceCount:plan.sourceCount,sourceLimit:plan.input.limit,omitted:plan.omitted,bounds:plan.bounds,blocked:plan.blocked,period:{from:timestamp(input.from),to:timestamp(input.to)},updatedAt:null,notes:['此頁使用與新版 AI 任務相同的規劃器，只讀取來源及組合提示詞，不呼叫模型或寫入資料。','顯示當下來源的預覽，不宣稱是過去 AI 生成時使用的不可變快照。','每日預覽省略 condition 時等同明確選擇 all；舊版 tagid/or/not 不會自動轉換，必須移除並重新選擇新版來源範圍。']};
 };
 register('/channels/:id/prompt',(p,q,identity)=>preview(q,positiveId(p.id),{},identity));
 register('/ai/days/prompt',(_p,q)=>preview(q));
 register('/ai/days/:date/prompt',(p,q)=>preview(q,undefined,{date:p.date}));
 register('/ai/days/:date/:condition/prompt',(p,q)=>preview(q,undefined,{date:p.date,condition:p.condition}));
}
