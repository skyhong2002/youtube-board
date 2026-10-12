import {it,expect} from 'vitest';
import {keywordVideoCache,keywordVideoCacheKey} from '../src/reports/keyword-video-cache.js';
import {DataSourceUnavailable} from '../src/db/client.js';
import {reports} from '../src/reports/service.js';
import type {Reader,Row} from '../src/db/client.js';
const deferred=<T>()=>{let resolve!:(v:T)=>void,reject!:(e:Error)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
it('shares pending work, caches completed success for 15 seconds and returns independent DTOs',async()=>{
 let now=0,calls=0;const cache=keywordVideoCache<{rows:string[]}>({now:()=>now}),gate=deferred<{rows:string[]}>();
 const load=()=>{calls++;return gate.promise;};
 const a=cache({keyword:'AI'},undefined,load),b=cache({keyword:'AI'},undefined,load);
 await Promise.resolve();expect(calls).toBe(1);now=20000;gate.resolve({rows:['ok']});
 const first=await a;first.rows.push('mutated');expect((await b).rows).toEqual(['ok']);
 now=34999;expect((await cache({keyword:'AI'},undefined,load)).rows).toEqual(['ok']);expect(calls).toBe(1);
 now=35000;await cache({keyword:'AI'},undefined,load);expect(calls).toBe(2);
});
it('never caches rejected or explicitly unavailable work and releases pending slots',async()=>{
 const cache=keywordVideoCache<{status:string}>({maxPending:1,cacheable:v=>v.status!=='unavailable'});let calls=0;
 const load=async()=>{calls++;if(calls===1)throw new Error('temporary');return {status:calls===2?'unavailable':'ready'};};
 await expect(cache({keyword:'a'},undefined,load)).rejects.toThrow('temporary');
 expect((await cache({keyword:'a'},undefined,load)).status).toBe('unavailable');
 expect((await cache({keyword:'a'},undefined,load)).status).toBe('ready');
 await cache({keyword:'a'},undefined,load);expect(calls).toBe(3);
});
it('keys isolate exact terms, scalar types, arrays, scope, filters and cursors while normalizing ID sets',()=>{
 const key=keywordVideoCacheKey({keyword:'AI',tagid:'2,1,2',q:'%_',limit:'50'});
 expect(keywordVideoCacheKey({limit:'50',q:'%_',tagid:'1,2',keyword:'AI'})).toBe(key);
 for(const q of [{keyword:'ai'},{keyword:'AI '},{keyword:'AI',limit:50},{keyword:'AI',limit:['50']},{keyword:'AI',cursor:'abc'},{keyword:'AI',q:'different'}])expect(keywordVideoCacheKey(q)).not.toBe(key);
 expect(keywordVideoCacheKey({keyword:'AI'},'taxonomy')).not.toBe(keywordVideoCacheKey({keyword:'AI'}));
 expect(keywordVideoCacheKey({keyword:['a','b']})).not.toBe(keywordVideoCacheKey({keyword:['b','a']}));
 expect(()=>keywordVideoCacheKey({keyword:'AI',tagid:['1','2']})).toThrow();
});
it('bounds in-flight SQL, never evicts pending entries, and resumes after settle',async()=>{
 const cache=keywordVideoCache<number>({maxKeys:2,maxPending:2}),a=deferred<number>(),b=deferred<number>();let extra=0;
 const first=cache({keyword:'a'},undefined,()=>a.promise),second=cache({keyword:'b'},undefined,()=>b.promise);
 await expect(cache({keyword:'c'},undefined,async()=>++extra)).rejects.toBeInstanceOf(DataSourceUnavailable);expect(extra).toBe(0);
 const shared=cache({keyword:'a'},undefined,async()=>++extra);a.resolve(1);expect(await first).toBe(1);expect(await shared).toBe(1);
 expect(await cache({keyword:'c'},undefined,async()=>++extra)).toBe(1);b.resolve(2);await second;
});
it('uses ready-entry LRU eviction without invalidating pending work',async()=>{
 const cache=keywordVideoCache<number>({maxKeys:2,maxPending:2});let calls=0;
 const get=(keyword:string)=>cache({keyword},undefined,async()=>++calls);
 await get('a');await get('b');expect(await get('a')).toBe(1);await get('c');expect(await get('a')).toBe(1);await get('b');expect(calls).toBe(4);
});
it('enforces individual and aggregate budgets, while still serving oversized successful results',async()=>{
 const cache=keywordVideoCache<{value:string}>({maxBytes:1300,maxResultBytes:100});let calls=0;
 const get=(keyword:string,size:number)=>cache({keyword},undefined,async()=>{calls++;return {value:'x'.repeat(size)};});
 expect((await get('large',200)).value).toHaveLength(200);await get('large',200);expect(calls).toBe(2);
 await get('a',20);await get('b',20);await get('a',20);expect(calls).toBe(5);
});
it('report integration shares actual reader work only within one report instance',async()=>{
 let reads=0;const gate=deferred<Row[]>();
 const reader:Reader={async rows<T extends Row>(){reads++;return await gate.promise as T[];},async close(){}};
 const first=reports(reader),other=reports(reader);
 const a=first.videos({keyword:'AI'}),b=first.videos({keyword:'AI'});
 await Promise.resolve();expect(reads).toBe(1);gate.resolve([]);await Promise.all([a,b]);
 await first.videos({keyword:'AI'});expect(reads).toBe(1);
 await other.videos({keyword:'AI'});expect(reads).toBe(2);
 await first.videos({keyword:'AI',days:'1'});expect(reads).toBe(3);
});
