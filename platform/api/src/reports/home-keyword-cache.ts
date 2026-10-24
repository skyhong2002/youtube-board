/** Optional shared copy of the last successful result, so a restarted process starts warm. */
export interface KeywordWindowStore<T> {
 read():Promise<{at:number;value:T}|null>;
 write(entry:{at:number;value:T}):Promise<void>;
 clear():Promise<void>;
}
/** Homepage keyword windows scan a week of evidence (several seconds on the production
 * host), while matching itself only advances every few minutes. A successful result is
 * served fresh for five minutes, then returned stale while a single refresh runs in the
 * background. After maxStaleMs without a successful refresh, callers wait for a new load;
 * if that load fails, the last success is still served until fallbackMs, so a slow or
 * failing source read does not empty the homepage. Past fallbackMs an outage shows as
 * unavailable rather than keeping an old ranking indefinitely. Failures are not cached.
 * The store (Redis in production) keeps the last success across restarts; a process reads
 * it once, before its first load. invalidate() drops the saved result everywhere and any
 * refresh started before it, so the next caller waits for a load that sees the change (an
 * administrator ranking decision). `at` is wall-clock milliseconds so it can be shared. */
export function keywordWindowCache<T>(cacheable:(value:T)=>boolean,{freshMs=300_000,maxStaleMs=1_800_000,fallbackMs=21_600_000,now=()=>Date.now(),store}:{freshMs?:number;maxStaleMs?:number;fallbackMs?:number;now?:()=>number;store?:KeywordWindowStore<T>}={}){
 let saved:{at:number;value:T}|null=null,pending:Promise<T>|null=null,generation=0,restored:Promise<void>|null=null;
 const restore=()=>restored??=(async()=>{
  if(!store)return;const started=generation;
  try{const entry=await store.read();if(entry&&started===generation&&!saved&&Number.isFinite(entry.at)&&entry.at<=now()&&cacheable(entry.value))saved=entry;}catch{/* A missing or failing store only means a cold start. */}
 })();
 const refresh=(load:()=>Promise<T>)=>{
  if(pending)return pending;
  const started=generation,promise:Promise<T>=load().then(value=>{if(started===generation&&cacheable(value)){saved={at:now(),value};store?.write(saved).catch(()=>{});}return value;}).finally(()=>{if(pending===promise)pending=null;});
  return pending=promise;
 };
 const cache=async(load:()=>Promise<T>):Promise<T>=>{
  await restore();
  const age=saved?now()-saved.at:Infinity;
  if(saved&&age<maxStaleMs){if(age>=freshMs)refresh(load).catch(()=>{});return structuredClone(saved.value);}
  const fallback=saved&&age<fallbackMs?saved:null;
  try{
   const value=await refresh(load);
   return structuredClone(fallback&&!cacheable(value)?fallback.value:value);
  }catch(error){if(fallback)return structuredClone(fallback.value);throw error;}
 };
 return Object.assign(cache,{invalidate(){generation++;saved=null;pending=null;store?.clear().catch(()=>{});}});
}
