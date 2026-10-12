import Fastify from 'fastify';
import {MySqlDialect} from 'drizzle-orm/mysql-core';
import {describe,expect,it} from 'vitest';
import type {SQL} from 'drizzle-orm';
import {DataQueryFailed,DataSourceUnavailable,type Reader,type Row} from '../src/db/client.js';
import {buildApp} from '../src/app.js';
import {createSitemaps,registerSitemaps,type SitemapOptions} from '../src/seo/sitemaps.js';
const NOW=Date.parse('2026-10-12T12:00:00Z'),RELEASE='2026-10-11T01:02:03Z',STAMP='2026-10-11 12:00:00';
const dialect=new MySqlDialect();
type Query=ReturnType<typeof dialect.sqlToQuery>;
type Kind='channels'|'videos'|'tags';
function fixture(input:Partial<Record<Kind,Row[]>>={}){
 const data:Record<Kind,Row[]>={channels:[],videos:[],tags:[],...input};
 const queries:Query[]=[];let failure:Error|undefined,wait:Promise<void>|undefined;
 const reader:Reader={async rows<T extends Row>(sql:SQL){const q=dialect.sqlToQuery(sql);queries.push(q);if(wait)await wait;if(failure)throw failure;
  const kind:Kind=q.sql.includes('urt_channel')?'channels':q.sql.includes('urt_video')?'videos':'tags',key=kind==='channels'?'u_id':kind==='videos'?'pk':'tag_id';
  const rows=[...data[kind]].sort((a,b)=>Number(a[key])-Number(b[key]));
  if(q.sql.includes('AS ceiling'))return (rows.length?[{ceiling:rows.at(-1)![key]}]:[]) as unknown as T[];
  const [after,ceiling,limit]=q.params.map(Number);const newest=new Map<string,number>();if(kind==='videos')for(const row of rows)newest.set(String(row.videoId),Number(row.pk));
  return rows.filter(row=>Number(row[key])>after!&&Number(row[key])<=ceiling!&&(kind!=='channels'||row.flag_del==null||Number(row.flag_del)<1)&&(kind!=='tags'||row.del_flag==null||Number(row.del_flag)<1)&&(kind!=='videos'||(row.title!=='Private video'&&row.title!=='Deleted video'&&Number(row.pk)===newest.get(String(row.videoId))))).slice(0,limit).map(row=>({...row,cursor_id:row[key]})) as unknown as T[];
 },async close(){}};
 return {reader,queries,data,setFailure(error?:Error){failure=error;},setWait(promise?:Promise<void>){wait=promise;}};
}
const options:SitemapOptions={now:()=>NOW,staticLastModified:RELEASE,pauseMs:0};
const urls=(body:string)=>[...body.matchAll(/<loc>(.*?)<\/loc>/g)].map(m=>m[1]!);
const dates=(body:string)=>[...body.matchAll(/<lastmod>(.*?)<\/lastmod>/g)].map(m=>m[1]!);
const video=(pk:number,extra:Row={}):Row=>({pk,videoId:'Video'+String(pk).padStart(6,'0'),title:'Public',ctime:STAMP,mtime:STAMP,...extra});
const tick=()=>new Promise(resolve=>setImmediate(resolve));

