import {it,expect} from 'vitest';
import {PUBLIC_CACHE_REASONS,publicCacheDecision,publicCacheDiagnostics,type PublicCacheDecisionInput,type PublicCacheDiagnosticSnapshot} from '../src/public-cache-diagnostics.js';
const healthy:PublicCacheDecisionInput={shareable:true,clientRenderFailed:false,ttlAvailable:true,upstreamPolicyAvailable:true,markerMatches:true,statusOk:true,upstreamStale:false,privateRequest:false,varyWildcard:false,setCookie:false};
it('classifies each existing deny gate with fixed reasons, including wildcard Vary',()=>{
  expect(publicCacheDecision(healthy)).toEqual({shareable:true,reasons:[]});
  const cases:[Partial<PublicCacheDecisionInput>,string][]=[
    [{clientRenderFailed:true},'client-render-failed'],[{ttlAvailable:false},'ttl-null'],[{upstreamPolicyAvailable:false},'upstream-policy-null'],[{markerMatches:false},'marker-mismatch'],[{statusOk:false},'status'],[{privateRequest:true},'private-request'],[{varyWildcard:true},'private-request'],[{setCookie:true},'set-cookie'],
  ];
  for(const [flags,reason] of cases)expect(publicCacheDecision({...healthy,...flags,shareable:false})).toEqual({shareable:false,reasons:[reason]});
});
it('counts response ratio independently of overlapping reasons and exposes unexplained/mismatched decisions',()=>{
  const diagnostics=publicCacheDiagnostics();
  diagnostics.observe(healthy);
  diagnostics.observe({...healthy,shareable:false,clientRenderFailed:true,ttlAvailable:false,setCookie:true});
  diagnostics.observe({...healthy,shareable:false});
  diagnostics.observe({...healthy,statusOk:false});
  expect(diagnostics.snapshot()).toMatchObject({privateFraction:.5,total:{total:4,shareable:2,private:2,unexplainedPrivate:1,decisionMismatch:1,reasons:{'client-render-failed':1,'ttl-null':1,'set-cookie':1,status:1}}});
  // Classification cannot accidentally turn the caller's denied decision public.
  expect(publicCacheDecision({...healthy,shareable:false}).shareable).toBe(false);
});
it('tracks STALE separately without classifying legal stale sharing as denied or mismatched',()=>{
  const diagnostics=publicCacheDiagnostics();
  expect(publicCacheDecision({...healthy,upstreamStale:true})).toEqual({shareable:true,reasons:[]});
  diagnostics.observe({...healthy,upstreamStale:true});
  diagnostics.observe({...healthy,upstreamStale:true,shareable:false,upstreamPolicyAvailable:false});
  diagnostics.observe(healthy);
  expect(diagnostics.snapshot()).toMatchObject({privateFraction:1/3,total:{total:3,shareable:2,private:1,stale:2,staleShareable:1,unexplainedPrivate:0,decisionMismatch:0,reasons:{status:0,'upstream-policy-null':1}}});
});
it('emits at most one aggregate per interval with no timers and keeps counts across suppressed log calls',()=>{
  let now=0;const logs:PublicCacheDiagnosticSnapshot[]=[],diagnostics=publicCacheDiagnostics({now:()=>now,intervalMs:1000,emit:value=>logs.push(value)});
  diagnostics.observe(healthy);expect(logs).toHaveLength(1);
  for(let i=0;i<100;i++)diagnostics.observe({...healthy,shareable:false,ttlAvailable:false});
  now=999;diagnostics.observe(healthy);expect(logs).toHaveLength(1);
  now=1000;diagnostics.observe(healthy);expect(logs).toHaveLength(2);
  expect(logs[1]).toMatchObject({total:{total:103,private:100},window:{total:102,private:100}});
  now=0;diagnostics.observe(healthy);expect(logs).toHaveLength(2);
  now=2000;diagnostics.observe(healthy);expect(logs).toHaveLength(3);
});
it('never retains arbitrary fields or emits secrets, and snapshots cannot mutate counters',()=>{
  const logs:PublicCacheDiagnosticSnapshot[]=[],diagnostics=publicCacheDiagnostics({emit:value=>logs.push(value)});
  diagnostics.observe({...healthy,url:'/private?token=SECRET',cookie:'SECRET',error:new Error('SECRET')} as PublicCacheDecisionInput);
  expect(JSON.stringify(logs)).not.toContain('SECRET');
  expect(Object.keys(logs[0]!.total.reasons)).toEqual([...PUBLIC_CACHE_REASONS]);
  const view=diagnostics.snapshot();view.total.total=999;view.total.reasons.status=999;
  expect(diagnostics.snapshot().total.total).toBe(1);expect(diagnostics.snapshot().total.reasons.status).toBe(0);
});
it('saturates fixed counters and stops claiming exact fractions after saturation',()=>{
  const diagnostics=publicCacheDiagnostics({counterCeiling:3});
  for(let i=0;i<10;i++)diagnostics.observe({...healthy,shareable:false,ttlAvailable:false});
  expect(diagnostics.snapshot()).toMatchObject({privateFraction:null,total:{total:3,private:3,saturated:true,reasons:{'ttl-null':3}}});
});
it('contains logger failures and nonfinite clock readings without affecting decisions or log rate',()=>{
  let now=0,calls=0;const diagnostics=publicCacheDiagnostics({now:()=>now,intervalMs:1000,emit:()=>{calls++;throw new Error('private logger failure');}});
  diagnostics.observe(healthy);diagnostics.observe(healthy);expect(calls).toBe(1);
  now=NaN;diagnostics.observe(healthy);expect(calls).toBe(1);
  now=1000;diagnostics.observe(healthy);expect(calls).toBe(2);
  expect(diagnostics.snapshot()).toMatchObject({logFailures:2,total:{total:4}});
  expect(()=>publicCacheDiagnostics({intervalMs:0})).toThrow();
});
