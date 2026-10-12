import {sourceMap,sourceAliases} from '../src/reports/source-map.js';
import {registerEventExtra} from '../src/reports/event-extra.js';
import type {ReportService} from '../src/reports/service.js';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import mysql from 'mysql2/promise';
import {assertTestDatabaseUrl} from '../../shared/test-database.js';
import {buildApp} from '../src/app.js';
import {hourlyPeak,metricMap} from '../src/reports/live-extra.js';
const url=process.env.TEST_DATABASE_URL?assertTestDatabaseUrl(process.env.TEST_DATABASE_URL):undefined;
describe('additional report boundaries',()=>{
 it('source aliases preserve exact keys and reject ambiguous decoded identities',()=>{
  expect(sourceMap('broken')).toBeNull();expect(sourceAliases({'a%20b':1,'a b':3})['a b']).toBe(3);expect(sourceAliases({'a%20b':1,'a+b':2})['a b']).toBeUndefined();expect(metricMap({data:{'01':5}})).toEqual({data:{'01':5}});
 });

 it('event people and wall preserve every case-distinct cited video',async()=>{
  const handlers=new Map<string,Function>();registerEventExtra((path,handler)=>handlers.set(path,handler),{aiEvent:async()=>({title:'合成議題',dailyId:19,videos:[],analyses:[{id:23,type:'people',updatedAt:null,result:{supporting_persons:[{person:'測試人物',videos:[{video_id:'ReportAa001'},{video_id:'Reportaa001'}]}]}},{id:24,type:'summary',updatedAt:null,result:{events:[{event:'合成議題',fact:[{video_id:'ReportFact1',headline:'測試引文'}],opinion:[]}]}}]})} as unknown as ReportService);
  const people=await handlers.get('/ai/events/:id/people')!({id:'1'},{});expect(people.rows).toHaveLength(2);
  const wall=await handlers.get('/ai/events/:id/wall')!({id:'1'},{});expect(wall.streams.map((s:any)=>s.id)).toEqual(['ReportAa001','Reportaa001','ReportFact1']);
 });

 it('extracts measured peaks and validates fixed wall playlists',async()=>{
  expect(hourlyPeak({a:null,b:'bad',c:-1})).toBeNull();expect(hourlyPeak({'01':0,'02':4})).toBe(4);expect(metricMap({data:{A:{'01':5}}})).toEqual({A:{'01':5}});
  const app=buildApp({databaseUrl:''});try{const r=await app.inject('/api/v1/live/walls/news?type=2');expect(r.statusCode).toBe(200);expect(r.json().data.streams[0]).toMatchObject({id:'quwqlazU-c8',label:'公視新聞'});expect(r.json().meta.updatedAt).toBeNull();expect((await app.inject('/api/v1/live/walls/nope')).statusCode).toBe(404);expect((await app.inject('/api/v1/live/walls/news?type=8')).statusCode).toBe(400);}finally{await app.close();}
 });
});
describe.skipIf(!url)('additional report MariaDB parity',()=>{
 const app=buildApp({databaseUrl:url,clock:()=>new Date('2023-01-02T10:00:00Z'),dataset:'fixture'});
 let db:mysql.Connection;const inserted:{table:string;pk:number}[]=[];
 const insert=async(table:string,fields:Record<string,string|number|null>)=>{const [r]=await db.execute<mysql.ResultSetHeader>(`INSERT INTO ${table} (${Object.keys(fields).join(',')}) VALUES (${Object.keys(fields).map(()=>'?').join(',')})`,Object.values(fields));inserted.push({table,pk:r.insertId});};
 beforeAll(async()=>{
  db=await mysql.createConnection(url!);const stamp='2023-01-02 18:00:00';
  await insert('urt_channel',{u_id:982001,ctime:stamp,mtime:stamp,youtube_id:'UCReportFixture',title:'報表測試'});await insert('urt_count',{u_id:982001,ctime:stamp,tags:'[982001]'});
  for(const [id,peak,json] of [['ReportAa001',30,{'01:10':10,'01:20':30,'02:00':0,'88:88':999}],['Reportaa001',99,{'01:10':99}],['ReportNoLog',null,null]] as const){
   await insert('urt_video',{ctime:stamp,mtime:stamp,u_id:982001,id,publishedAt:stamp,channelId:'UCReportFixture',title:'報表測試 '+id,thumbnails:'',channelTitle:'報表測試',playlistId:'PLReport',position:0,videoId:id,description:'詞彙測試',viewCount:100});
   await insert('urt_video_live',{ctime:stamp,mtime:stamp,u_id:982001,publishedAt:stamp,videoId:id,actualStartTime:'2022-12-31 00:00:00',concurrentViewers:20,max_current:50});
   if(json)await insert('urt_video_live_log',{ctime:stamp,mtime:stamp,u_id:982001,videoId:id,the_date:'2023-01-02',max_current:peak,log_json:JSON.stringify(json)});
  }
  for(const [tag,date,value]of [['982001','2023-01-01',10],['982001','2023-01-02',20],['53','2023-01-02',25],['3','2023-01-02',50]]as const){
   await insert('urt_show_live_tag_date',{ctime:stamp,mtime:stamp,tagid:tag,tag_or:'',tag_not:'',the_date:date,tags_views:JSON.stringify({data:{測試詞:{'01':value,'02':value/2}}}),tags_video:JSON.stringify({測試詞:{'01':2}}),hour_result:JSON.stringify({'01':{views:value,count:2}})});
   await insert('urt_show_tag_date',{ctime:stamp,mtime:stamp,tagid:tag,tag_or:'',tag_not:'',the_date:date,tags_views:JSON.stringify({測試詞:value,蔣萬安:value,沈伯洋:value}),tags_result:JSON.stringify({測試詞:value/10})});
  }
  for(const tag of ['測試詞','測試詞',''])await insert('tag_group',{ctime:stamp,latest_time:stamp,group_name:'ReportFixtureGroup',tag});
 });
 afterAll(async()=>{await app.close();for(const row of inserted.reverse()){const col=['urt_channel','urt_count'].includes(row.table)?'u_id':'pk';await db.execute(`DELETE FROM ${row.table} WHERE ${col}=?`,[col==='u_id'?982001:row.pk]);}await db.end();});
 const get=async(path:string)=>{const r=await app.inject(encodeURI(path));expect(r.statusCode,r.body).toBe(200);return r.json().data;};
 it('keyword ranking uses daily maxima and log weighting',async()=>{const d=await get('/api/v1/live/tags?tagid=982001&from=2023-01-01&to=2023-01-03');expect(d.rows[0].total).toBe(30);expect(d.rows[0].score).toBeCloseTo((Math.log(10)+Math.log(20))*100,0);expect(d.rows[0]['2023-01-03']).toBeNull();});
 it('hour matrices retain missing hours and groups',async()=>{const d=await get('/api/v1/live/groups/media/hours?date=2023-01-02');expect(d.rows[1]['旺中']).toBe(25);expect(d.rows[0]['旺中']).toBeNull();expect(d.rows[1].TVBS).toBeNull();});
 it('keyword and group weekly live use peak sums with coverage',async()=>{for(const path of ['/api/v1/keywords/測試詞/live/trends','/api/v1/groups/ReportFixtureGroup/live']){const d=await get(path+'?from=2023-01-02&to=2023-01-02');expect(d.rows.filter((r:any)=>r.group==='泛藍')).toHaveLength(1);expect(d.rows.find((r:any)=>r.group==='泛藍')).toMatchObject({value:50,observedDays:1});}});
 it('continuous live keeps missing historical values null',async()=>{const d=await get('/api/v1/live/continuous?tagid=982001&from=2023-01-02&to=2023-01-02');const e=d.rows.find((r:any)=>r.video.value.endsWith('ReportNoLog'));expect(d.rows).toHaveLength(3);expect(d.rows.find((r:any)=>r.video.value.endsWith('ReportAa001')).periodPeak).toBe(30);expect(d.rows.find((r:any)=>r.video.value.endsWith('Reportaa001')).periodPeak).toBe(99);expect(e.current).toBe(20);expect(e.periodAverage).toBeNull();expect(e.periodPeak).toBeNull();expect(e.observedDays).toBe(0);});
 it('video trend uses exact case and excludes malformed times',async()=>{const a=await get('/api/v1/live/videos/ReportAa001/trend'),b=await get('/api/v1/live/videos/Reportaa001/trend');expect(a.series[0].points.map((r:any)=>r.value)).toEqual([30,0]);expect(b.series[0].points[0].value).toBe(99);expect(a.series[1].points[0].value).toBe(30);});
 it('tag comparison applies x100 scale and tracks coverage',async()=>{const d=await get('/api/v1/tags/compare?tags=測試詞&tagid=982001&type=tags_result&from=2023-01-02&to=2023-01-02');expect(d.rows[0]['series_0_0']).toBe(300);expect(d.rows[0]['series_0_0：日數']).toBe(2);const e=await get('/api/v1/tags/compare?tags=測試詞&tagid=982099&from=2023-01-02&to=2023-01-02');expect(e.rows[0]['series_0_0']).toBeNull();});
 it('prompt preview uses shared readonly AI planner and explicit validation',async()=>{const d=await get('/api/v1/channels/982001/prompt?date=2023-01-02');expect(d.sourceCount).toBe(3);expect(d.promptVersion).toBeTruthy();expect(d.prompt).toContain('ReportAa001');expect(d.prompt).toContain('Reportaa001');const week=await get('/api/v1/channels/982001/prompt?type=week');expect(week.promptVersion).toBeTruthy();expect((await app.inject('/api/v1/ai/days/2023-01-02/all/prompt?from=2023-01-01&to=2023-01-02')).statusCode).toBe(400);const daily=await get('/api/v1/ai/days/2023-01-02/all/prompt');expect(daily.blocked).toBeTruthy();});
 it('mayor person day validates date and preserves missing source buckets',async()=>{const d=await get('/api/v1/mayor/cities/taipei/people/蔣萬安/days/2023-01-02');expect(d.rows[0].views).toBe(50);expect(d.rows[1].views).toBeNull();expect(d.rows[0].change).toBeNull();expect((await app.inject('/api/v1/mayor/cities/taipei/people/test?type=bogus')).statusCode).toBe(400);expect((await app.inject('/api/v1/mayor/cities/taipei/people/test/days/2023-02-30')).statusCode).toBe(400);});
 it('mayor shares use raw mention proportions',async()=>{const d=await get('/api/v1/mayor/cities/taipei?from=2023-01-02&to=2023-01-02');expect(d.rows[0]['蔣萬安：占比']).toBe(50);expect(d.rows[0]['沈伯洋：占比']).toBe(50);});
 it('top-level aliases and grouptrends have concrete readers',async()=>{for(const p of ['/api/v1/tags/videos','/api/v1/tags/comments?min=0','/api/v1/tags/cloud','/api/v1/tags/days?from=2023-01-02&to=2023-01-02','/api/v1/tags/trends?from=2023-01-02&to=2023-01-02','/api/v1/tags/982001/live/videos?from=2023-01-02&to=2023-01-02','/api/v1/keywords/測試詞/groups/trends?from=2023-01-02&to=2023-01-02'])await get(p);});
});