describe('atomic prepared sitemap families',()=>{
 it('uses sparse keysets rather than ID buckets and indexes only nonempty prepared children with truthful lastmod',async()=>{
  const f=fixture({channels:[{u_id:1,mtime:STAMP},{u_id:60_000_001,mtime:'2026-10-12 12:00:00'}],videos:[video(61_500_001,{videoId:'SparseVid01'})],tags:[{tag_id:108,ctime:STAMP}]});
  const maps=createSitemaps(f.reader,{...options,batchSize:1});await maps.prepare();const body=await maps.read();
  expect(urls(body)).toEqual(['https://youtube.observe.tw/sitemaps/static/1.xml','https://youtube.observe.tw/sitemaps/channels/1.xml','https://youtube.observe.tw/sitemaps/videos/1.xml','https://youtube.observe.tw/sitemaps/tags/1.xml']);
  expect(dates(body)).toEqual(['2026-10-11T01:02:03.000Z','2026-10-12T04:00:00.000Z','2026-10-11T04:00:00.000Z','2026-10-11T04:00:00.000Z']);
  expect(urls(await maps.read('channels','1'))).toEqual(['https://youtube.observe.tw/channels/1','https://youtube.observe.tw/channels/60000001']);
  expect(f.queries.every(q=>!q.sql.includes('OFFSET')&&!q.sql.includes('MAX('))).toBe(true);
  for(const q of f.queries.filter(q=>!q.sql.includes('AS ceiling')))expect(q.params.at(-1)).toBe(1);
  expect(f.queries.find(q=>q.sql.includes('c.u_id>')&&q.params[0]==='1')?.params).toEqual(['1','60000001',1]);
  expect(await maps.read('static','1')).not.toContain('https://youtube.observe.tw/api<');
 });
 it('splits exactly 50000+1 accepted URLs into two nonempty pages, independent of PK gaps',async()=>{
  const f=fixture({videos:Array.from({length:50001},(_,i)=>video(i+1))});const maps=createSitemaps(f.reader,{now:()=>NOW,pauseMs:0});await maps.prepare();
  expect(urls(await maps.read())).toHaveLength(2);expect(urls(await maps.read('videos','1'))).toHaveLength(50000);expect(urls(await maps.read('videos','2'))).toHaveLength(1);
  const rows=f.queries.filter(q=>q.sql.includes('v.pk>'));expect(rows).toHaveLength(11);expect(rows.every(q=>q.params.at(-1)===5000)).toBe(true);
 });
 it('splits at the XML byte limit instead of truncating eligible URLs',async()=>{
  const f=fixture({videos:Array.from({length:10},(_,i)=>video(i+1))});const maps=createSitemaps(f.reader,{now:()=>NOW,maxPageBytes:1100});await maps.prepare();
  const children=urls(await maps.read());expect(children.length).toBeGreaterThan(1);const entries:string[]=[];
  for(let n=1;n<=children.length;n++){const body=await maps.read('videos',String(n));expect(Buffer.byteLength(body)).toBeLessThanOrEqual(1100);expect(urls(body).length).toBeGreaterThan(0);entries.push(...urls(body));}
  expect(entries).toHaveLength(10);expect(new Set(entries).size).toBe(10);
 });
 it('omits invalid dates, future scheduling dates, invalid IDs, deleted/private rows and old duplicate identities',async()=>{
  const f=fixture({channels:[{u_id:1,ctime:STAMP,flag_del:1},{u_id:2,ctime:'0000-00-00 00:00:00'}],tags:[{tag_id:1,ctime:STAMP,del_flag:1}],videos:[
   video(1,{mtime:null,ctime:null,stime:'2027-01-01 00:00:00'}),video(2,{mtime:'2026-02-30 00:00:00',ctime:null}),video(3,{mtime:'2027-01-01 00:00:00',ctime:null}),video(4,{title:'Private video'}),video(5,{title:'Deleted video'}),video(6,{videoId:'invalid'}),video(7,{videoId:'Duplicate01'}),video(8,{videoId:'Duplicate01'}),video(9,{videoId:'duplicate01',stime:'2027-01-01 00:00:00'}),
  ]});const maps=createSitemaps(f.reader,{now:()=>NOW,pauseMs:0});await maps.prepare();
  expect(urls(await maps.read())).toEqual(['https://youtube.observe.tw/sitemaps/videos/1.xml']);
  const body=await maps.read('videos','1');expect(urls(body)).toEqual(['https://youtube.observe.tw/videos/Duplicate01','https://youtube.observe.tw/videos/duplicate01']);expect(body).not.toContain('2027');
  const q=f.queries.find(q=>q.sql.includes('v.pk>'))!;expect(q.sql).toContain('BINARY newer.videoId=BINARY v.videoId AND newer.pk>v.pk');expect(q.sql).toContain("v.title NOT IN ('Private video','Deleted video')");expect(q.sql.split(' FROM ')[0]).not.toContain('title');expect(q.sql).not.toContain('stime');
 });
 it('stores completed XML compressed with a distinct plaintext cap and returns validated full XML on decompression',async()=>{
  const f=fixture({videos:Array.from({length:1000},(_,i)=>video(i+1))}),metrics:unknown[]=[];
  const maps=createSitemaps(f.reader,{now:()=>NOW,pauseMs:0,maxGenerationBytes:10_000,maxGenerationPlaintextBytes:200_000,onDiagnostic:r=>metrics.push(r)});
  await maps.prepare();const body=await maps.read('videos','1');expect(urls(body)).toHaveLength(1000);expect(Buffer.byteLength(body)).toBeGreaterThan(100_000);
  expect(metrics).toEqual([expect.objectContaining({code:'SITEMAP_PREPARED',rows:1000,pages:1})]);
  const metric=metrics[0] as {compressedBytes:number;plaintextBytes:number};expect(metric.compressedBytes).toBeLessThanOrEqual(10_000);expect(metric.plaintextBytes).toBeGreaterThan(100_000);
  const tight=createSitemaps(f.reader,{now:()=>NOW,pauseMs:0,maxGenerationBytes:1000});await expect(tight.prepare()).rejects.toMatchObject({statusCode:503});expect(tight.ready()).toBe(false);
 });
 it('queues 32 distinct compressed pages behind one active decode and coalesces same-page callers',async()=>{
  const f=fixture({videos:Array.from({length:34},(_,i)=>video(i+1))});const maps=createSitemaps(f.reader,{now:()=>NOW,pauseMs:0,maxPageUrls:1});await maps.prepare();
  const reads=f.queries.length,first=maps.read('videos','1'),same=maps.read('videos','1');
  const queued=Array.from({length:32},(_,i)=>maps.read('videos',String(i+2)));
  const overflow=maps.read('videos','34'),unknown=maps.read('videos','999');
  const results=await Promise.allSettled([first,same,...queued,overflow,unknown]);
  expect(results.slice(0,34).every(result=>result.status==='fulfilled')).toBe(true);
  expect(results[0]).toEqual(results[1]);
  expect(results[34]).toMatchObject({status:'rejected',reason:{statusCode:503}});
  expect(results[35]).toMatchObject({status:'rejected',reason:{statusCode:404}});
  expect(await maps.read('videos','34')).toContain('/videos/Video000034');expect(f.queries).toHaveLength(reads);
 });
 it('never invents release/entry dates and omits unavailable inventories rather than empty bucket links',async()=>{
  for(const date of [undefined,'2027-01-01T00:00:00Z','2026-02-30T00:00:00Z','now']){const f=fixture();const maps=createSitemaps(f.reader,{now:()=>NOW,staticLastModified:date});await maps.prepare();expect(urls(await maps.read())).toEqual([]);}
  const f=fixture();const maps=createSitemaps(f.reader,options);await maps.prepare();expect(urls(await maps.read())).toHaveLength(1);expect(f.queries).toHaveLength(3);expect(f.queries.some(q=>q.sql.includes('ts_'))).toBe(false);
 });
 it('admits only one cold preparation, never starts SQL for unknown child requests, and backs off failed generations',async()=>{
  let resolve!:()=>void,clock=NOW;const f=fixture({videos:[video(1)]});f.setWait(new Promise(r=>{resolve=r;}));const maps=createSitemaps(f.reader,{now:()=>clock,retryMs:100});
  await expect(maps.read('videos','999')).rejects.toMatchObject({statusCode:503});expect(f.queries).toHaveLength(0);
  await expect(maps.read()).rejects.toMatchObject({statusCode:503});await expect(maps.read()).rejects.toMatchObject({statusCode:503});expect(f.queries).toHaveLength(1);
  f.setFailure(new DataSourceUnavailable());resolve();await tick();const reads=f.queries.length;
  await expect(maps.read()).rejects.toMatchObject({statusCode:503});expect(f.queries).toHaveLength(reads);
  clock+=101;f.setFailure();f.setWait();await maps.prepare();expect(urls(await maps.read())).toHaveLength(1);
  const after=f.queries.length;for(const [kind,page] of [['videos','999'],['keywords','00'],['events','ff'],['videos','01'],['videos','0'],['private','1']])await expect(maps.read(kind,page)).rejects.toMatchObject({statusCode:404});expect(f.queries).toHaveLength(after);
 });
 it('publishes atomically, serves the last complete family while refreshing, and retains removed old children for the index TTL',async()=>{
  let clock=NOW;const f=fixture({videos:[video(1),video(2),video(3)]});const maps=createSitemaps(f.reader,{now:()=>clock,ttlMs:100,maxPageUrls:2});await maps.prepare();const oldIndex=await maps.read(),oldSecond=await maps.read('videos','2');
  let resolve!:()=>void;f.setWait(new Promise(r=>{resolve=r;}));clock+=101;f.data.videos=[video(1)];
  expect(await maps.read()).toBe(oldIndex);expect(await maps.read('videos','2')).toBe(oldSecond);const pending=maps.prepare();
  resolve();await pending;expect(urls(await maps.read())).toHaveLength(1);expect(await maps.read('videos','2')).toBe(oldSecond);
  clock+=101;await expect(maps.read('videos','2')).rejects.toMatchObject({statusCode:404});
 });
 it('retains the last good complete family on refresh failure with no fabricated successful timestamp',async()=>{
  let clock=NOW;const f=fixture({videos:[video(1)]});const maps=createSitemaps(f.reader,{now:()=>clock,ttlMs:100,retryMs:100});await maps.prepare();const oldIndex=await maps.read(),oldChild=await maps.read('videos','1');
  clock+=101;f.setFailure(new DataQueryFailed('ER_BAD_FIELD_ERROR'));await expect(maps.prepare()).rejects.toMatchObject({driverCode:'ER_BAD_FIELD_ERROR'});
  const reads=f.queries.length;expect(await maps.read()).toBe(oldIndex);expect(await maps.read('videos','1')).toBe(oldChild);expect(f.queries).toHaveLength(reads);
 });
 it('fails the whole staging generation on row, time or total-byte limits and validates cursor progress',async()=>{
  for(const limits of [{maxGenerationRows:1},{maxGenerationBytes:200},{maxGenerationPlaintextBytes:200},{maxGenerationMs:1,budgetNow:(()=>{let n=0;return()=>n++;})()}]){const f=fixture({videos:[video(1),video(2)]});const maps=createSitemaps(f.reader,{now:()=>NOW,...limits});await expect(maps.prepare()).rejects.toMatchObject({statusCode:503});await expect(maps.read('videos','1')).rejects.toMatchObject({statusCode:503});}
  const f=fixture();const broken:Reader={async rows(q){if(dialect.sqlToQuery(q).sql.includes('AS ceiling'))return [{ceiling:1}] as never;return [{cursor_id:0,u_id:1,mtime:STAMP}] as never;},close:f.reader.close};await expect(createSitemaps(broken,{now:()=>NOW,pauseMs:0}).prepare()).rejects.toMatchObject({driverCode:'INVALID_SITEMAP_CURSOR'});
 });
});

