import type {Row} from '../db/client.js';
import {object} from './normalize.js';
import {storedNumber} from './channel-ai-shapes.js';
export const aspectNames = ['台灣','泛綠','泛白','泛藍','泛紅','中國'] as const;
function scalar(row:Row,keys:string[]){for(const key of keys){const v=row[key];if(typeof v==='string'||typeof v==='number'||typeof v==='boolean')return typeof v==='boolean'?(v?'1':''):String(v).trim();}return '';}
/** Laravel's first-existing-group precedence, with absent scores explicitly null. */
export function aspectValues(payload:unknown){
 let raw:unknown=payload;if(typeof raw==='string'){try{raw=JSON.parse(raw);}catch{raw=null;}}
 for(let depth=0;depth<32;depth++){
  if(Array.isArray(raw)||raw===null||typeof raw!=='object')break;
  const row=object(raw),key=['aspect','aspects','立場','result','data'].find(k=>row[k]!==null&&typeof row[k]==='object');
  if(!key)break;raw=row[key];
 }
 let groups:Row=object(raw);
 if(Array.isArray(raw)){
  groups=Object.create(null) as Row;for(const item of raw){const row=object(item),group=scalar(row,['分類','群組','類型','group','category','type']);if(group){if(!Array.isArray(groups[group]))groups[group]=[];(groups[group] as unknown[]).push(item);}}
  if(!Object.keys(groups).length)groups={'政治':raw,'兩岸':raw};
 }
 const values=Object.fromEntries(aspectNames.map(n=>[n,{value:null as number|null,detail:''}])) as Record<typeof aspectNames[number],{value:number|null;detail:string}>;
 for(const names of [['兩岸角度','兩岸'],['政治傾向','政治立場','政治偏向','政治']]){
  const key=names.find(k=>groups[k]!==null&&typeof groups[k]==='object');if(!key)continue;
  for(const item of Object.values(groups[key] as object)){
   const row=object(item),name=scalar(row,['項目','item','name']);if(!aspectNames.includes(name as typeof aspectNames[number]))continue;
   let score:number|null=null;for(const k of ['偏好度','score','value','preference']){const n=storedNumber(row[k]);if(n!==null){score=Number.isSafeInteger(Math.trunc(n))?Math.trunc(n):null;break;}}
   values[name as typeof aspectNames[number]]={value:score,detail:scalar(row,['描述','description','content'])};
  }
 }
 const score=(name:typeof aspectNames[number])=>BigInt(values[name].value??0);
 // Legacy sorting treats missing inputs as zero; public cells retain missingness.
 const sortBalance=score('泛綠')+score('泛白')-score('泛藍')-score('泛紅')+score('台灣')-score('中國');
 return {values,sortBalance};
}
