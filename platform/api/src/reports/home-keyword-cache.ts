/** Homepage keyword windows scan a week of evidence (several seconds on the production
 * host), while matching itself only advances every few minutes. A successful result is
 * served fresh for five minutes, then returned stale while a single refresh runs in the
 * background. After maxStaleMs without a successful refresh, callers wait for a new load
 * again, so an outage cannot keep an old ranking indefinitely. Failures are not cached. */
export function keywordWindowCache<T>(cacheable:(value:T)=>boolean,{freshMs=300_000,maxStaleMs=1_800_000,now=()=>Date.now()}:{freshMs?:number;maxStaleMs?:number;now?:()=>number}={}){
 let saved:{at:number;value:T}|null=null,pending:Promise<T>|null=null;
 const refresh=(load:()=>Promise<T>)=>pending??=load().then(value=>{if(cacheable(value))saved={at:now(),value};return value;}).finally(()=>{pending=null;});
 return async(load:()=>Promise<T>):Promise<T>=>{
  const age=saved?now()-saved.at:Infinity;
  if(saved&&age<maxStaleMs){if(age>=freshMs)refresh(load).catch(()=>{});return structuredClone(saved.value);}
  return structuredClone(await refresh(load));
 };
}
