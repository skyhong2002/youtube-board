import {DataSourceUnavailable} from '../db/client.js';
import type {Query} from './query.js';
import {BadQuery,idList} from './query.js';

const QUERY_KEYS=['keyword','limit','offset','q','channelId','channelIds','from','to','hours','min','column','days','tagid','or','not','cursor'] as const;
const ID_SETS=new Set(['channelIds','tagid','or','not']);
/** Only public report inputs. Exact term/cursor/string types are preserved;
 * set-valued ID filters normalize order, never arbitrary repeated query arrays. */
export function keywordVideoCacheKey(query:Query,scope?:'taxonomy'):string{
  const values:unknown[]=[scope??'general'];
  for(const key of QUERY_KEYS){
    const value=query[key];
    if(value===undefined){values.push([key,'absent']);continue;}
    if(ID_SETS.has(key)){values.push([key,idList(value).sort((a,b)=>a-b)]);continue;}
    if(typeof value==='number'&&!Number.isFinite(value))throw new BadQuery('Invalid keyword query value.');
    if(typeof value==='string'&&value.length>8192)throw new BadQuery('Keyword query exceeds cache key budget.');
    if(typeof value==='string'||typeof value==='number'||typeof value==='boolean'||value===null){values.push([key,typeof value,value]);continue;}
    // Query parsers may return repeated-value arrays. Preserve their order/type,
    // and let the report validator reject them rather than hit a scalar entry.
    if(Array.isArray(value)&&value.length<=32&&value.every(v=>typeof v==='string'&&v.length<=8192)){values.push([key,'array',value]);continue;}
    throw new BadQuery('Invalid keyword query value.');
  }
  const key=JSON.stringify(values);
  if(Buffer.byteLength(key)>8192)throw new BadQuery('Keyword query exceeds cache key budget.');
  return key;
}
interface Options<T>{ttlMs?:number;maxKeys?:number;maxPending?:number;maxBytes?:number;maxResultBytes?:number;now?:()=>number;cacheable?:(value:T,query:Query)=>boolean}
type Entry<T>={kind:'pending';promise:Promise<{json:string}|{value:T}>}|{kind:'ready';json:string;expires:number;bytes:number};
/** Per report instance, public successful results only. No timers, global state,
 * or pending eviction: overload fails closed instead of starting more SQL. */
export function keywordVideoCache<T>(options:Options<T>={}){
  const {ttlMs=15000,maxKeys=32,maxPending=4,maxBytes=8*1024*1024,maxResultBytes=2*1024*1024,now=()=>performance.now(),cacheable=()=>true}=options;
  if(![ttlMs,maxKeys,maxPending,maxBytes,maxResultBytes].every(v=>Number.isSafeInteger(v)&&v>0)||maxPending>maxKeys)throw new Error('Invalid keyword cache bounds');
  const entries=new Map<string,Entry<T>>();let bytes=0,pending=0;
  const remove=(key:string,entry:Entry<T>)=>{if(entry.kind==='ready')bytes-=entry.bytes;entries.delete(key);};
  function evict(){for(const [key,entry] of entries)if(entry.kind==='ready'){remove(key,entry);return true;}return false;}
  return async (query:Query,scope:'taxonomy'|undefined,load:()=>Promise<T>):Promise<T>=>{
    const key=keywordVideoCacheKey(query,scope),time=now();
    for(const [id,entry] of entries)if(entry.kind==='ready'&&entry.expires<=time)remove(id,entry);
    const found=entries.get(key);
    if(found?.kind==='ready'){entries.delete(key);entries.set(key,found);return JSON.parse(found.json) as T;}
    if(found?.kind==='pending'){const result=await found.promise;return 'json'in result?JSON.parse(result.json) as T:result.value;}
    if(pending>=maxPending)throw new DataSourceUnavailable();
    while(entries.size>=maxKeys)if(!evict())throw new DataSourceUnavailable();
    pending++;
    const entry:Entry<T>={kind:'pending',promise:Promise.resolve().then(async()=>{
      try{
        const value=await load(),json=cacheable(value,query)?boundedJson(value,maxResultBytes):null;
        entries.delete(key);
        if(json!==null){
          // Account UTF-16 retained strings, UTF-8 wire bytes and entry/key
          // overhead conservatively; no second result object is retained.
          const cost=Math.max(Buffer.byteLength(json),json.length*2)+key.length*2+256;
          if(cost<=maxBytes){
            while(bytes+cost>maxBytes)if(!evict())break;
            if(bytes+cost<=maxBytes){entries.set(key,{kind:'ready',json,expires:now()+ttlMs,bytes:cost});bytes+=cost;}
          }
          return {json};
        }
        return {value};
      }catch(error){entries.delete(key);throw error;}finally{pending--;}
    })};
    entries.set(key,entry);
    const result=await entry.promise;
    return 'json'in result?JSON.parse(result.json) as T:result.value;
  };
}
/** Avoid constructing an unbounded second JSON copy of an oversized DTO. */
function boundedJson(value:unknown,maxBytes:number):string|null{
  let estimate=0;const stack:Array<{value?:unknown;leave?:object}>=[{value}],ancestors=new Set<object>();
  while(stack.length){
    const entry=stack.pop()!;if(entry.leave){ancestors.delete(entry.leave);continue;}
    const current=entry.value;
    if(current===null)estimate+=4;
    else if(typeof current==='string')estimate+=Buffer.byteLength(current)+2;
    else if(typeof current==='number')estimate+=32;
    else if(typeof current==='boolean')estimate+=5;
    else if(typeof current==='object'){
      if(ancestors.has(current))return null;ancestors.add(current);stack.push({leave:current});estimate+=2;
      const keys=Object.keys(current);estimate+=keys.length;
      if(keys.length>maxBytes/2)return null;
      for(const key of keys){if(!Array.isArray(current))estimate+=Buffer.byteLength(key)+3;stack.push({value:(current as Record<string,unknown>)[key]});}
    }else if(current!==undefined)return null;
    if(estimate>maxBytes||stack.length>maxBytes/2)return null;
  }
  try{const json=JSON.stringify(value);return json!==undefined&&Buffer.byteLength(json)<=maxBytes?json:null;}catch{return null;}
}
