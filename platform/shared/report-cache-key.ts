import { createHash } from 'node:crypto';
/** Cache identities normalize query scalars and taxonomy sets identically on both sides. */
export function normalizedReportKeys(keys:Record<string,unknown>) {
 return Object.fromEntries(Object.entries(keys).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,value])=>{
  if(['u_id','days'].includes(key)){const n=Number(value);if(!Number.isSafeInteger(n)||n<1)throw new Error('Invalid cache numeric identity');return [key,n];}
  if(['tagid','tag_or','tag_not'].includes(key)){if(value===null||value===undefined||value==='')return[key,null];const ids=String(value).split(',').map(Number);if(ids.some(n=>!Number.isSafeInteger(n)||n<1))throw new Error('Invalid cache taxonomy identity');return[key,[...new Set(ids)].sort((a,b)=>a-b).join(',')];}
  if(typeof value!=='string'||!value)throw new Error('Invalid cache text identity');return[key,value];
 }));
}
export function reportCacheKey(keys:Record<string,unknown>) {return createHash('sha256').update(JSON.stringify(normalizedReportKeys(keys))).digest('hex');}
