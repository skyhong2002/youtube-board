import type { Row } from '../db/client.js';
import { aiItems, object, pickStrings } from './normalize.js';
export function channelText(row:Row,keys:string[]):string {for(const key of keys){const v=row[key];if(typeof v==='string'&&v.trim())return v.trim();if(typeof v==='number'&&Number.isFinite(v))return String(v);}return '';}
export const excludedChannelPeople = new Set(['王淑麗','郭正亮','蔡正元','葉思敏','丁士芬','孫大千','黃征輝','栗正傑','黃暐瀚','尚毅夫','黃益中','吳靜怡','康仁俊','于北辰','謝寒冰','吳德榮','張雅琴','劉寶傑','徐俊相','鄭明典','葉俞璘','賴家瑩','鄭凱銘','未知','農民','無特殊人物','無','不明','交通部官員','警方','居民']);
export interface ChannelTopic { title:string; description:string; category:string; angle:string; camp:string; people:string[]; keywords:string[]; places:string[]; videos:string[]; invalidReferences:number }
export function channelTopics(payload:unknown):ChannelTopic[] {
 return aiItems(payload).map(object).map(row => {
  const references=pickStrings(row,['videoId','video_id','video_ids','videos']);
  return {title:channelText(row,['事件','議題','標題','event','topic','title']),description:channelText(row,['描述','說明','description','content']),category:channelText(row,['分類','類型','category','type']),angle:channelText(row,['角度','angle']),camp:channelText(row,['陣營','camp','stance']),people:pickStrings(row,['人物','people']),keywords:pickStrings(row,['關鍵字','keywords']),places:pickStrings(row,['地名','places']),videos:references.filter(v=>/^[A-Za-z0-9_-]{11}$/.test(v)),invalidReferences:references.filter(v=>!/^[A-Za-z0-9_-]{11}$/.test(v)).length};
 });
}
function decoded(value:unknown):unknown {if(typeof value!=='string')return value;try{return JSON.parse(value);}catch{return null;}}
export function overviewItems(payload:unknown,keys:string[]):Row[] {
 const raw=decoded(payload);if(Array.isArray(raw))return raw.map(object);
 const root=object(raw);for(const key of keys)if(root[key]&&typeof root[key]==='object')return (Array.isArray(root[key])?root[key] as unknown[]:Object.values(object(root[key]))).map(object);
 return Object.values(root).map(object);
}
export function storedNumber(value:unknown):number|null {if(typeof value!=='number'&&(typeof value!=='string'||!value.trim()||!/^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(value.trim())))return null;const n=Number(value);return Number.isFinite(n)?n:null;}
export function overviewAspects(payload:unknown):{group:string;item:string;description:string;preference:number|null}[] {
 const output:{group:string;item:string;description:string;preference:number|null}[]=[];
 function walk(value:unknown,group:string,depth:number){
  if(depth>8)return;const row=object(value),item=channelText(row,['項目','item','name']);
  if(item){const number=storedNumber(row['偏好度']??row.preference??row.score??row.value);output.push({group,item,description:channelText(row,['描述','description','content']),preference:number});return;}
  if(Array.isArray(value)){for(const child of value)walk(child,group,depth+1);return;}
  for(const [key,child]of Object.entries(row))if(child&&typeof child==='object')walk(child,group!=='立場'||['aspect','aspects','result','data','立場'].includes(key)?group:key,depth+1);
 }
 walk(decoded(payload),'立場',0);return output;
}
export function decodedAnalysis(payload:unknown):boolean {const raw=decoded(payload);return raw!==null&&typeof raw==='object';}
