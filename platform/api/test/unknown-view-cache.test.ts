import {it,expect} from 'vitest';
import {MySqlDialect} from 'drizzle-orm/mysql-core';
import {buildApp} from '../src/app.js';
import {reportCacheKey} from '../../shared/report-cache-key.js';
/** Laravel cache builders add `viewCount ?? 0`; a TS publication that recorded unknown-view videos must
 * stay visible (not withheld) and expose the count to the page method notes. */
const clock=()=>new Date('2026-10-12T17:00:00Z'),dialect=new MySqlDialect();
async function request(path:string,respond:(sql:string,params:unknown[])=>any[]){const app=buildApp({clock,reader:{rows:async q=>{const compiled=dialect.sqlToQuery(q);return respond(compiled.sql,compiled.params);},close:async()=>{}}});try{return await app.inject(path);}finally{await app.close();}}
const lineage={status:'published',vocabulary_version:'v1',coverage:'observed-article-window',rule_version:'r1',window_closed:1,generated_at:'2026-10-13 08:00:00'};

it('tag days show a published day whose window had unknown-view videos and state the count',async()=>{
 const day={pk:7,ctime:'2026-10-12 08:00:00',mtime:'2026-10-12 08:00:00',the_date:'2026-10-12',count_channels:2,count_videos:3,total_views:900,tags_result:'{"颱風":"5.000"}',tags_video:'{"颱風":3}',tags_views:'{"颱風":900}'};
 const r=await request('/api/v1/tags/4/days?from=2026-10-12&to=2026-10-12&diff=0',sql=>{
  if(sql.includes('AS source_rows'))return[{source_rows:1,payload_bytes:60,largest:60}];
  if(sql.includes('information_schema'))return[{present:1}];
  if(sql.includes('ts_tag_cache_lineage'))return[{...lineage,the_date:'2026-10-12',unknown_view_videos:2,window_from:'2026-10-12',window_to:'2026-10-12'}];
  if(sql.includes('FROM `urt_show_tag_date`')||sql.includes('FROM urt_show_tag_date'))return[day];
  return[];
 });
 expect(r.statusCode,r.body).toBe(200);const body=r.json();
 expect(body.data.rows.map((x:any)=>x.term)).toEqual(['颱風']);
 expect(body.meta.coverage).toMatchObject({withheldDates:0,availableDates:1,unknownViewVideos:2});
 expect(body.data.notes.join('\n')).toContain('2 部影片尚無觀看數');
});

it('tag cloud and legacy tags_all show unknown-view publications instead of withholding them',async()=>{
 const periods=new Map([3,7].map(days=>[reportCacheKey({tagid:'4',tag_or:null,tag_not:null,days}),{days,unknown:days===3?1:5}]));
 const lineageFor=(params:unknown[])=>params.flatMap(key=>{const p=periods.get(String(key));return p?[{...lineage,cache_key:key,unknown_view_videos:p.unknown,window_from:new Date(Date.parse('2026-10-13')-(p.days-1)*86400000).toISOString().slice(0,10),window_to:'2026-10-13',window_closed:0}]:[];});
 const cloud=await request('/api/v1/tags/4/cloud?days=3',(sql,params)=>{
  if(sql.includes('information_schema'))return[{present:1}];
  if(sql.includes('ts_report_cache_lineage'))return lineageFor(params);
  if(sql.includes('AS payload_bytes'))return[{pk:params.includes(3)?1:2,payload_bytes:20}];
  if(sql.includes('AS words'))return[{pk:params[0],ctime:'2026-10-13 08:00:00',mtime:'2026-10-13 08:00:00',words:params[0]===1?'{"颱風":"9.000","地震":"1.000"}':'{"颱風":"1.000","地震":"7.000"}'}];
  return[];
 });
 expect(cloud.statusCode,cloud.body).toBe(200);const c=cloud.json();
 expect(c.meta.coverage).toMatchObject({shortStatus:'published',longStatus:'published',status:'published-comparable',shortUnknownViewVideos:1,longUnknownViewVideos:5});
 expect(c.data.rows.length).toBeGreaterThan(0);expect(c.data.notes.join('\n')).toMatch(/短期快取生成時有 1 部影片尚無觀看數[\s\S]*長期快取生成時有 5 部/);

 const legacy=await request('/api/tags_all.php',(sql,params)=>{
  if(sql.includes('information_schema'))return[{present:1}];
  if(sql.includes('ts_report_cache_lineage'))return[{...lineage,cache_key:reportCacheKey({data_name:'tags_all'}),unknown_view_videos:4,window_from:'2026-10-07',window_to:'2026-10-13',window_closed:0}];
  if(sql.includes('urt_show_data'))return[{pk:1,data_name:'tags_all',mtime:'2026-10-13 08:00:00',the_result:'{"颱風":{"video":2,"video_all":3,"views":100,"views_all":150}}'}];
  return[];
 });
 expect(legacy.statusCode,legacy.body).toBe(200);const l=legacy.json();
 expect(l.meta).toMatchObject({available:true,unknown_view_videos:4});expect(Object.keys(l.result)).toContain('颱風');
});
