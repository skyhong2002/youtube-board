import { createHash } from 'node:crypto';
/** Identical writer/reader identity even if object property insertion order differs. */
export function canonicalValue(value:unknown):unknown {
 if(Array.isArray(value))return value.map(canonicalValue);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>[k,canonicalValue(v)]));
 return value;
}
export const canonicalHash=(value:unknown)=>createHash('sha256').update(JSON.stringify(canonicalValue(value))).digest('hex');
export const aiBusinessKey=(table:string,key:Record<string,unknown>)=>canonicalHash({table,key});
/** Byte-compatible with Laravel AiBusinessKeyLock::name (PHP JSON_UNESCAPED_SLASHES).
 * Identity shape must match that workflow's Laravel acquire() call, not its journal key.
 */
export function laravelAiLock(table:string,identity:Record<string,unknown>):string {
 const normalized=Object.fromEntries(Object.entries(identity).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>[k,typeof v==='string'?v.replace(/ +$/,'').toLowerCase():v]));
 const json=JSON.stringify([table.trim().toLowerCase(),normalized]).replace(/[\u0080-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
 return 'ytb:ai:'+createHash('sha256').update(json).digest('hex').slice(0,56);
}
