import {describe,it,expect} from 'vitest';
import type {Connection} from 'mysql2/promise';
import {dailyTopicCacheStep} from '../src/topic-cache.js';
const fake=(answers:unknown[][])=>({query:async()=>{const next=answers.shift();if(next instanceof Error)throw next;return [next??[]];}}) as unknown as Connection;
const opts={execute:true,missingOnly:true,assertAuthorized:()=>{}};
describe('daily topic cache step',()=>{
 it('skips a present cache or a missing daily row when filling only missing caches',async()=>{
  expect(await dailyTopicCacheStep(fake([[{present:1}]]),'2026-10-17','CLI',opts)).toMatchObject({workflow:'reports.ai_topic.build',status:'skipped',reason:'cache_already_present'});
  expect(await dailyTopicCacheStep(fake([[]]),'2026-10-17','CLI',opts)).toMatchObject({status:'skipped',reason:'daily_source_missing'});
 });
 it('reports failures with a short reason instead of throwing',async()=>{
  const failing=(message:string)=>({query:async(sql:string)=>{if(String(sql).includes('present'))return [[{present:0}]];throw new Error(message);}}) as unknown as Connection;
  expect(await dailyTopicCacheStep(failing('topic_cache_capacity_exceeded'),'2026-10-17','CLI',opts)).toMatchObject({status:'failed',reason:'topic_cache_capacity_exceeded'});
  expect(await dailyTopicCacheStep(failing('AI business key is locked'),'2026-10-17','CLI',opts)).toMatchObject({status:'failed',reason:'business_key_locked'});
  expect(await dailyTopicCacheStep(failing('connect ECONNRESET 10.0.0.1:3306 password=x'),'2026-10-17','CLI',opts)).toMatchObject({status:'failed',reason:'topic_cache_failed'});
 });
});
