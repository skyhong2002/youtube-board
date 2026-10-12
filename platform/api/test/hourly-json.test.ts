import {it,expect} from 'vitest';
import {MySqlDialect} from 'drizzle-orm/mysql-core';
import {decodeHourlyTopics,HOURLY_JSON_LIMITS} from '../src/reports/hourly-json.js';
import {buildApp} from '../src/app.js';
import type {Reader} from '../src/db/client.js';
const event={事件:'字串中的 {括號} 與 [陣列] 及 "引號" 和 \\ 反斜線',描述:'來源',video_ids:['AbC_123xYz9']},payload=JSON.stringify({hourly_events:[event]});
it('decodes full JSON and bounded prose/fences with string-aware balanced candidates',()=>{
 expect(decodeHourlyTopics(payload,true)).toMatchObject({state:'decoded',topics:[event],extracted:false});
 for(const content of ['前言\n```json\n'+payload+'\n```\n後記','前言\n'+payload+'\n後記','錯誤 {bad} 在前 '+payload,'```invalid```\n```JSON\n'+payload+'\n```'])expect(decodeHourlyTopics(content,true)).toMatchObject({state:'decoded',topics:[event],extracted:true});
});
it('strict published decoding never extracts prose or fenced new output',()=>{
 for(const value of ['前言 '+payload,'```json\n'+payload+'\n```'])expect(decodeHourlyTopics(value)).toMatchObject({state:'malformed',topics:[]});
 expect(decodeHourlyTopics(payload)).toMatchObject({state:'decoded',topics:[event]});
});
it('distinguishes actual empty topics from malformed and unsupported content',()=>{
 for(const content of ['[]','{"events":[]}','{"topics":{}}'])expect(decodeHourlyTopics(content,true).state).toBe('empty');
 for(const content of ['{}','null','42','"text"','{"events":[null,4,{}]}'])expect(decodeHourlyTopics(content,true).state).toBe('unsupported');
 for(const content of ['','not JSON','{"events": [}','前言 {"events": [}'])expect(decodeHourlyTopics(content,true).state).toBe('malformed');
 expect(decodeHourlyTopics(JSON.stringify({events:[null,event,{}]}),true)).toMatchObject({state:'decoded',topics:[{},event,{}],invalidItems:2});
});
it('bounds UTF-8 bytes, nesting, candidate count and total scan work',()=>{
 expect(decodeHourlyTopics('中'.repeat(HOURLY_JSON_LIMITS.bytes/2),true).state).toBe('oversized');
 expect(decodeHourlyTopics('['.repeat(65)+'0'+']'.repeat(65),true).state).toBe('bounded');
 expect(decodeHourlyTopics('prefix '+Array.from({length:20},()=>'{bad}').join(' ')+payload,true).state).toBe('bounded');
 expect(decodeHourlyTopics('{'.repeat(63)+'x'.repeat(60000),true).state).toBe('bounded');
});
it('publication approval precedes extraction and coverage distinguishes malformed from empty',async()=>{
 const dialect=new MySqlDialect();
 const rows=[{pk:1,result_json:'前言 '+payload},{pk:2,result_json:'{"events":[]}'},{pk:3,result_json:'broken'},{pk:4,result_json:'{}'},{pk:5,result_json:'前言 '+payload},{pk:6,result_json:'前言 '+payload}].map(r=>({...r,date_from:'2038-04-01 00:00:00',date_to:'2038-04-01 00:59:59',data_type:'each',user_token:'cli',condition_type:'all'}));
 const app=buildApp({reader:{rows:async query=>{const s=dialect.sqlToQuery(query);if(s.sql.includes('SELECT EXISTS'))return [{claimed:Number(s.params.includes(5)||s.params.includes(6)),published_before:Number(s.params.includes(6))}];if(s.sql.includes('ts_ai_runs'))return [];return rows;},close:async()=>{}} as Reader});
 try{const r=await app.inject('/api/v1/ai/hours?date=2038-04-01');expect(r.statusCode,r.body).toBe(200);expect(r.json().data.rows).toHaveLength(1);expect(r.json().data.rows[0].event).toBe(event.事件);expect(r.json().data.evidenceCoverage).toMatchObject({withheldSources:1,divergedSources:1,decoding:{sourceRows:4,decodedSources:1,emptySources:1,malformedSources:1,unsupportedSources:1,extractedLegacySources:1}});}finally{await app.close();}
});

it('legacy recovery may inspect an inner valid array after an invalid balanced outer candidate',()=>{
 const value='前言 {"events":['+JSON.stringify(event)+'],} 後記';
 expect(decodeHourlyTopics(value,true)).toMatchObject({state:'decoded',topics:[event],extracted:true});
 expect(decodeHourlyTopics(value,false)).toMatchObject({state:'malformed',topics:[]});
});
