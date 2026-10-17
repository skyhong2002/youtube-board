/** Homepage keyword windows scan a week of evidence (several seconds on the production
 * host), while matching itself only advances every few minutes. A successful result is
 * served fresh for five minutes, then returned stale while a single refresh runs in the
 * background. After maxStaleMs without a successful refresh, callers wait for a new load
 * again, so an outage cannot keep an old ranking indefinitely. Failures are not cached.
 * invalidate() drops the saved result and any refresh started before it, so the next
 * caller waits for a load that sees the change (an administrator ranking decision). */
export function keywordWindowCache<T>(cacheable:(value:T)=>boolean,{freshMs=300_000,maxStaleMs=1_800_000,now=()=>Date.now()}:{freshMs?:number;maxStaleMs?:number;now?:()=>number}={}){
 let saved:{at:number;value:T}|null=null,pending:Promise<T>|null=null,generation=0;
 const refresh=(load:()=>Promise<T>)=>{
  if(pending)return pending;
  const started=generation,promise:Promise<T>=load().then(value=>{if(started===generation&&cacheable(value))saved={at:now(),value};return value;}).finally(()=>{if(pending===promise)pending=null;});
  return pending=promise;
 };
 const cache=async(load:()=>Promise<T>):Promise<T>=>{
  const age=saved?now()-saved.at:Infinity;
  if(saved&&age<maxStaleMs){if(age>=freshMs)refresh(load).catch(()=>{});return structuredClone(saved.value);}
  return structuredClone(await refresh(load));
 };
 return Object.assign(cache,{invalidate(){generation++;saved=null;pending=null;}});
}
