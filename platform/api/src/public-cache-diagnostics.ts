/** Diagnostics only: never use these classifications to authorize caching. */
export const PUBLIC_CACHE_REASONS=['client-render-failed','ttl-null','upstream-policy-null','marker-mismatch','status','private-request','set-cookie'] as const;
export type PublicCacheReason=typeof PUBLIC_CACHE_REASONS[number];
export interface PublicCacheDecisionInput {
  shareable:boolean;
  clientRenderFailed:boolean;
  ttlAvailable:boolean;
  upstreamPolicyAvailable:boolean;
  markerMatches:boolean;
  statusOk:boolean;
  upstreamStale:boolean;
  privateRequest:boolean;
  varyWildcard:boolean;
  setCookie:boolean;
}
export interface PublicCacheDecision {shareable:boolean;reasons:PublicCacheReason[]}
/** Only fixed booleans cross this boundary. No headers/URL/error objects are
 * retained, copied into logs, or used as counter dimensions. Multiple reasons
 * may apply; their sum is deliberately not the private-response denominator. */
export function publicCacheDecision(input:PublicCacheDecisionInput):PublicCacheDecision{
  const reasons:PublicCacheReason[]=[];
  if(input.clientRenderFailed===true)reasons.push('client-render-failed');
  if(input.ttlAvailable!==true)reasons.push('ttl-null');
  if(input.upstreamPolicyAvailable!==true)reasons.push('upstream-policy-null');
  if(input.markerMatches!==true)reasons.push('marker-mismatch');
  if(input.statusOk!==true)reasons.push('status');
  if(input.privateRequest===true||input.varyWildcard===true)reasons.push('private-request');
  if(input.setCookie===true)reasons.push('set-cookie');
  return {shareable:input.shareable===true,reasons};
}
interface Counts {
  total:number;shareable:number;private:number;stale:number;staleShareable:number;unexplainedPrivate:number;decisionMismatch:number;
  reasons:Record<PublicCacheReason,number>;saturated:boolean;
}
export interface PublicCacheDiagnosticSnapshot {
  code:'PUBLIC_HTML_CACHE_DECISIONS';
  total:Counts;window:Counts;privateFraction:number|null;windowPrivateFraction:number|null;logFailures:number;
}
interface Options {
  emit?:(snapshot:PublicCacheDiagnosticSnapshot)=>void;
  now?:()=>number;
  intervalMs?:number;
  counterCeiling?:number;
}
const empty=():Counts=>({total:0,shareable:0,private:0,stale:0,staleShareable:0,unexplainedPrivate:0,decisionMismatch:0,reasons:Object.fromEntries(PUBLIC_CACHE_REASONS.map(reason=>[reason,0])) as Record<PublicCacheReason,number>,saturated:false});
const copy=(counts:Counts):Counts=>({...counts,reasons:{...counts.reasons}});
const fraction=(counts:Counts)=>counts.saturated||!counts.total?null:counts.private/counts.total;
/** One fixed-size accumulator per gateway instance. Logs at most once per
 * interval, on traffic only; no timers or queued records. Logger failures never
 * fail the response or cause immediate log retries. */
export function publicCacheDiagnostics(options:Options={}){
  const {emit,now=()=>performance.now(),intervalMs=60000,counterCeiling=2147483647}=options;
  if(!Number.isSafeInteger(intervalMs)||intervalMs<1000||intervalMs>3600000||!Number.isSafeInteger(counterCeiling)||counterCeiling<1||counterCeiling>2147483647)throw new Error('Invalid public cache diagnostic bounds');
  const total=empty();let window=empty(),nextLogAt:number|null=null,logFailures=0;
  function increment(counts:Counts,key:Exclude<keyof Counts,'reasons'|'saturated'>){
    if(counts[key]>=counterCeiling)counts.saturated=true;else counts[key]++;
  }
  function add(counts:Counts,decision:PublicCacheDecision,stale:boolean){
    increment(counts,'total');increment(counts,decision.shareable?'shareable':'private');
    // STALE is an upstream observation, not an independent denial. The actual
    // cache policy decides whether its age/directives permit sharing.
    if(stale){increment(counts,'stale');if(decision.shareable)increment(counts,'staleShareable');}
    if(!decision.shareable&&!decision.reasons.length)increment(counts,'unexplainedPrivate');
    if(decision.shareable&&decision.reasons.length)increment(counts,'decisionMismatch');
    for(const reason of decision.reasons){if(counts.reasons[reason]>=counterCeiling)counts.saturated=true;else counts.reasons[reason]++;}
  }
  const snapshot=():PublicCacheDiagnosticSnapshot=>({code:'PUBLIC_HTML_CACHE_DECISIONS',total:copy(total),window:copy(window),privateFraction:fraction(total),windowPrivateFraction:fraction(window),logFailures});
  return {
    snapshot,
    observe(input:PublicCacheDecisionInput):void{
      const decision=publicCacheDecision(input);add(total,decision,input.upstreamStale===true);add(window,decision,input.upstreamStale===true);
      if(!emit)return;
      const time=now();
      if(!Number.isFinite(time)||(nextLogAt!==null&&time<nextLogAt))return;
      nextLogAt=time+intervalMs;
      const record=snapshot();window=empty();
      try{emit(record);}catch{logFailures=Math.min(counterCeiling,logFailures+1);}
    },
  };
}
