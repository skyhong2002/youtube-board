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