describe('sitemap snapshot transport',()=>{
 it('exposes only fully prepared index children, all GET/HEAD 200 nonempty XML with true dates and safe shared headers',async()=>{
  const f=fixture({channels:[{u_id:1,mtime:STAMP}],videos:[video(1)],tags:[{tag_id:1,ctime:STAMP}]});const app=Fastify();const controller=registerSitemaps(app,f.reader,{...options,onDiagnostic:()=>{}});
  try{
   const first=await app.inject('/sitemap.xml');expect(first.statusCode).toBe(503);expect(first.headers['retry-after']).toBe('60');expect(first.headers['cache-control']).toBe('no-store');
   await controller.prepare();const index=await app.inject('/sitemap.xml');expect(index.statusCode).toBe(200);expect(dates(index.body)).toHaveLength(urls(index.body).length);
   for(const loc of urls(index.body))for(const method of ['GET','HEAD'] as const){const r=await app.inject({method,url:new URL(loc).pathname,headers:{host:'untrusted.invalid'}});expect(r.statusCode).toBe(200);expect(r.headers['content-type']).toBe('application/xml; charset=utf-8');expect(r.headers['cache-control']).toBe('public, max-age=0, s-maxage=3600');if(method==='GET'){expect(urls(r.body).length).toBeGreaterThan(0);expect(dates(r.body)).toHaveLength(urls(r.body).length);expect(r.body).not.toContain('untrusted.invalid');}else expect(r.body).toBe('');}
   const parallel=await Promise.all(urls(index.body).map(loc=>app.inject(new URL(loc).pathname)));
   expect(parallel.every(reply=>reply.statusCode===200&&urls(reply.body).length>0)).toBe(true);
   const count=f.queries.length;
   for(const url of ['/sitemaps/keywords/00.xml','/sitemaps/events/ff.xml','/sitemaps/videos/ff.xml','/sitemaps/videos/999.xml']){const r=await app.inject(url);expect(r.statusCode).toBe(404);expect(r.headers['cache-control']).toBe('no-store');}
   expect(f.queries).toHaveLength(count);
   for(const headers of [{cookie:''},{authorization:'Bearer opaque'},{'x-api-key':'opaque'},{rsc:'1'}])expect((await app.inject({url:'/sitemap.xml',headers})).headers['cache-control']).toBe('private, no-store');
   expect((await app.inject('/sitemap.xml?q=x')).statusCode).toBe(400);
  }finally{await app.close();}
 });
 it('warms at runtime startup and keeps /ready closed until publication even when only cached-index children are requested',async()=>{
  let resolve!:()=>void;const f=fixture({videos:[video(1)]});f.setWait(new Promise(r=>{resolve=r;}));const app=buildApp({reader:f.reader,sitemapWarmup:true,clock:()=>new Date(NOW)});
  try{
   expect((await app.inject('/sitemaps/videos/1.xml')).statusCode).toBe(503);expect(f.queries.length).toBe(1);
   expect((await app.inject('/ready')).statusCode).toBe(503);
   resolve();f.setWait();
   let ready=503;for(let n=0;n<30&&ready!==200;n++){await new Promise(r=>setTimeout(r,10));ready=(await app.inject('/ready')).statusCode;}
   expect(ready).toBe(200);const child=await app.inject('/sitemaps/videos/1.xml');expect(child.statusCode).toBe(200);expect(urls(child.body)).toHaveLength(1);
  }finally{await app.close();}
 });
 it('logs bounded preparation failure codes without SQL/messages and preserves cold schema failure as 500',async()=>{
  const f=fixture();f.setFailure(new DataQueryFailed('ER_BAD_FIELD_ERROR'));const records:unknown[]=[];const app=Fastify();const controller=registerSitemaps(app,f.reader,{...options,onDiagnostic:r=>records.push(r)});
  try{
   await expect(controller.prepare()).rejects.toMatchObject({driverCode:'ER_BAD_FIELD_ERROR'});expect(controller.ready()).toBe(false);
   const r=await app.inject('/sitemap.xml');expect(r.statusCode).toBe(500);expect(r.headers['cache-control']).toBe('no-store');expect(r.body).not.toContain('ER_BAD_FIELD_ERROR');
   expect(records).toEqual([expect.objectContaining({code:'SITEMAP_PREPARATION_FAILED',reason:'ER_BAD_FIELD_ERROR'})]);expect(JSON.stringify(records)).not.toContain('SELECT');
  }finally{await app.close();}
 });
 it('keeps failed preparations sanitized and no-store without repeatedly scanning the source',async()=>{
  const f=fixture();f.setFailure(new DataSourceUnavailable());const app=Fastify();const controller=registerSitemaps(app,f.reader,{...options,onDiagnostic:()=>{}});
  try{expect((await app.inject('/sitemap.xml')).statusCode).toBe(503);await tick();const reads=f.queries.length;const r=await app.inject('/sitemap.xml');expect(r.statusCode).toBe(503);expect(r.body).toBe('{"error":"Sitemap unavailable."}');expect(r.headers['cache-control']).toBe('no-store');expect(f.queries).toHaveLength(reads);}finally{await app.close();}
 });
});
