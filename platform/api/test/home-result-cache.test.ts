import {it,expect} from 'vitest';
import type {HomeData} from '../src/contracts.js';
import {homeResultCache} from '../src/reports/home-result-cache.js';
const sample=()=>({tagsStatus:'available',summary:{videos:1},exploration:{categories:{status:'available'},keywords:{status:'synchronized',version:'original'},keywordToday:{status:'synchronized'}}}) as unknown as HomeData;
it('coalesces concurrent anonymous reads, isolates enrichment and expires within the public TTL',async()=>{
 let clock=0,calls=0,release!:()=>void;const gate=new Promise<void>(r=>release=r),cache=homeResultCache(()=>clock);
 const load=async()=>{calls++;await gate;return sample();};
 const a=cache(load),b=cache(load);await Promise.resolve();expect(calls).toBe(1);release();const [first,second]=await Promise.all([a,b]);
 first.exploration.keywords.version='enriched';expect(second.exploration.keywords.version).toBe('original');
 expect((await cache(load)).exploration.keywords.version).toBe('original');expect(calls).toBe(1);
 clock=60_000;await cache(load);expect(calls).toBe(2);
});
it('does not retain failed or degraded source sections',async()=>{
 const cache=homeResultCache();let calls=0;
 const degraded=async()=>{calls++;const value=sample();value.exploration.keywords.status='unavailable';return value;};
 await cache(degraded);await cache(degraded);expect(calls).toBe(2);
 await expect(cache(async()=>{throw Error('upstream unavailable');})).rejects.toThrow('upstream unavailable');
 expect((await cache(async()=>sample())).exploration.keywords.status).toBe('synchronized');
});

it('retains real home shape with shared window metadata rather than mistaking aliases for cycles',async()=>{
 const cache=homeResultCache();let calls=0;const metadata={terms:10};
 const load=async()=>{calls++;const value=sample();value.exploration.keywords.exclusions=metadata as never;value.exploration.keywordToday.exclusions=metadata as never;return value;};
 const first=await cache(load);await cache(load);expect(calls).toBe(1);
 expect(first.exploration.keywords.exclusions).toEqual(metadata);expect(first.exploration.keywords.exclusions).not.toBe(first.exploration.keywordToday.exclusions);
});
