import type {AspectReportData,AspectTag,ReportCell,ReportValue} from '../../../api/src/report-contracts';
export type {AspectReportData};
import type {ChannelAvatar} from '../../../shared/media-assets';

type Search=Record<string,string|string[]|undefined>;
/** Laravel AiAspectReport's switcher, in its order and labels. */
export const AI_ASPECT_CONDITIONS=[['all','全部'],['blue','泛藍'],['green','泛綠'],['neutral','中立'],['finance','財經'],['world','國際']] as const;
/** Laravel's columns: the score key and its header. */
export const AI_ASPECT_COLUMNS=[['台灣','台灣立場'],['泛綠','泛綠度'],['泛白','泛白度'],['泛藍','泛藍度'],['泛紅','泛紅度'],['中國','中國立場']] as const;
export type AspectName=typeof AI_ASPECT_COLUMNS[number][0];

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
/** Tag names the API resolved for the active tagid/or/not selection. */
export const aspectTagNames=(data:Partial<Pick<AspectReportData,'filterTags'>>)=>new Map((Array.isArray(data.filterTags)?data.filterTags:[]).map(t=>[t.id,t.name]));
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
 channelId:number|null;title:string;href:string|null;avatar:ChannelAvatar|null;tags:AspectTag[];
 scores:Record<AspectName,AspectScore>;balance:number|null;partial:boolean;source:{label:string;href:string}|null;
}
const cell=(v:ReportValue|ReportCell|undefined):ReportCell|null=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&'value' in v?v as ReportCell:null;
const score=(v:ReportValue|ReportCell|undefined):AspectScore=>{
 const c=cell(v),raw=c?c.value:v;
 return {value:typeof raw==='number'&&Number.isFinite(raw)?raw:null,detail:typeof c?.detail==='string'?c.detail:''};
};
/** The /ai/aspects rows (already sorted by the API) as the Laravel table needs them. 傾向 comes from the
 * API (missing scores counted as 0); partial marks a row where some but not all six scores exist. */
export function aspectRows(data:Pick<AspectReportData,'rows'>&Partial<Pick<AspectReportData,'channelTags'>>):AspectRow[]{
 const channelTags=data.channelTags&&typeof data.channelTags==='object'?data.channelTags:{};
 return data.rows.map(row=>{
  const channel=cell(row.channel),source=cell(row.source),media=channel?.media?.kind==='channel'?channel.media:null;
  const href=channel?.href??null,id=media?.channelId??Number(href?.match(/^\/channels\/(\d+)$/)?.[1]??NaN),channelId=Number.isSafeInteger(id)&&id>0?id:null;
  const scores=Object.fromEntries(AI_ASPECT_COLUMNS.map(([n])=>[n,score(row[n])])) as Record<AspectName,AspectScore>;
  const known=AI_ASPECT_COLUMNS.filter(([n])=>scores[n].value!==null).length,tags=channelId===null?[]:channelTags[String(channelId)];
  return {channelId,title:String(channel?.value??row.channel??''),href,avatar:media?.avatar??null,tags:Array.isArray(tags)?tags:[],scores,
   balance:score(row.balance).value,partial:known>0&&known<AI_ASPECT_COLUMNS.length,source:source?.href?{label:String(source.value??''),href:source.href}:null};
 });
}
