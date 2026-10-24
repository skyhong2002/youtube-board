/** Optional shared copy of the last successful result, so a restarted process starts warm. */
export interface KeywordWindowStore<T> {
 read():Promise<{at:number;value:T}|null>;
 write(entry:{at:number;value:T}):Promise<void>;
 clear():Promise<void>;
}
/** Homepage keyword windows scan two weeks of evidence (about 40 s on the production host on
 * 2026-10-24, beyond any request deadline), while matching itself only advances every few
 * minutes. So no request waits for a refresh once a success exists: it is served fresh for ten
 * minutes, then returned stale while a single background refresh runs, for up to maxStaleMs
 * (six hours) without a successful refresh. Past that an outage shows as unavailable rather
 * than keeping an old ranking indefinitely, and callers wait for a load again. Failures are not
 * cached. The store (ts_home_keyword_snapshot in production) keeps the last success across restarts; a process
 * reads it once, before its first load. invalidate() (an administrator ranking decision) ignores
 * any refresh started before it and makes the next caller start one; until it lands, callers
 * keep the previous ranking, because waiting for it would outlast the request deadline. The
 * shared copy is dropped. `at` is wall-clock milliseconds so it can be shared. */
export function keywordWindowCache<T>(cacheable:(value:T)=>boolean,{freshMs=600_000,maxStaleMs=21_600_000,now=()=>Date.now(),store}:{freshMs?:number;maxStaleMs?:number;now?:()=>number;store?:KeywordWindowStore<T>}={}){
 let saved:{at:number;value:T}|null=null,pending:Promise<T>|null=null,generation=0,outdated=false,restored:Promise<void>|null=null;
 const restore=()=>restored??=(async()=>{
  if(!store)return;const started=generation;
  try{const entry=await store.read();if(entry&&started===generation&&!saved&&Number.isFinite(entry.at)&&entry.at<=now()&&cacheable(entry.value))saved=entry;}catch{/* A missing or failing store only means a cold start. */}
 })();
 const refresh=(load:()=>Promise<T>)=>{
  if(pending)return pending;
  const started=generation,promise:Promise<T>=load().then(value=>{if(started===generation&&cacheable(value)){saved={at:now(),value};outdated=false;store?.write(saved).catch(()=>{});}return value;}).finally(()=>{if(pending===promise)pending=null;});
  return pending=promise;
 };
 const cache=async(load:()=>Promise<T>):Promise<T>=>{
  await restore();
  const age=saved?now()-saved.at:Infinity;
  if(saved&&age<maxStaleMs){if(age>=freshMs||outdated)refresh(load).catch(()=>{});return structuredClone(saved.value);}
  return structuredClone(await refresh(load));
 };
 return Object.assign(cache,{invalidate(){generation++;outdated=true;pending=null;store?.clear().catch(()=>{});}});
}
