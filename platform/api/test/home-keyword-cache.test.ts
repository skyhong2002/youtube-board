import {expect,it} from 'vitest';
import {keywordWindowCache} from '../src/reports/home-keyword-cache.js';
it('serves fresh, then stale with one background refresh, and never caches failures',async()=>{
 let clock=0,loads=0,release:()=>void=()=>{};const ok=(v:number)=>async()=>{loads++;return {v,ok:true};};
 const cache=keywordWindowCache<{v:number;ok:boolean}>(x=>x.ok,{freshMs:100,maxStaleMs:1000,now:()=>clock});
 expect(await cache(ok(1))).toEqual({v:1,ok:true});expect(loads).toBe(1);
 clock=50;expect(await cache(ok(2))).toEqual({v:1,ok:true});expect(loads).toBe(1);
 clock=150;const slow=()=>{loads++;return new Promise<{v:number;ok:boolean}>(r=>{release=()=>r({v:3,ok:true});});};
 expect(await cache(slow)).toEqual({v:1,ok:true});expect(await cache(slow)).toEqual({v:1,ok:true});expect(loads).toBe(2);
 release();await new Promise(r=>setTimeout(r,0));expect(await cache(ok(4))).toEqual({v:3,ok:true});expect(loads).toBe(2);
 clock=300;expect(await cache(async()=>{loads++;throw Error('down');})).toEqual({v:3,ok:true});await new Promise(r=>setTimeout(r,0));
 expect(await cache(async()=>({v:5,ok:false}))).toEqual({v:3,ok:true});await new Promise(r=>setTimeout(r,0));
 clock=1200;await expect(cache(async()=>{throw Error('down');})).rejects.toThrow('down');
 expect(await cache(ok(6))).toEqual({v:6,ok:true});
});
it('returns independent copies so request-time enrichment cannot leak into the cache',async()=>{
 const cache=keywordWindowCache<{rows:{name:string}[]}>(()=>true,{now:()=>0});
 const first=await cache(async()=>({rows:[{name:'a'}]}));first.rows[0]!.name='changed';
 expect(await cache(async()=>({rows:[]}))).toEqual({rows:[{name:'a'}]});
});
it('invalidate ignores a refresh that started before it and refreshes on the next call while serving the previous ranking',async()=>{
 let release:(v:{v:number})=>void=()=>{};const cache=keywordWindowCache<{v:number}>(()=>true,{freshMs:10,now:()=>clock});let clock=0;
 await cache(async()=>({v:1}));clock=20;
 expect(await cache(()=>new Promise(r=>{release=r;}))).toEqual({v:1});
 cache.invalidate();release({v:2});await new Promise(r=>setTimeout(r,0));
 expect(await cache(async()=>({v:3}))).toEqual({v:1});await new Promise(r=>setTimeout(r,0));
 expect(await cache(async()=>({v:4}))).toEqual({v:3});
});
it('starts warm from the store once, writes each success and clears it on invalidate; a failing or future store entry is a cold start',async()=>{
 let clock=10_000;const writes:unknown[]=[];let cleared=0,reads=0;
 const store={read:async()=>{reads++;return {at:9_950,value:{v:1,ok:true}};},write:async(e:unknown)=>{writes.push(e);},clear:async()=>{cleared++;}};
 const cache=keywordWindowCache<{v:number;ok:boolean}>(x=>x.ok,{freshMs:100,maxStaleMs:1000,now:()=>clock,store});
 const load=async()=>({v:2,ok:true});
 expect(await cache(load)).toEqual({v:1,ok:true});expect(reads).toBe(1);
 clock=10_050;expect(await cache(load)).toEqual({v:1,ok:true});await new Promise(r=>setTimeout(r,0));expect(await cache(load)).toEqual({v:2,ok:true});
 expect(writes).toEqual([{at:10_050,value:{v:2,ok:true}}]);expect(reads).toBe(1);
 cache.invalidate();expect(cleared).toBe(1);expect(await cache(async()=>({v:3,ok:true}))).toEqual({v:2,ok:true});await new Promise(r=>setTimeout(r,0));
 expect(await cache(async()=>({v:9,ok:true}))).toEqual({v:3,ok:true});expect(reads).toBe(1);
 const broken=keywordWindowCache<{v:number;ok:boolean}>(x=>x.ok,{now:()=>clock,store:{read:async()=>{throw Error('redis down');},write:async()=>{throw Error('redis down');},clear:async()=>{}}});
 expect(await broken(async()=>({v:4,ok:true}))).toEqual({v:4,ok:true});
 const future=keywordWindowCache<{v:number;ok:boolean}>(x=>x.ok,{now:()=>clock,store:{...store,read:async()=>({at:clock+1,value:{v:9,ok:true}})}});
 expect(await future(async()=>({v:5,ok:true}))).toEqual({v:5,ok:true});
});
