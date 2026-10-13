/** Client-side reader for the optional Y2 keyword relations (tag.observe.tw relation rows).
 *
 * Browser-only enhancement: the keyword profile's videos, evidence, coverage, filters and
 * pagination stay server-rendered; nothing here is imported by a server read or an ISR page
 * read. The only request is the same-origin public gateway endpoint
 * `/api/v1/keywords/{encodeURIComponent(keyword)}/relations`; tag.observe.tw is never fetched
 * from the browser. Requests omit credentials, bypass the HTTP cache, refuse redirects, carry
 * only an Accept header (no auth, service, cookie or forwarding headers) and are bounded in time and size. Results live
 * only in the calling component's state: no shared cache, storage, telemetry or logging.
 * Only recognised DTO fields are copied; unknown fields are dropped. */

export const TAG_RELATIONS_SOURCE='https://tag.observe.tw';
export const RELATIONS_TIMEOUT_MS=8000;
export const RELATIONS_MAX_BYTES=262144;
export const RELATIONS_MAX_ROWS=512;

export type RelationType='is-a'|'related'|'alias';
export const RELATION_TYPES:readonly RelationType[]=['is-a','related','alias'];
export interface KeywordRelation {
 id:string;
 type:RelationType;
 target:{id:string;label:string;kind:'tag'|'group'};
 /** Validated absolute https://tag.observe.tw link, or null when the supplied href failed validation. */
 href:string|null;
 source:string;
 sourceDetail:string;
 createdAt:string|null;
 status:'approved';
 inherited:boolean;
 depth:number;
}
export type UnavailableReason='invalid-keyword'|'rate-limited'|'not-found'|'http'|'timeout'|'invalid-response'|'too-large'|'network'|'upstream';
export type RelationsResult=
 |{kind:'disabled'}
 |{kind:'available';sourceUrl:string;tagId:string|null;truncated:boolean;relations:KeywordRelation[]}
 |{kind:'unavailable';reason:UnavailableReason;retryAfterSeconds:number|null;retryable:boolean};
/** idle: server markup / before the browser starts the request. loading: a request is actually pending. */
export type RelationsView={kind:'idle'}|{kind:'loading'}|RelationsResult;

const CONTROL=/[\p{Cc}\p{Cs}]/u;
/** Same rule as the API: 1–60 Unicode characters, no surrounding whitespace, no controls or lone surrogates. */
export function isSupportedKeyword(keyword:unknown):keyword is string {
 return typeof keyword==='string'&&keyword.length>0&&[...keyword].length<=60&&keyword===keyword.trim()&&!CONTROL.test(keyword);
}
/** Exact keyword encoded once: '/' becomes %2F and a literal '%' becomes %25. */
export function relationsPath(keyword:string){return '/api/v1/keywords/'+encodeURIComponent(keyword)+'/relations';}
export function expectedSourceUrl(keyword:string){return TAG_RELATIONS_SOURCE+'/tag/'+encodeURIComponent(keyword)+'/';}

const text=(value:unknown,max:number):value is string=>typeof value==='string'&&value.length>0&&[...value].length<=max&&value===value.trim()&&!CONTROL.test(value);
const GROUP_ID=/^group:([1-9]\d{0,14})$/;

/** Only https://tag.observe.tw/tag/{encodeURIComponent(label)}/ or /group/{numeric id}/, matched
 * exactly against the target's own id/label, so userinfo, query, fragment, other hosts,
 * protocol-relative, javascript: or double-encoded paths can never pass. Group IDs and tag IDs
 * stay separate: a group link needs a `group:N` id, a tag link never comes from a group id. */
export function safeTargetHref(target:{id:unknown;label:unknown;href:unknown}):string|null {
 if(typeof target.href!=='string'||!text(target.id,256)||!text(target.label,256))return null;
 const group=GROUP_ID.exec(target.id);
 const path=group?`/group/${group[1]}/`:target.id.startsWith('group:')?null:`/tag/${encodeURIComponent(target.label)}/`;
 if(!path)return null;
 return target.href===path||target.href===TAG_RELATIONS_SOURCE+path?TAG_RELATIONS_SOURCE+path:null;
}

