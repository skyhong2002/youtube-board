import { it, expect } from 'vitest';
import { channelBoilerplate } from '../src/report-caches.js';

const footer=[{term:'訂閱',field:'description' as const},{term:'LINE',field:'description' as const}];
it('drops a channel footer that sits in most descriptions but almost no titles',()=>{
 const b=channelBoilerplate();
 for(let i=0;i<20;i++)b.add([...footer,{term:i<12?'颱風':'選舉',field:'title'},{term:'颱風',field:'description'}]);
 // 颱風 is in every description too, but it leads 12 of 20 titles: a topic, not a footer.
 expect([...b.terms()].sort()).toEqual(['LINE','訂閱']);
});
it('keeps everything for windows under 10 videos and for terms in under half the descriptions',()=>{
 const small=channelBoilerplate();for(let i=0;i<9;i++)small.add(footer);expect(small.terms().size).toBe(0);
 const sparse=channelBoilerplate();for(let i=0;i<20;i++)sparse.add(i<9?footer:[]);expect(sparse.terms().size).toBe(0);
 // One title mention in 20 videos (5%) is no longer "almost none".
 const titled=channelBoilerplate();for(let i=0;i<20;i++)titled.add([...footer,...(i===0?[{term:'訂閱',field:'title' as const}]:[])]);expect([...titled.terms()]).toEqual(['LINE']);
});
