import {describe,expect,it} from 'vitest';
import {MySqlDialect} from 'drizzle-orm/mysql-core';
import {buildApp} from '../src/app.js';
import {PUBLIC_ENDPOINTS,EXAMPLE_VIDEO_SOURCE} from '../src/public-api/catalog.js';
import {SCHEMAS,type Schema} from '../src/public-api/schemas.js';
import {checkDocumentedExamples,responseValidator} from '../../tools/check-openapi.js';
import type {Reader,Row} from '../src/db/client.js';

/** Every public v1 instant is UTC `Z`; Taipei offsets and naive SQL wall time must never leak. */
const OFFSET_INSTANT=/\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?[+-]\d\d:?\d\d\b/;
const NAIVE_DATETIME=/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d(?::\d\d(?:\.\d+)?)?$/;
function leakedInstants(value:unknown,path='$'):string[]{
 if(typeof value==='string')return OFFSET_INSTANT.test(value)||NAIVE_DATETIME.test(value)?[`${path}=${value}`]:[];
 if(Array.isArray(value))return value.flatMap((item,i)=>leakedInstants(item,`${path}[${i}]`));
 if(value&&typeof value==='object')return Object.entries(value).flatMap(([key,item])=>leakedInstants(item,`${path}.${key}`));
 return [];
}
function timeNodes(value:unknown,path='#'):{path:string;node:Schema}[]{
 if(Array.isArray(value))return value.flatMap((item,i)=>timeNodes(item,`${path}/${i}`));
 if(!value||typeof value!=='object')return [];
 const node=value as Schema,self=node.format==='date-time'?[{path,node}]:[];
 return [...self,...Object.entries(node).flatMap(([key,item])=>timeNodes(item,`${path}/${key}`))];
}
const clock=()=>new Date('2026-10-11T10:00:00Z'),dialect=new MySqlDialect();
const channelSource={u_id:990001,youtube_id:'UCSynthetic990001',title:'範例新聞甲（合成）',publishedAt:'2020-01-01 00:00:00',viewCount:1000,subscriberCount:10,videoCount:5,view_week:1000,view_month:4000,tags:'[990001]',mtime:'2026-10-12 00:00:00',ctime:'2026-10-11 18:00:00'};
const reader:Reader={rows:async<T extends Row>(query:Parameters<Reader['rows']>[0]):Promise<T[]>=>{
 const q=dialect.sqlToQuery(query).sql;
 if(q.includes('AS cutoff'))return [{cutoff:'2026-10-11 18:00:00',selected:1,nulls:0}] as unknown as T[];
 if(q.includes('FROM urt_video v')&&q.includes('ORDER BY'))return [{pk:990001,...EXAMPLE_VIDEO_SOURCE,mtime:'2026-10-12 00:00:00'}] as unknown as T[];
 if(/COUNT\(\*\)/i.test(q))return [{total:1}] as unknown as T[];
 if(q.includes('urt_tag'))return [{tag_id:990001,tag_name:'範例分類（合成）'}] as unknown as T[];
 if(q.includes('urt_channel')||q.includes('urt_count'))return [channelSource] as unknown as T[];
 return [] as T[];
},close:async()=>{}};

describe('public v1 UTC timestamp contract',()=>{
 it('types every date-time schema field as a UTC Z instant',()=>{
  const nodes=timeNodes(SCHEMAS);
  expect(nodes.length).toBeGreaterThanOrEqual(20);
  for(const {path,node}of nodes)expect(node.pattern,path).toBe('Z$');
 });
 it('validates every documented example against the Z-only schema and leaks no offsets',()=>{
  expect(checkDocumentedExamples()).toBeGreaterThanOrEqual(4);
  for(const endpoint of PUBLIC_ENDPOINTS)if(endpoint.example!==undefined)expect(leakedInstants(endpoint.example),endpoint.path).toEqual([]);
 });
 it('validates real handler responses from Taipei SQL wall time as UTC Z',async()=>{
  const app=buildApp({reader,clock,dataset:'fixture'});
  try{
   const videos=await app.inject('/api/v1/videos?q=%E4%BA%A4%E9%80%9A');expect(videos.statusCode,videos.body).toBe(200);
   const body=videos.json(),validate=responseValidator(PUBLIC_ENDPOINTS.find(e=>e.path==='/api/v1/videos')!);
   expect(validate(body),JSON.stringify(validate.errors)).toBe(true);expect(leakedInstants(body)).toEqual([]);
   // Taipei 2026-10-12 00:00 is 2026-10-11 16:00 UTC: the instant crosses the UTC calendar day.
   expect(body.data.rows[0]).toMatchObject({publishedAt:'2026-10-11T10:00:00.000Z',updatedAt:'2026-10-11T16:00:00.000Z'});
   expect(body.meta.requestedAt).toBe('2026-10-11T10:00:00.000Z');expect(body.meta.updatedAt).toBe('2026-10-11T16:00:00.000Z');
   const channels=await app.inject('/api/v1/channels');expect(channels.statusCode,channels.body).toBe(200);
   const channelBody=channels.json(),validateChannels=responseValidator(PUBLIC_ENDPOINTS.find(e=>e.path==='/api/v1/channels')!);
   expect(validateChannels(channelBody),JSON.stringify(validateChannels.errors)).toBe(true);expect(leakedInstants(channelBody)).toEqual([]);
   expect(channelBody.data.rows[0]).toMatchObject({publishedAt:'2019-12-31T16:00:00.000Z',updatedAt:'2026-10-11T16:00:00.000Z'});
   const status=await app.inject({url:'/api/status',headers:{accept:'application/json'}});expect(status.statusCode).toBe(200);
   const statusEndpoint=PUBLIC_ENDPOINTS.find(e=>e.path==='/api/status')!;
   if(statusEndpoint.schema){const validateStatus=responseValidator(statusEndpoint);expect(validateStatus(status.json()),JSON.stringify(validateStatus.errors)).toBe(true);}
   expect(status.json().checkedAt).toMatch(/Z$/);
  }finally{await app.close();}
 });
 it('rejects Taipei offsets and naive datetimes in every typed instant position',async()=>{
  const app=buildApp({reader,clock,dataset:'fixture'});
  try{
   const body=(await app.inject('/api/v1/videos?q=%E4%BA%A4%E9%80%9A')).json(),validate=responseValidator(PUBLIC_ENDPOINTS.find(e=>e.path==='/api/v1/videos')!);
   for(const mutate of [
    (b:typeof body)=>{b.data.rows[0].publishedAt='2026-10-11T18:00:00+08:00';},
    (b:typeof body)=>{b.data.rows[0].updatedAt='2026-10-12T00:00:00+08:00';},
    (b:typeof body)=>{b.meta.updatedAt='2026-10-12T00:00:00+08:00';},
    (b:typeof body)=>{b.meta.requestedAt='2026-10-11T10:00:00+00:00';},
    (b:typeof body)=>{b.data.rows[0].publishedAt='2026-10-11 18:00:00';},
   ]){const copy=structuredClone(body);mutate(copy);expect(validate(copy)).toBe(false);expect(leakedInstants(copy).length).toBeGreaterThan(0);}
   const vocabulary=PUBLIC_ENDPOINTS.find(e=>e.path==='/api/v1/vocabulary')!,example=structuredClone(vocabulary.example) as {data:{window:{since:string;until:string}}};
   example.data.window.since='2026-10-10T00:00:00+08:00';expect(responseValidator(vocabulary)(example)).toBe(false);
  }finally{await app.close();}
 });
});