const isObject=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const CREATED_AT=/^\d{4}-\d\d-\d\dT[^\s]*(?:Z|[+-]\d\d:\d\d)$/;
function relation(value:unknown):KeywordRelation|null {
 if(!isObject(value)||!isObject(value.target))return null;
 const r=value,t=value.target;
 if(!text(r.id,256)||typeof r.type!=='string'||!(RELATION_TYPES as readonly string[]).includes(r.type)||!text(t.id,256)||!text(t.label,256)||!text(r.source,128)||!text(r.sourceDetail,256))return null;
 if(r.status!=='approved'||typeof r.inherited!=='boolean'||typeof r.depth!=='number'||!Number.isSafeInteger(r.depth)||r.depth<1||r.depth>256)return null;
 if(r.createdAt!==null&&(typeof r.createdAt!=='string'||r.createdAt.length>40||!CREATED_AT.test(r.createdAt)||!Number.isFinite(Date.parse(r.createdAt))))return null;
 // Copy recognised fields only; original IDs, labels and provenance text are kept verbatim.
 return {id:r.id,type:r.type as RelationType,target:{id:t.id,label:t.label,kind:GROUP_ID.test(t.id)?'group':'tag'},href:safeTargetHref({id:t.id,label:t.label,href:t.href}),source:r.source,sourceDetail:r.sourceDetail,createdAt:r.createdAt,status:'approved',inherited:r.inherited,depth:r.depth};
}
const unavailable=(reason:UnavailableReason,retryAfterSeconds:number|null=null,retryable=true):RelationsResult=>({kind:'unavailable',reason,retryAfterSeconds,retryable});
/** Finite non-negative DTO hold, kept in full (rounded up to whole seconds, never capped). */
const safeSeconds=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>=0?Math.ceil(value):null;

/** Validates a `{data,meta}` envelope for exactly this keyword. Anything that does not match the
 * contract is unavailable, never disabled and never an empty relation list. */
export function parseRelationsPayload(body:unknown,keyword:string):RelationsResult {
 if(!isObject(body)||!isObject(body.data)||!isObject(body.meta)||body.meta.schemaVersion!==1)return unavailable('invalid-response');
 const d=body.data;
 if(d.keyword!==keyword||d.source!==TAG_RELATIONS_SOURCE||d.sourceUrl!==expectedSourceUrl(keyword))return unavailable('invalid-response');
 if(d.status==='disabled')return {kind:'disabled'};
 if(d.status==='unavailable'){
  const seconds=d.retryAfterSeconds===null||d.retryAfterSeconds===undefined?null:safeSeconds(d.retryAfterSeconds);
  return unavailable(d.reason==='rate-limited'?'rate-limited':d.reason==='timeout'?'timeout':'upstream',seconds);
 }
 if(d.status!=='available'||typeof d.truncated!=='boolean'||!Array.isArray(d.relations)||d.relations.length>RELATIONS_MAX_ROWS)return unavailable('invalid-response');
 if(d.tagId!==null&&!text(d.tagId,256))return unavailable('invalid-response');
 const relations:KeywordRelation[]=[];
 for(const row of d.relations){const parsed=relation(row);if(!parsed)return unavailable('invalid-response');relations.push(parsed);}
 return {kind:'available',sourceUrl:expectedSourceUrl(keyword),tagId:d.tagId as string|null,truncated:d.truncated,relations};
}

const IMF_FIXDATE=/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/;
/** Retry-After as delta seconds or a canonical IMF-fixdate, kept in full and never capped; malformed
 * values (other date formats, rollover dates, invalid times, wrong weekdays) fall back to 60 seconds.
 * The value is only a hold for manual retries, never an automatic retry. */
export function retryAfterSeconds(value:string|null,now:number):number|null {
 if(value===null)return null;
 const v=value.trim();
 if(/^\d+$/.test(v)){
  // Exact up to 2^53-1. Beyond that the decimal may round down to the nearest double, so step up
  // at least one ulp; too many digits give Infinity, an unbounded hold and never a short fallback.
  const n=Number(v);
  return Math.max(1,Number.isSafeInteger(n)?n:n*(1+Number.EPSILON));
 }
 const at=IMF_FIXDATE.test(v)?Date.parse(v):NaN;
 // A canonical round trip also rejects rollover dates, invalid times and wrong weekdays.
 if(Number.isFinite(at)&&new Date(at).toUTCString()===v)return Math.max(1,Math.ceil((at-now)/1000));
 return 60;
}

export interface FetchRelationsOptions {
 /** Injected for offline tests; defaults to the browser fetch. */
 fetch?:typeof fetch;
 signal?:AbortSignal;
 timeoutMs?:number;
 maxBytes?:number;
 now?:()=>number;
}
/** One bounded read. Returns null only when the caller's signal aborted (unmount or keyword
 * change), so a stale response can never be applied. No retries happen here. */
