import type {ReportMeta,Search} from './api';
import {groupDefinitions} from '../../../api/src/reports/group-definitions';
import {COMMENTS_PUBLISHED} from './comments-launch';
import {LIVE_NEWS_SCOPE} from './site-nav';
export type ReportTab={href:string;label:string};
const taxonomy=['tagid','or','not'];
const period=['from','to'];
const liveGroupHours=/^\/live\/groups\/[^/]+\/hours$/;
/** All paths are canonical URI-encoded URLs from the catch-all page boundary. */
const decodeSegment=(value:string)=>{try{return decodeURIComponent(value);}catch{return value;}};
const scalar=(value:Search[string])=>typeof value==='string'?value:undefined;
/** Whitelist scope by destination. days/hours/type/min/sort have different units
 * across families, so route-specific controls are carried only on the same page. */
function scopeKeys(path:string):string[]{
 if(/^\/keywords\/[^/]+\/videos$/.test(path))return [...taxonomy,...period,'since','until','rankingPool','q','channelId','channelIds'];
 if(/^\/ai\/(days(?:\/\d{4}-\d{2}-\d{2}(?:\/[^/]+)?)?|hours|days\/prompt)$/.test(path))return ['date','condition'];
 if(path==='/ai/periods')return [...period,'condition'];
 if(/^\/channels\/\d+\/prompt$/.test(path))return ['date'];
 if(/^\/channels\/\d+\/ai$/.test(path))return [];
 if(/^\/channels\/\d+\/(ai\/days|people)$/.test(path))return ['date'];
 if(/^\/channels\/\d+\/trends$/.test(path))return period;
 if(/^\/channels(?:\/\d+)?$/.test(path)||/^\/tags\/\d+\/channels$/.test(path))return [...taxonomy,'q'];
 if(/(?:^\/videos$|^\/channels\/\d+\/videos$|^\/(?:tags|keywords)(?:\/[^/]+)?\/videos$)/.test(path))return [...taxonomy,...period,'q','channelId','channelIds'];
 if(path==='/live/current')return [...taxonomy,'q'];
 // Taxonomy hourly live is one day; group/period/view selectors of ranking/trends do not apply.
 if(liveGroupHours.test(path))return ['date'];
 if(/^\/live\/(days|periods|hours|channels|tags|continuous|trends\/daily)/.test(path))return [...taxonomy,...period,'q'];
 if(path==='/tags/compare')return [...taxonomy,...period,'tags'];
 if(/^\/(?:tags|keywords)\//.test(path))return [...taxonomy,...period];
 if(/^\/groups\/[^/]+\/(ranking|trends|live)$/.test(path))return period;
 return [];
}
function samePageKeys(path:string):string[]{
 if(/^\/channels\/\d+\/ai$/.test(path))return []; // This tab always returns to the overview, not its legacy daily alias.
 if(/\/videos$/.test(path)||path==='/videos')return ['column','hours','days','min'];
 if(path==='/channels'||/\/channels$/.test(path))return ['column','min'];
 if(/^\/channels\/\d+\/trends$/.test(path))return ['mode','orig','each','videos','days'];
 if(path==='/live/current')return ['hours'];
 if(liveGroupHours.test(path))return ['type'];
 if(path.startsWith('/ai/'))return ['type','month','date','condition','event','pk'];
 return ['days','today','type','diff','view','tags','group','pk','sourceLimit','hours','min'];
}
export function reportHref(target:string,search:Search={},source=target):string{
 const params=new URLSearchParams(),keys=[...scopeKeys(target),...(target===source?samePageKeys(target):[])];
 for(const key of new Set(keys)){const value=scalar(search[key]);if(value!==undefined&&value!=='')params.set(key,value);}
 // The hourly group report accepts only its own count/views metric.
 if(liveGroupHours.test(target)&&!['count','views'].includes(params.get('type')??'count'))params.delete('type');
 // A selected day is a one-day period when moving to an interval report.
 if(target!==source&&keys.includes('from')&&keys.includes('to')&&!params.has('from')&&!params.has('to')){const date=scalar(search.date);if(date&&/^\d{4}-\d{2}-\d{2}$/.test(date)){params.set('from',date);params.set('to',date);}}
 // Single-day views retain the endpoint of an explicitly selected interval.
 if(target!==source&&keys.includes('date')&&!params.has('date')){const date=scalar(search.to);if(date&&/^\d{4}-\d{2}-\d{2}$/.test(date))params.set('date',date);}
 return target+(params.size?'?'+params.toString():'');
}
export function eventTabs(path:string,search:Search):ReportTab[]{
 const daily=path.match(/^\/ai\/days\/(\d+)\/events(?:\/history)?$/),event=path.match(/^\/ai\/events\/(\d+)(?:\/(people|wall|history))?$/);
 if(!daily&&!event)return [];
 const id=(daily??event)![1]!,title=scalar(search.event)?.trim()||undefined,query=title?'?'+new URLSearchParams({event:title}):'',byDaily=!!daily||!!title;
 const base=byDaily?`/ai/days/${id}/events`:`/ai/events/${id}`;
 return [{href:base+query,label:'議題分析'},{href:base+'/history'+query,label:'跨日來源脈絡'},{href:`/ai/events/${id}/people${query}`,label:'人物觀點'},{href:`/ai/events/${id}/wall${query}`,label:'來源影片牆'}];
}
export function familyTabs(path:string,search:Search={},coverage?:ReportMeta['coverage']):ReportTab[]{
 const event=eventTabs(path,search);if(event.length)return event;
 const dated=path.match(/^\/ai\/days\/(\d{4}-\d{2}-\d{2})(?:\/([^/]+))?/);if(dated)search={...search,date:dated[1],...(dated[2]&&dated[2]!=='prompt'?{condition:decodeSegment(dated[2])}:{})};
 const liveDate=path.match(/^\/live\/days\/(\d{4}-\d{2}-\d{2})$/),channelDate=path.match(/^\/channels\/\d+\/ai\/days\/(\d{4}-\d{2}-\d{2})$/);if(liveDate)search={...search,from:liveDate[1],to:liveDate[1]};if(channelDate)search={...search,date:channelDate[1]};
 const [,family,id]=path.split('/');let base='',parts:[string,string][]=[];
 if(family==='channels'&&/^\d+$/.test(id??'')){base=`/channels/${id}`;const hideProfile=coverage?.channelId===Number(id)&&coverage.channelProfileAvailable===false;parts=[...(hideProfile?[]:[['','概覽'] as [string,string]]),['videos','影片'],...(COMMENTS_PUBLISHED?[['comments','留言'] as [string,string]]:[]),['cloud','關鍵詞'],['trends','趨勢'],['people','人物'],['ai','AI 議題'],['ai/days','每日分析'],['prompt','提示詞預覽']];}
 if(family==='tags'){base=/^\d+$/.test(id??'')?`/tags/${id}`:'/tags';parts=[...(base==='/tags'?[]:[['channels','頻道'] as [string,string]]),['videos','影片'],...(COMMENTS_PUBLISHED?[['comments','留言'] as [string,string]]:[]),['cloud','關鍵詞'],['days','逐日'],['trends','趨勢']];}
 if(family==='keywords'&&id){base=`/keywords/${id}`;parts=[['videos','影片'],['cloud','關鍵詞'],['days','逐日'],['groups/trends','群組趨勢'],['live/trends','直播趨勢']];}
 if(family==='groups'&&id){base=`/groups/${id}`;parts=[['','群組內容'],...(Object.hasOwn(groupDefinitions,id)?[['ranking','排行'],['trends','趨勢']] as [string,string][]:[])];}
 if(family==='live'){base='/live';parts=[['current','即時直播'],['days','每日直播'],['periods','期間'],['hours','逐時'],['channels','頻道'],['tags','分類'],['continuous','連續直播'],['trends/daily','每日趨勢'],['walls/news','直播電視牆']];}
 if(family==='ai'){base='/ai';parts=[['days','每日議題'],['hours','每小時'],['periods','跨日議題'],['aspects','觀點比較'],['days/prompt','提示詞預覽']];}
 const tabs=parts.map(([part,label])=>({href:reportHref(base+(part?'/'+part:''),search,path),label}));
 // /groups/:name/live has content tag-set semantics; taxonomy groups link to their hourly live report.
 if(family==='groups'&&id&&Object.hasOwn(groupDefinitions,id))tabs.push({href:reportHref(`/live/groups/${encodeURIComponent(id)}/hours`,search,path),label:'每小時直播'});
 if(family==='keywords'&&id)tabs.push({href:'/compare/titles',label:'標題寫法'});
 if(family==='tags'||family==='keywords'&&id)tabs.push({href:reportHref('/tags/compare',{...search,...(family==='keywords'?{tags:decodeSegment(id!)}:/^\d+$/.test(id??'')?{tagid:[...new Set([id!,...(scalar(search.tagid)||'').split(',').filter(Boolean)])].join(',')}:{})},path),label:'詞彙比較'});
 return tabs;
}
/** Original live.php scopes (nav_live.php): the main menu opens LIVE_NEWS_SCOPE; 全台灣／個人社論 are fixed tag sets. */
const livePresets:{label:string;scope:string;lead:string}[]=[
 {label:'新聞政治頻道',scope:LIVE_NEWS_SCOPE,lead:'社論、政治人物、電視台、新聞、政黨、廣播頻道'},
 {label:'全台灣',scope:'not=11,33,36,59,99,100',lead:'全台灣頻道'},
 {label:'個人社論',scope:'tagid=1&not=2,9,10,12,13,33,36,81',lead:'個人社論頻道'},
 {label:'全部頻道',scope:'',lead:''},
];
const liveScope=(search:Search)=>{const params=new URLSearchParams();for(const key of taxonomy){const value=scalar(search[key]);if(value)params.set(key,value);}return params;};
const sameScope=(a:URLSearchParams,b:string)=>{const c=new URLSearchParams(b);return [...new Set([...a.keys(),...c.keys()])].every(key=>a.get(key)===c.get(key));};
/** Lead text naming the preset tag scope of /live/current, like the original page title. */
export function liveScopeLead(search:Search):string|undefined{const scope=liveScope(search);return livePresets.find(p=>sameScope(scope,p.scope))?.lead||undefined;}
/** nav_live.php: 現在正直播排行 and 正直播排行(排除帶狀) keep the selected tags; the presets replace them. */
export function liveViewTabs(search:Search):(ReportTab&{active:boolean})[]{
 const scope=liveScope(search),hours=scalar(search.hours),q=[...scope].map(([key,value])=>key+'='+encodeURIComponent(value).replace(/%2C/gi,',')).join('&'),href=(query:string)=>'/live/current'+(query?'?'+query:'');
 const preset=livePresets.find(p=>sameScope(scope,p.scope));
 return [
  {label:'現在正直播排行',href:href(q),active:!hours&&!preset},
  {label:'正直播排行(排除帶狀)',href:href([q,'hours=24'].filter(Boolean).join('&')),active:hours==='24'},
  ...livePresets.map(p=>({label:p.label,href:href(p.scope),active:!hours&&p===preset})),
 ];
}
export function wallVariantTabs():ReportTab[]{return [{href:'/live/walls/news',label:'新聞直播'},{href:'/live/walls/china',label:'中國直播'},{href:'/live/walls/alternate',label:'其他直播'}];}

export function canonicalTabPath(path:string):string{return path.replace(/^\/ai\/days\/\d{4}-\d{2}-\d{2}(?:\/(?!prompt$)[^/]+)?(\/prompt)?$/,(_match,prompt)=>'/ai/days'+(prompt||'')).replace(/^(\/channels\/\d+\/ai\/days)\/\d{4}-\d{2}-\d{2}$/,'$1').replace(/^\/live\/days\/\d{4}-\d{2}-\d{2}$/,'/live/days');}
/** API report switches supply an explicit active flag; false must override
 * path matching when several links share a path but select different queries. */
export function currentTab(href:string,active:string,explicit?:boolean){return explicit??(href===active||(!active.includes('?')&&canonicalTabPath(href.split('?')[0]!)===canonicalTabPath(active)));}
