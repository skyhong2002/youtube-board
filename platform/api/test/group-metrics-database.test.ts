import {describe,it,expect,beforeAll,beforeEach,afterAll} from 'vitest';
import mysql from 'mysql2/promise';
import {assertTestDatabaseUrl} from '../../shared/test-database.js';
import {buildApp} from '../src/app.js';
const url=process.env.TEST_DATABASE_URL?assertTestDatabaseUrl(process.env.TEST_DATABASE_URL):undefined;
describe.skipIf(!url)('group metrics and trend date selectors on MariaDB',()=>{
 const app=buildApp({databaseUrl:url,dataset:'fixture',clock:()=>new Date('2210-01-05T00:10:00Z')}),selection='[[53],[],[]]';let db:Awaited<ReturnType<typeof mysql.createConnection>>;
 const cleanup=async()=>{await db.query('DELETE FROM urt_show_tag_date WHERE pk BETWEEN 977001 AND 977099');await db.query("DELETE FROM ts_tag_cache_lineage WHERE selection_key=? AND the_date BETWEEN '2210-01-01' AND '2210-01-05'",[selection]);};
 beforeAll(async()=>{db=await mysql.createConnection(url!);});beforeEach(async()=>{await cleanup();for(const [pk,date,views,videos]of [[977001,'2210-01-01',999,99],[977002,'2210-01-02',10,1],[977003,'2210-01-03',null,2],[977004,'2210-01-05',30,3],[977005,'2210-01-02',20,4]]as const)await db.execute('INSERT INTO urt_show_tag_date(pk,ctime,the_date,tagid,tag_or,tag_not,total_views,count_videos) VALUES(?,?,?,?,?,?,?,?)',[pk,'2210-01-05 08:10:00',date,'53','','',views,videos]);});
 afterAll(async()=>{await app.close();if(db){await cleanup();await db.end();}});
 const get=async(path:string)=>{const r=await app.inject('/api/v1/'+path);expect(r.statusCode,r.body).toBe(200);return r.json();};
 it('ranking excludes start, uses latest record, exposes medians/known days without zero-filled gaps',async()=>{
  const r=await get('groups/media/ranking?from=2210-01-01&to=2210-01-05'),row=r.data.rows.find((r:any)=>r.group==='旺中');expect(row).toMatchObject({views:50,viewsMedian:25,viewsKnownDays:2,videos:9,videosMedian:3,videosKnownDays:3,observedDays:3,requestedDays:4});expect(r.meta.coverage).toMatchObject({startBoundary:'exclusive',requestedDays:4,medianScope:'recorded-values-only'});expect(r.data.rows.find((r:any)=>r.group==='TVBS')).toMatchObject({views:null,viewsMedian:null,viewsKnownDays:0});
 });
 it('group year starts Jan2 while tag year includes Jan1 and average requires paired known fields',async()=>{
  const group=await get('groups/media/trends?days=year&type=videos');expect(group.data.rows[0].date).toBe('2210-01-02');expect(group.data.series[0].unit).toBe('部');expect(group.meta.coverage.todayOffset).toBe(0);
  const tag=await get('tags/53/trends?from=year&type=views_video');expect(tag.data.rows[0].date).toBe('2210-01-01');expect(tag.data.rows.at(-1).date).toBe('2210-01-04');expect(tag.data.rows.at(-1)).toMatchObject({views:1019,videos:105,observedDays:3,viewsKnownDays:2,videosKnownDays:3,average:null});expect(tag.meta.coverage).toMatchObject({todayOffset:1,startBoundary:'inclusive',metric:'average'});
 });
 it('explicit offset/blank controls and legacy aliases keep exact selected endpoints',async()=>{
  const group=await get('groups/media/trends?days=1&today=1&type=tags_video');expect(group.data.rows.map((r:any)=>r.date)).toEqual(['2210-01-04']);
  const tag=await get('tags/53/trends?days=1&today=0&type=count_videos');expect(tag.data.rows.map((r:any)=>r.date)).toEqual(['2210-01-04','2210-01-05']);
  expect((await get('groups/media/ranking?days=&from=&to=&today=')).meta.coverage.todayOffset).toBe(0);
  for(const path of ['groups/media/trends?days=year&type=no','tags/53/trends?days=year&type=no','groups/media/ranking?days=367','tags/53/trends?today=-1'])expect((await app.inject('/api/v1/'+path)).statusCode).toBe(400);
 });
 it('publication guard removes a withheld latest day rather than using an older revision',async()=>{
  await db.execute('INSERT INTO ts_tag_cache_lineage(selection_key,the_date,vocabulary_version,coverage,rule_version,unknown_view_videos,status,generated_at) VALUES(?,?,?,?,?,?,?,?)',[selection,'2210-01-02','fixture','fixture','fixture',0,'pending','2210-01-05 00:00:00']);
  const r=await get('groups/media/ranking?from=2210-01-01&to=2210-01-05');expect(r.data.rows.find((r:any)=>r.group==='旺中')).toMatchObject({views:30,viewsMedian:30,viewsKnownDays:1,videos:5,videosMedian:2.5});expect(r.meta.coverage.withheldGroupDays).toBe(1);
 });
 it('numeric category year trends ignore unrelated large JSON payloads',async()=>{
  await db.execute("UPDATE urt_show_tag_date SET tags_result=REPEAT('x',4194304) WHERE pk BETWEEN 977001 AND 977099");
  const r=await get('tags/53/trends?days=year');expect(r.data.rows.at(-1)).toMatchObject({views:1019,videos:105});
 });
 it('coverage excludes unused withheld boundary rows and distinguishes withheld windows from absent caches',async()=>{
  const pending=async(date:string)=>db.execute('INSERT INTO ts_tag_cache_lineage(selection_key,the_date,vocabulary_version,coverage,rule_version,unknown_view_videos,status,generated_at) VALUES(?,?,?,?,?,?,?,?)',[selection,date,'fixture','fixture','fixture',0,'pending','2210-01-05 00:00:00']);
  await pending('2210-01-01');
  expect((await get('groups/media/ranking?from=2210-01-01&to=2210-01-05')).meta.coverage.withheldGroupDays).toBe(0);
  const before=await get('groups/media/trends?from=2210-01-07&to=2210-01-08');expect(before.meta.coverage.withheldGroupDays).toBe(0);expect(before.data.rows[0]).toMatchObject({'旺中':50,'TVBS':null});
  await pending('2210-01-02');const after=await get('groups/media/trends?from=2210-01-07&to=2210-01-08');expect(after.data.rows[0]['旺中']).toBe(30);expect(after.data.sections.find((s:any)=>s.key==='window-coverage').rows.find((r:any)=>r.group==='旺中')).toMatchObject({date:'2210-01-08',observedDays:2,knownDays:1,withheldDays:1,missingDays:4});
 });

});