export async function fetchKeywordRelations(keyword:string,options:FetchRelationsOptions={}):Promise<RelationsResult|null> {
 if(!isSupportedKeyword(keyword))return unavailable('invalid-keyword',null,false);
 const transport=options.fetch??globalThis.fetch,now=options.now??Date.now;
 const timeoutMs=Math.min(RELATIONS_TIMEOUT_MS,Math.max(100,options.timeoutMs??RELATIONS_TIMEOUT_MS)),maxBytes=Math.min(RELATIONS_MAX_BYTES,Math.max(256,options.maxBytes??RELATIONS_MAX_BYTES));
 if(options.signal?.aborted)return null;
 const controller=new AbortController();let timedOut=false;
 const forward=()=>controller.abort();options.signal?.addEventListener('abort',forward,{once:true});
 const timer=setTimeout(()=>{timedOut=true;controller.abort();},timeoutMs);
 let reader:ReadableStreamDefaultReader<Uint8Array>|undefined,response:Response|undefined;
 try{
  response=await transport(relationsPath(keyword),{method:'GET',headers:{accept:'application/json'},credentials:'omit',cache:'no-store',redirect:'error',mode:'same-origin',referrerPolicy:'no-referrer',signal:controller.signal});
  if(response.redirected||response.type==='opaqueredirect')return unavailable('invalid-response');
  if(response.status===429)return unavailable('rate-limited',retryAfterSeconds(response.headers.get('retry-after'),now())??60);
  if(response.status===404)return unavailable('not-found');
  if(response.status!==200)return unavailable('http',response.status===503?retryAfterSeconds(response.headers.get('retry-after'),now()):null);
  if(!/^application\/(?:json|[a-z0-9.+-]+\+json)\s*(?:;|$)/i.test(response.headers.get('content-type')??''))return unavailable('invalid-response');
  const length=response.headers.get('content-length');
  if(length!==null&&(!/^\d+$/.test(length)||Number(length)>maxBytes))return unavailable('too-large');
  if(!response.body)return unavailable('invalid-response');
  reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
  while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>maxBytes)return unavailable('too-large');chunks.push(chunk.value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  let value:unknown;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{return unavailable('invalid-response');}
  if(options.signal?.aborted)return null;
  return parseRelationsPayload(value,keyword);
 }catch{
  // Never surface the error object, message or body.
  if(options.signal?.aborted)return null;
  return unavailable(timedOut?'timeout':'network');
 }finally{
  clearTimeout(timer);options.signal?.removeEventListener('abort',forward);
  if(reader)void reader.cancel().catch(()=>{});else if(response?.body&&!response.bodyUsed)void response.body.cancel().catch(()=>{});
  controller.abort();
 }
}

/** Manual retry policy: at most MAX_MANUAL_RETRIES per keyword, never inside a known
 * Retry-After hold and never sooner than MIN_RETRY_GAP_MS after the last failure. No timers. */
export const MAX_MANUAL_RETRIES=3;
export const MIN_RETRY_GAP_MS=5000;
export interface RetryState {retries:number;failedAt:number|null;holdUntil:number|null}
export const INITIAL_RETRY_STATE:RetryState={retries:0,failedAt:null,holdUntil:null};
export function recordFailure(state:RetryState,result:RelationsResult,now:number):RetryState {
 if(result.kind!=='unavailable')return state;
 const end=result.retryAfterSeconds===null?null:now+result.retryAfterSeconds*1000;
 // Integer sums up to 2^53-1 ms are exact. Past that (or NaN) rounding could land before the true
 // instant, so hold for the rest of this page instead; a later shorter hold never shrinks it.
 const hold=end===null?null:end<=Number.MAX_SAFE_INTEGER?end:Infinity;
 return {retries:state.retries,failedAt:now,holdUntil:hold===null?state.holdUntil:Math.max(hold,state.holdUntil??0)};
}
export type RetryDecision={allowed:true}|{allowed:false;reason:'not-retryable'|'exhausted'|'hold';waitSeconds:number|null};
export function retryDecision(state:RetryState,result:RelationsView,now:number):RetryDecision {
 if(result.kind!=='unavailable'||!result.retryable)return {allowed:false,reason:'not-retryable',waitSeconds:null};
 if(state.retries>=MAX_MANUAL_RETRIES)return {allowed:false,reason:'exhausted',waitSeconds:null};
 const until=Math.max(state.holdUntil??0,(state.failedAt??-Infinity)+MIN_RETRY_GAP_MS);
 if(now<until)return {allowed:false,reason:'hold',waitSeconds:Math.ceil((until-now)/1000)};
 return {allowed:true};
}
/** Human wait text without implying an exact upstream schedule; from a minute up it also states
 * the full whole seconds. Values beyond exact integer range are stated as such, never shortened. */
export function waitText(seconds:number){
 const s=Math.ceil(seconds);
 if(!(s<=Number.MAX_SAFE_INTEGER))return `超過 ${Number.MAX_SAFE_INTEGER} 秒（遠超過可預期的時間）`;
 if(s<60)return `約 ${s} 秒`;
 const human=s<3600?`${Math.ceil(s/60)} 分鐘`:s<86400?`${Math.ceil(s/3600)} 小時`:s<31536000?`${Math.ceil(s/86400)} 天`:`${Math.ceil(s/31536000)} 年`;
 return `約 ${human}（${s} 秒）`;
}
