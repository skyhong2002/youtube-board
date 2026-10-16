import {createHash} from 'node:crypto';
import {timestamp} from './normalize.js';
/** Offline F1 contract provenance; this candidate has not been deployed.
 * tag-f1-release b8d030c (exact SHA recorded below), app/src/v1/openapi.ts:1816.
 * API schema SHA256 recorded below. Extra response fields are deliberately ignored.
 */
export type TagRelation={id:string;type:'is-a'|'related'|'alias';target:{id:string;label:string;href:string};source:string;sourceDetail:string;createdAt:string|null;status:'approved';inherited:boolean;depth:number};
export type TagRelations={tag:string;tagId:string;truncated:boolean;relations:TagRelation[]};
export type RelationFallbackReason='disabled'|'rate-limited'|'upstream-unavailable'|'invalid-contract'|'response-cap'|'timeout'|'upstream-busy';
export type TagRelationsResult<T>={status:'available';source:'https://tag.observe.tw';data:TagRelations;fallback:null;reason:null;retryAfterSeconds:null}|{status:'fallback';source:'https://tag.observe.tw';data:null;fallback:T;reason:RelationFallbackReason;retryAfterSeconds:number|null};
export const F1_RELATIONS_PUBLICATION={appSHA:'aff5c028',buildId:'d1LVsC3sk6p04uOyWUx5T',switchedAt:'2026-10-14T13:46:00Z',verifiedAt:'2026-10-14T13:59:35Z',receipt:'/tmp/babysit/mint-queue/youtube-live-f1-contract-20261014T135936Z.json',receiptSHA256:'e931ebf95486fe505a1ac0ef0422b9f0494bcb06f8ed02e9fa68a9d680c20875'} as const;
export const F1_RELATIONS_CONTRACT={source:'https://tag.observe.tw',candidateSHA:'b8d030c747f87c997800371e33e1ab2d168ad257',openapiPath:'app/src/v1/openapi.ts',openapiSHA256:'8d020d20cc23e62ef0170144a363c1fe0c68ef5da42ad5610fa8a9f6713849a1',endpoint:'/api/v1/tags/{tag}/relations',deployed:false} as const;
const digest=(tag:string)=>createHash('sha256').update(tag,'utf8').digest('hex');
function label(value:unknown,max=60):value is string{return typeof value==='string'&&value.length>0&&[...value].length<=max&&value===value.trim()&&!/[\p{Cc}\p{Cs}]/u.test(value);}
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new ContractFailure();return value as Record<string,unknown>;}
class ContractFailure extends Error{}
class ResponseCap extends Error{}
function parse(value:unknown,tag:string,maxRows:number):TagRelations {
 const row=object(value);if(row.tag!==tag||row.tagId!==digest(tag)||typeof row.truncated!=='boolean'||!Array.isArray(row.relations))throw new ContractFailure();
 if(row.relations.length>maxRows)throw new ResponseCap();
 const relations=row.relations.map(value=>{
  const r=object(value),t=object(r.target);
  if(!label(r.id,256)||(typeof r.type!=='string'||!['is-a','related','alias'].includes(r.type))||!label(t.id,256)||!label(t.label,256)||!label(r.source,128)||!label(r.sourceDetail,256)||r.status!=='approved'||typeof r.inherited!=='boolean'||!Number.isSafeInteger(r.depth)||Number(r.depth)<1||Number(r.depth)>256)throw new ContractFailure();
  if(r.createdAt!==null&&(typeof r.createdAt!=='string'||r.createdAt.length>40||!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(r.createdAt)||!Number.isFinite(Date.parse(r.createdAt))))throw new ContractFailure();
  const group=/^group:([1-9]\d{0,14})$/.exec(t.id);
  const expected=group?`/group/${group[1]}/`:`/tag/${encodeURIComponent(t.label)}/`;
  if(t.href!==expected||(!group&&(t.id!==digest(t.label)||!label(t.label))))throw new ContractFailure();
  // Preserve upstream semantics and IDs; never emit person sameAs or merge aliases.
  return {id:r.id,type:r.type,target:{id:t.id,label:t.label,href:t.href},source:r.source,sourceDetail:r.sourceDetail,createdAt:timestamp(r.createdAt),status:'approved',inherited:r.inherited,depth:r.depth} as TagRelation;
 });
 return {tag,tagId:digest(tag),truncated:row.truncated,relations};
}
function retryAfter(value:string|null,at:number):number {
 const maximumSeconds=Math.ceil((8640000000000000-at)/1000);
 const numeric=value!==null&&/^\d+$/.test(value);
 const imf=value!==null&&/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value);
 const parsed=imf?Date.parse(value):NaN;
 // A canonical round trip also rejects rollover dates, invalid times and wrong weekdays.
 const validDate=Number.isFinite(parsed)&&new Date(parsed).toUTCString()===value;
 const seconds=numeric?Number(value):validDate?(parsed-at)/1000:60;
 // Never shorten a valid upstream hold. Overflowing numeric holds stop this
 // client until the maximum representable Date (or process restart).
 if(numeric&&(!Number.isFinite(seconds)||seconds>maximumSeconds))return maximumSeconds;
 return Number.isFinite(seconds)?Math.max(1,Math.ceil(seconds)):60;
}
export interface TagRelationsClientOptions<T>{
 /** Explicit opt-in after F1 publication verification. No request when disabled. */
 enabled?:boolean;
 fetch?:typeof fetch;
 clock?:()=>Date;
 serviceToken?:string;
 fallback:(tag:string)=>Promise<T>;
 timeoutMs?:number;
 maxBodyBytes?:number;
 maxRows?:number;
}
export function createTagRelationsClient<T>(options:TagRelationsClientOptions<T>):(tag:string)=>Promise<TagRelationsResult<T>> {
 const transport=options.fetch??fetch,clock=options.clock??(()=>new Date()),timeoutMs=options.timeoutMs??2000,maxBodyBytes=options.maxBodyBytes??131072,maxRows=options.maxRows??512;
 for(const [value,min,max] of [[timeoutMs,10,5000],[maxBodyBytes,256,262144],[maxRows,1,512]] as const)if(!Number.isSafeInteger(value)||value<min||value>max)throw new Error('Invalid relations client bound');
 if(options.serviceToken!==undefined&&(!options.serviceToken||options.serviceToken.length>4096||/[\r\n\x00-\x1f\x7f]/.test(options.serviceToken)))throw new Error('Invalid relations service token');
 let cooldownUntil=0,activeUpstream=0;
 const inFlight=new Map<string,Promise<TagRelationsResult<T>>>(),cache=new Map<string,{data:TagRelations;until:number}>();
 const run=async(tag:string):Promise<TagRelationsResult<T>>=>{
  if(!label(tag))throw new Error('Invalid relations tag');
  const fallback=async(reason:RelationFallbackReason,retryAfterSeconds:number|null=null):Promise<TagRelationsResult<T>>=>({status:'fallback',source:'https://tag.observe.tw',data:null,fallback:await options.fallback(tag),reason,retryAfterSeconds});
  if(!options.enabled)return fallback('disabled');
  const at=clock().getTime();if(at<cooldownUntil)return fallback('rate-limited',Math.ceil((cooldownUntil-at)/1000));
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined,timedOut=false;const stream={reader:undefined as ReadableStreamDefaultReader<Uint8Array>|undefined,body:null as ReadableStream<Uint8Array>|null};
  try{
   const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{timedOut=true;controller.abort();reject(new Error('Relations deadline'));},timeoutMs);});
   const work=async()=>{
    activeUpstream++;try{
    const headers:Record<string,string>={accept:'application/json',DNT:'1','Sec-GPC':'1'};if(options.serviceToken)headers['X-Service-Token']=options.serviceToken;
    // Fixed origin, manual redirects, no user cookies/auth, no cached credentialed responses.
    const response=await transport('https://tag.observe.tw/api/v1/tags/'+encodeURIComponent(tag)+'/relations',{headers,redirect:'manual',credentials:'omit',cache:'no-store',signal:controller.signal});
    stream.body=response.body;if(controller.signal.aborted){void stream.body?.cancel().catch(()=>{});throw new Error('Relations deadline');}
    if(response.status===429){const wait=retryAfter(response.headers.get('retry-after'),clock().getTime());cooldownUntil=Math.max(cooldownUntil,Math.min(8640000000000000,clock().getTime()+wait*1000));void response.body?.cancel().catch(()=>{});return {rateLimited:wait} as const;}
    if(response.status!==200){void response.body?.cancel().catch(()=>{});throw new Error('Relations upstream unavailable');}
    if(!/^application\/(?:json|[a-z0-9.+-]+\+json)(?:\s*;|$)/i.test(response.headers.get('content-type')??''))throw new ContractFailure();
    const length=response.headers.get('content-length');if(length&&(/^\d+$/.test(length)?Number(length)>maxBodyBytes:true))throw new ResponseCap();
    if(!response.body)throw new ContractFailure();stream.reader=response.body.getReader();let size=0;const chunks:Uint8Array[]=[];
    while(true){const chunk=await stream.reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>maxBodyBytes)throw new ResponseCap();chunks.push(chunk.value);}
    const data=Buffer.concat(chunks,size);let value:unknown;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data));}catch{throw new ContractFailure();}
    const control=response.headers.get('cache-control')??'',maxAge=/(?:^|,)\s*max-age=(\d+)/i.exec(control);
    const cacheSeconds=!options.serviceToken&&/(?:^|,)\s*public(?:,|$)/i.test(control)&&!/(?:private|no-store|no-cache)/i.test(control)&&maxAge?Math.min(60,Number(maxAge[1])):0;
    return {data:parse(value,tag,maxRows),cacheSeconds} as const;
    }finally{activeUpstream--;}
   };
   const result=await Promise.race([work(),timeout]);if('rateLimited' in result)return fallback('rate-limited',result.rateLimited);
   if(result.cacheSeconds>0){if(cache.size>=32)cache.delete(cache.keys().next().value!);cache.set(tag,{data:structuredClone(result.data),until:clock().getTime()+result.cacheSeconds*1000});}
   return {status:'available',source:'https://tag.observe.tw',data:result.data,fallback:null,reason:null,retryAfterSeconds:null};
  }catch(error){return fallback(timedOut?'timeout':error instanceof ResponseCap?'response-cap':error instanceof ContractFailure?'invalid-contract':'upstream-unavailable');}
  finally{if(timer)clearTimeout(timer);controller.abort();if(stream.reader)void stream.reader.cancel().catch(()=>{});else void stream.body?.cancel().catch(()=>{});}
 };
 return async tag=>{
  if(!label(tag))throw new Error('Invalid relations tag');
  if(!options.enabled)return run(tag);
  const stored=cache.get(tag);if(stored&&stored.until>clock().getTime())return {status:'available',source:'https://tag.observe.tw',data:structuredClone(stored.data),fallback:null,reason:null,retryAfterSeconds:null};
  if(stored)cache.delete(tag);
  const cooldownAt=clock().getTime();
  if(cooldownAt<cooldownUntil)return {status:'fallback',source:'https://tag.observe.tw',data:null,fallback:await options.fallback(tag),reason:'rate-limited',retryAfterSeconds:Math.ceil((cooldownUntil-cooldownAt)/1000)};
  const pending=inFlight.get(tag);if(pending)return pending;
  // Two upstream tasks maximum, no growing wait queue; cache has at most 32 keys.
  if(inFlight.size>=2||activeUpstream>=2)return {status:'fallback',source:'https://tag.observe.tw',data:null,fallback:await options.fallback(tag),reason:'upstream-busy',retryAfterSeconds:null};
  const task=run(tag);inFlight.set(tag,task);try{return await task;}finally{inFlight.delete(tag);}
 };
}
