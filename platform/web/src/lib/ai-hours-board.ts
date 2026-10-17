import type {Search} from './api';
import type {ReportCell,ReportValue} from './report-contract';
import type {ChannelAvatar as AvatarAsset} from '../../../shared/media-assets';

type Cells=Record<string,ReportValue|ReportCell>;
export interface HourVideo {videoId:string;channelId:number|null;channelTitle:string;channelAvatar:AvatarAsset|null}
export interface HourTopic {event:string;description:string;category:string;angle:string;camp:string;keywords:string[];names:string[];videos:number;first:HourVideo|null}
export interface HourGroup {sourceId:number;date:string;hour:string;dataType:string;topics:HourTopic[]}

export const cellText=(value:ReportValue|ReportCell|undefined):string=>{const v=value!==null&&typeof value==='object'?value.value:value;return typeof v==='string'?v.trim():typeof v==='number'?String(v):'';};
export const cellNumber=(value:ReportValue|ReportCell|undefined):number|null=>{const v=value!==null&&typeof value==='object'?value.value:value;return typeof v==='number'&&Number.isFinite(v)?v:null;};
/** The API joins list fields with 「、」; Laravel showed at most eight chips per cell. */
export const splitTerms=(value:string,max=8)=>value.split('、').map(term=>term.trim()).filter(Boolean).slice(0,max);
/** Taipei calendar date and hour of an API UTC instant. */
export function taipeiHour(value:string):{date:string;hour:string}{
 const at=Date.parse(value);if(!Number.isFinite(at))return {date:'',hour:''};
 const iso=new Date(at+8*3600000).toISOString();return {date:iso.slice(0,10),hour:iso.slice(11,13)};
}
export function aiHoursTitle(date:string|null,condition:string){
 if(!date)return '當日分時事件整理';
 return ({green:`泛綠媒體在 ${date} 每小時主要報導`,blue:`泛藍媒體在 ${date} 每小時主要報導`,neutral:`較無偏媒體在 ${date} 每小時主要報導`,world:`${date} 國際新聞每小時報導`,finance:`${date} 財經新聞每小時報導`} as Record<string,string>)[condition]??`${date} 當日分時事件整理`;
}
export function shiftDate(date:string,days:number){const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
export function taipeiToday(now=new Date()){return new Date(+now+8*3600000).toISOString().slice(0,10);}

/** One table per analysed hour (API row order: newest hour first), each topic joined to the
 * first source video the API lists for it under 本頁議題的來源影片. */
export function hourGroups(rows:Cells[],refs:Cells[]):HourGroup[]{
 const first=new Map<string,HourVideo>();
 for(const ref of refs){
  const key=`${cellNumber(ref.sourceId)}:${cellNumber(ref.topicIndex)}`;if(first.has(key))continue;
  const video=ref.video,videoId=video&&typeof video==='object'?(video.media?.kind==='video'?video.media.videoId:cellText(video)):cellText(video);
  if(!/^[A-Za-z0-9_-]{11}$/.test(videoId))continue;
  const channel=ref.channel&&typeof ref.channel==='object'?ref.channel:null,source=channel?.sources?.[0];
  first.set(key,{videoId,channelId:source?.channelId??null,channelTitle:source?.channelTitle??cellText(channel??undefined),channelAvatar:source?.channelAvatar??null});
 }
 const groups:HourGroup[]=[];
 for(const row of rows){
  const event=cellText(row.event);if(!event)continue;
  const sourceId=cellNumber(row.sourceId)??0,last=groups.at(-1);
  const group=last&&last.sourceId===sourceId?last:(()=>{const {date,hour}=taipeiHour(cellText(row.time));const g={sourceId,date,hour,dataType:cellText(row.dataType),topics:[]};groups.push(g);return g;})();
  group.topics.push({event,description:cellText(row.summary),category:cellText(row.category),angle:cellText(row.angle),camp:cellText(row.camp),
   keywords:splitTerms(cellText(row.keywords)),names:[...splitTerms(cellText(row.people),Infinity),...splitTerms(cellText(row.places),Infinity)].slice(0,8),
   videos:cellNumber(row.videos)??0,first:first.get(`${sourceId}:${cellNumber(row.topicIndex)}`)??null});
 }
 return groups;
}

/** Laravel listed every topic of the selected range on one page; the API pages by 200,
 * so the remaining pages are read up to `maxRows` (an explicit `limit` keeps one page). */
export const PAGE_SIZE=200,MAX_ROWS=2000;
export function pageOffsets(total:number,offset:number,pageSize=PAGE_SIZE,maxRows=MAX_ROWS):number[]{
 const offsets:number[]=[];for(let at=offset+pageSize;at<total&&at<offset+maxRows;at+=pageSize)offsets.push(at);return offsets;
}

const scalar=(value:Search[string])=>typeof value==='string'?value:undefined;
/** Same-page link that keeps the current query (as Laravel's `$query +`) except paging. */
export function pageHref(path:string,search:Search,set:Record<string,string|null>){
 const params=new URLSearchParams();
 for(const [key,value] of Object.entries(search)){if(key==='offset'||key in set)continue;const v=scalar(value);if(v)params.set(key,v);}
 for(const [key,value] of Object.entries(set))if(value)params.set(key,value);
 return path+(params.size?'?'+params.toString():'');
}
