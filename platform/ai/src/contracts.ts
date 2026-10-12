export type Kind = 'channel' | 'daily' | 'hourly';
export type Condition = 'all' | 'green' | 'blue' | 'neutral' | 'finance' | 'world' | 'news';
export interface Input { kind: Kind; from: string; to: string; condition?: Condition; channelId?: number; limit?: number; userToken?: string; dataType?: 'oneday' | 'todate' | 'week' | 'each'; sourceChannelAiPks?: string[] }
export interface Video { pk: string; u_id: number; videoId: string; title: string; publishedAt: string; viewCount: string }
export interface ChannelEvent { 事件: string; 描述: string; 角度: string; 陣營: string; 分類: string; 關鍵字: string[]; 人物: string[]; 地名: string[]; 類型: string[]; videoId: string[] }
export interface ChannelSource { pk: string; u_id: number; title: string; events: ChannelEvent[] }
export interface DailyEvent { 標題: string; 媒體事件: Record<string, string[]> }
export interface Plan { input: Required<Omit<Input, 'channelId'|'condition'|'sourceChannelAiPks'>> & Pick<Input,'channelId'|'condition'|'sourceChannelAiPks'>; table: 'urt_channel_ai'|'urt_ai_date'|'urt_ai_hour'; key: Record<string,string|number>; source: Video[]|ChannelSource[]; sourceCount: number; omitted: number; bounds: { min: number; max: number }; prompt: string; schema: Record<string,unknown>; blocked: string|null }
export const CHANNEL_IDS = [76,404,405,39,38,185,406,96,41,445,270,458,274,1405,1006,1674,407,350,268,456,498,187,432,1635,79,70,267,7,45,354,460,61,1064,709,1063,47,499,429,15];
export const PROMPT_VERSION = 'yt-ai-v2';
export function timestamp(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) || new Date(value.replace(' ','T')+'Z').toISOString().slice(0,19).replace('T',' ') !== value) throw new Error('Invalid Taipei SQL timestamp');
  return value;
}
export function normalizeInput(input: Input): Plan['input'] {
  if (!['channel','daily','hourly'].includes(input.kind)) throw new Error('Unsupported AI workflow');
  timestamp(input.from); timestamp(input.to);
  const span = Date.parse(input.to.replace(' ','T')+'Z')-Date.parse(input.from.replace(' ','T')+'Z');
  if (span < 0 || span > 31*86400000) throw new Error('AI period must be ordered and at most 31 days');
  if(input.kind==='hourly'&&span>=48*3600000)throw new Error('Hourly period must not exceed 48 hours');
  if (input.kind==='daily' && (input.from.slice(0,10)!==input.to.slice(0,10) || !input.from.endsWith('00:00:00') || !input.to.endsWith('23:59:59'))) throw new Error('Daily AI requires a complete Taipei day');
  if (input.kind==='channel' && (!Number.isSafeInteger(input.channelId)||Number(input.channelId)<1)) throw new Error('Channel id required');
  if(input.kind==='channel'&&input.condition!==undefined)throw new Error('Channel workflow does not accept condition');
  if (input.condition && !['all','green','blue','neutral','finance','world',...(input.kind==='hourly'?['news']:[])].includes(input.condition)) throw new Error('Invalid AI condition');
  if(input.sourceChannelAiPks!==undefined&&(input.kind!=='daily'||!Array.isArray(input.sourceChannelAiPks)||input.sourceChannelAiPks.length>1000||input.sourceChannelAiPks.some(pk=>typeof pk!=='string'||!/^\d{1,10}$/.test(pk)||Number(pk)<1)||new Set(input.sourceChannelAiPks).size!==input.sourceChannelAiPks.length))throw new Error('Invalid daily source PK scope');
  const limit=input.limit??(input.kind==='hourly'?5000:input.kind==='channel'?120:1000);
  if (!Number.isSafeInteger(limit)||limit<1||limit>(input.kind==='hourly'?5000:input.kind==='channel'?500:1000)) throw new Error('Invalid AI source cap');
  const userToken=input.userToken??(input.kind==='hourly'?'cli':'CLI'); if (!/^[A-Za-z0-9_-]{1,32}$/.test(userToken)) throw new Error('Invalid AI user token');
  const dataType=input.dataType??(input.kind==='hourly'?'each':'oneday');
  if (!(input.kind==='hourly'?['each']:['oneday','todate','week']).includes(dataType)) throw new Error('Invalid AI data type');
  return {...input,limit,userToken,dataType};
}
const str={type:'string',minLength:1,maxLength:2000};
const list=(max=30,min=0)=>({type:'array',items:str,minItems:min,maxItems:max});
export function eventSchema(kind:Kind,bounds:Plan['bounds']): Record<string,unknown> {
  const properties=kind==='daily'?{標題:{...str,maxLength:128},媒體事件:{type:'array',minItems:2,maxItems:6,items:{type:'object',properties:{媒體:str,事件:list(1,1)},required:['媒體','事件'],additionalProperties:false}}}:{事件:str,描述:str,角度:str,陣營:str,分類:str,關鍵字:list(),人物:list(),地名:list(),類型:list(20),videoId:{...list(500,1),items:{type:'string',pattern:'^[A-Za-z0-9_-]{11}$'}}};
  return {type:'object',properties:{events:{type:'array',minItems:bounds.min,maxItems:bounds.max,items:{type:'object',properties,required:Object.keys(properties),additionalProperties:false}}},required:['events'],additionalProperties:false};
}
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('AI object expected');return value as Record<string,unknown>;}
function text(value:unknown,max=2000):string{if(typeof value!=='string'||!value.trim()||value.length>max||/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value))throw new Error('Invalid AI text');return value;}
function strings(value:unknown,min=0,max=30):string[]{if(!Array.isArray(value)||value.length<min||value.length>max)throw new Error('Invalid AI list');const list=value.map(v=>text(v));if(new Set(list).size!==list.length)throw new Error('Duplicate AI list value');return list;}
export function validateResult(content:string,plan:Plan):ChannelEvent[]|DailyEvent[]{
  if(Buffer.byteLength(content)>60000)throw new Error('AI result exceeds legacy TEXT budget');
  const root=object(JSON.parse(content));if(Object.keys(root).length!==1||!Object.hasOwn(root,'events'))throw new Error('AI root requires only events');const values=root.events;
  if(!Array.isArray(values)||values.length>500)throw new Error('AI event count outside contract');
  const videoIds=new Set((plan.source as Video[]).map(v=>v.videoId));
  const media=new Map((plan.source as ChannelSource[]).map(s=>[s.title,s.events]));
  const valid:(ChannelEvent|DailyEvent)[]=[]; const titles=new Set<string>();
  for(const value of values){
    try{
      const row=object(value), title=text(row[plan.input.kind==='daily'?'標題':'事件'],plan.input.kind==='daily'?128:2000);
      if(titles.has(title))continue;
      if(plan.input.kind==='daily'){
        const refs=row.媒體事件;if(!Array.isArray(refs)||refs.length<2||refs.length>6)throw new Error('Invalid daily references');
        const mapped:Record<string,string[]>=Object.create(null);
        for(const ref of refs){const r=object(ref),name=text(r.媒體),events=strings(r.事件,1,1);if(Object.hasOwn(mapped,name)||!media.get(name)?.some(e=>e.事件===events[0]))throw new Error('Unresolved daily source reference');mapped[name]=events;}
        valid.push({標題:title,媒體事件:mapped});
      }else{
        const ids=[...new Set(strings(row.videoId,1,500))];if(ids.some(id=>!videoIds.has(id)))throw new Error('Unknown video reference');
        valid.push({事件:title,描述:text(row.描述),角度:text(row.角度),陣營:text(row.陣營),分類:text(row.分類),關鍵字:strings(row.關鍵字),人物:strings(row.人物),地名:strings(row.地名),類型:strings(row.類型,0,20),videoId:ids});
      }
      titles.add(title);
    }catch{/* Discard this invalid item; never allow it to invalidate enough valid grounded topics. */}
  }
  if(valid.length<plan.bounds.min||valid.length>plan.bounds.max)throw new Error('AI valid event count outside contract');
  return valid as ChannelEvent[]|DailyEvent[];
}
