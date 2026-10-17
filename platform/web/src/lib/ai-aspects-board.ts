import type {ReportCell,ReportData,ReportValue} from '../../../api/src/report-contracts';
import type {ChannelTag} from '../../../api/src/contracts';
import type {ChannelAvatar} from '../../../shared/media-assets';

type Search=Record<string,string|string[]|undefined>;
/** Laravel AiAspectReport's switcher, in its order and labels. */
export const AI_ASPECT_CONDITIONS=[['all','全部'],['blue','泛藍'],['green','泛綠'],['neutral','中立'],['finance','財經'],['world','國際']] as const;
/** Laravel's columns: the score key and its header. */
export const AI_ASPECT_COLUMNS=[['台灣','台灣立場'],['泛綠','泛綠度'],['泛白','泛白度'],['泛藍','泛藍度'],['泛紅','泛紅度'],['中國','中國立場']] as const;
export type AspectName=typeof AI_ASPECT_COLUMNS[number][0];
/** LegacyTagFilter::visibleTags: the only channel tags Laravel printed under a channel. */
export const AI_ASPECT_VISIBLE_TAGS=[1,2,3,4,5,6,60,43,48,49,81] as const;

export interface AspectFilters {condition:string|null;tagid:number[];or:number[];not:number[];limit:number|null}
const one=(value:string|string[]|undefined)=>typeof value==='string'?value:'';
const ids=(value:string|string[]|undefined)=>[...new Set(one(value).split(',').map(s=>s.trim()).filter(s=>/^[1-9]\d*$/.test(s)).map(Number))];
/** The tag selection the API applies: a condition replaces tagid (or not, for neutral). */
export function aspectFilters(search:Search):AspectFilters{
 const raw=one(search.condition),condition=AI_ASPECT_CONDITIONS.some(([key])=>key===raw)?raw:null,limit=one(search.limit);
 const f:AspectFilters={condition,tagid:ids(search.tagid),or:ids(search.or),not:ids(search.not),limit:/^\d+$/.test(limit)?Number(limit):null};
 const tag=({blue:3,green:4,finance:31,world:41} as Record<string,number>)[condition??''];
 if(tag)f.tagid=[tag];
 if(condition==='neutral')f.not=[3,4,5,6,31,41];
 return f;
}
const tagName=(names:ReadonlyMap<number,string>,id:number)=>names.get(id)??String(id);
/** AiAspectReport::title. */
export function aspectTitle(f:AspectFilters,names:ReadonlyMap<number,string>){
 const tags=[...f.tagid,...f.or].map(id=>tagName(names,id)).join(' ');
 return tags?`${tags} 立場分布表`:f.condition==='neutral'?'中立頻道 立場分布表':'全部頻道 立場分布表';
}
/** AiAspectReport::displayFilters, labelled in Chinese with tag names. limit only when the URL sets it. */
export function aspectFilterChips(f:AspectFilters,names:ReadonlyMap<number,string>):{label:string;value:string}[]{
 const list=(xs:number[])=>xs.map(id=>tagName(names,id)).join('、'),chips:{label:string;value:string}[]=[];
 if(f.condition)chips.push({label:'條件',value:AI_ASPECT_CONDITIONS.find(([key])=>key===f.condition)![1]});
 if(f.tagid.length)chips.push({label:'全部包含',value:list(f.tagid)});
 if(f.or.length)chips.push({label:'包含任一',value:list(f.or)});
 if(f.not.length)chips.push({label:'排除',value:list(f.not)});
 if(f.limit!==null)chips.push({label:'每頁',value:`${f.limit} 筆`});
 return chips;
}
/** Switcher links drop the tag selection and the page offset, keeping the other parameters (Laravel kept limit). */
export function aspectConditionHref(path:string,search:Search,condition:string){
 const q=new URLSearchParams();
 for(const [key,value] of Object.entries(search)){
  if(['condition','tagid','or','not','offset'].includes(key))continue;
  for(const v of Array.isArray(value)?value:value===undefined?[]:[value])q.append(key,v);
 }
 if(condition!=='all')q.set('condition',condition);
 const s=q.toString();return s?`${path}?${s}`:path;
}

export interface AspectScore {value:number|null;detail:string}
export interface AspectRow {
 channelId:number|null;title:string;href:string|null;avatar:ChannelAvatar|null;
 scores:Record<AspectName,AspectScore>;balance:number|null;partial:boolean;source:{label:string;href:string}|null;
}
const cell=(v:ReportValue|ReportCell|undefined):ReportCell|null=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&'value' in v?v as ReportCell:null;
const score=(v:ReportValue|ReportCell|undefined):AspectScore=>{
 const c=cell(v),raw=c?c.value:v;
 return {value:typeof raw==='number'&&Number.isFinite(raw)?raw:null,detail:typeof c?.detail==='string'?c.detail:''};
};
/** 傾向 as AiAspectReport computed it: 泛綠＋泛白－泛藍－泛紅＋台灣－中國, missing scores counted as 0
 * (partial marks that). No score at all leaves it empty instead of 0. */
export function aspectBalance(scores:Record<AspectName,AspectScore>){
 const v=(n:AspectName)=>scores[n].value??0,known=AI_ASPECT_COLUMNS.filter(([n])=>scores[n].value!==null).length;
 return {balance:known?v('泛綠')+v('泛白')-v('泛藍')-v('泛紅')+v('台灣')-v('中國'):null,partial:known>0&&known<AI_ASPECT_COLUMNS.length};
}
/** The /ai/aspects rows (already sorted by the API) as the Laravel table needs them. */
export function aspectRows(data:Pick<ReportData,'rows'>):AspectRow[]{
 return data.rows.map(row=>{
  const channel=cell(row.channel),source=cell(row.source),media=channel?.media?.kind==='channel'?channel.media:null;
  const href=channel?.href??null,id=media?.channelId??Number(href?.match(/^\/channels\/(\d+)$/)?.[1]??NaN);
  const scores=Object.fromEntries(AI_ASPECT_COLUMNS.map(([n])=>[n,score(row[n])])) as Record<AspectName,AspectScore>;
  return {channelId:Number.isSafeInteger(id)&&id>0?id:null,title:String(channel?.value??row.channel??''),href,avatar:media?.avatar??null,scores,...aspectBalance(scores),
   source:source?.href?{label:String(source.value??''),href:source.href}:null};
 });
}
/** The visible tags of each channel, in the channel's own tag order. */
export function visibleChannelTags(rows:readonly {id:number;tags:readonly ChannelTag[]}[]){
 const visible=new Set<number>(AI_ASPECT_VISIBLE_TAGS),out=new Map<number,ChannelTag[]>();
 for(const row of rows)out.set(row.id,row.tags.filter(t=>visible.has(t.id)));
 return out;
}
/** /channels query that lists every channel that can carry a visible tag on this page:
 * any visible tag, narrowed by the page's tagid/not (the page's own `or` is dropped, which only widens it). */
export function tagLookupSearch(f:AspectFilters):Record<string,string>{
 return {or:AI_ASPECT_VISIBLE_TAGS.join(','),...(f.tagid.length?{tagid:f.tagid.join(',')}:{}),...(f.not.length?{not:f.not.join(',')}:{}),limit:'200'};
}
