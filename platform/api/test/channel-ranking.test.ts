import {beforeAll,beforeEach,afterAll,describe,it,expect} from 'vitest';
import mysql from 'mysql2/promise';
import {channel} from '../src/reports/normalize.js';
import {buildApp} from '../src/app.js';
import {CHANNEL_SORTS} from '../../shared/channel-ranking.js';
import {assertTestDatabaseUrl} from '../../shared/test-database.js';

it('channel growth preserves the exact legacy formula, signed deltas, null and safe-integer boundaries',()=>{
 expect(channel({view_week:500,view_month:1000,video_week:5,sub_month:-3,video_month:-2,views_pred_month:1200},new Map())).toMatchObject({legacyGrowthPercent:6.25,averageWeeklyViewsPerVideo:100,monthlySubscribers:-3,monthlyVideos:-2,monthlyEstimateGap:200});
 for(const row of [{},{view_week:5,view_month:0,video_week:0},{view_week:null,view_month:100,video_week:2},{view_week:'9007199254740993',view_month:100,video_week:2}])expect(channel(row,new Map())).toMatchObject({legacyGrowthPercent:null,averageWeeklyViewsPerVideo:null});
 expect(channel({view_week:-100,view_month:100,video_week:2,views_pred_month:0},new Map())).toMatchObject({legacyGrowthPercent:-31.25,averageWeeklyViewsPerVideo:-50,monthlyEstimateGap:-100});
 expect(channel({view_month:-Number.MAX_SAFE_INTEGER,views_pred_month:Number.MAX_SAFE_INTEGER},new Map()).monthlyEstimateGap).toBeNull();
 expect(channel({sub_month:'9007199254740993',video_month:null},new Map())).toMatchObject({monthlySubscribers:null,monthlyVideos:null});
});
const raw=process.env.TEST_DATABASE_URL,url=raw?assertTestDatabaseUrl(raw):undefined;
describe.skipIf(!url)('channel ranking on isolated MariaDB',()=>{
 const ids=[979001,979002,979003,979004,979005],tag=979001,other=979002;
 let db:Awaited<ReturnType<typeof mysql.createConnection>>;const app=buildApp({databaseUrl:url,dataset:'fixture'});
 const cleanup=async()=>{await db.query('DELETE FROM urt_count WHERE u_id IN (?)',[ids]);await db.query('DELETE FROM urt_channel WHERE u_id IN (?)',[ids]);await db.query('DELETE FROM urt_tag WHERE tag_id IN (?)',[[tag,other]]);};
 beforeAll(async()=>{db=await mysql.createConnection(url!);});
 beforeEach(async()=>{await cleanup();
  await db.query("INSERT INTO urt_tag(tag_id,tag_name,ctime) VALUES (?,?,'2031-01-01 00:00:00'),(?,?,'2031-01-01 00:00:00')",[tag,'channel-ranking-fixture',other,'channel-ranking-other']);
  for(const [i,id]of ids.entries())await db.execute('INSERT INTO urt_channel(u_id,title,youtube_id,flag_del,viewCount,subscriberCount,videoCount,ctime) VALUES(?,?,?,?,?,?,?,?)',[id,'channel-ranking-fixture-'+i,'UCRanking'+id,i===3?1:i===1?0:null,500,400,300,'2031-01-01 00:00:00']);
  const cols=CHANNEL_SORTS.map(([key])=>key);
  for(let i=0;i<4;i++){
   const values=cols.map((_,j)=>i===0?(j%2===0?10:30):i===1?(j%2===0?30:10):null);
   await db.execute(`INSERT INTO urt_count(u_id,${cols.join(',')},tags,mtime,ctime) VALUES(${Array(cols.length+4).fill('?').join(',')})`,[ids[i],...values,`[${tag}]${i===1?`[${other}]`:''}`,'2031-01-01 00:00:00','2031-01-01 00:00:00']);
  }
 });
 afterAll(async()=>{await app.close();if(db){await cleanup();await db.end();}});
 const get=async(path:string)=>{const r=await app.inject('/api/v1/'+path);expect(r.statusCode,r.body).toBe(200);return r.json().data;};
 it('all eleven metrics sort before pagination, preserve signed/null values and deterministic ties',async()=>{
  for(const [j,[column]]of CHANNEL_SORTS.entries()){
   const d=await get(`channels?q=channel-ranking-fixture&column=${column}&limit=1&offset=1`);
   // Directory-only channel uses source totals; derived metrics stay null.
   const expected=j<3?(j%2===0?ids[1]:ids[0]):(j%2===0?ids[0]:ids[1]);
   expect(d.rows[0].id,column).toBe(expected);expect(d.total).toBe(4);expect(d.ranking.column).toBe(column);
  }
  await db.execute('UPDATE urt_count SET view_week=-10 WHERE u_id=?',[ids[1]]);
  expect((await get('channels?q=channel-ranking-fixture&column=view_week')).rows.map((r:any)=>r.id)).toEqual([ids[0],ids[1],ids[2],ids[4]]);
  await db.execute('UPDATE urt_count SET view_week=30 WHERE u_id IN (?,?)',[ids[0],ids[1]]);
  expect((await get('channels?q=channel-ranking-fixture&column=view_week&limit=1&offset=1')).rows[0].id).toBe(ids[1]);
  await db.execute('UPDATE urt_count SET view_week=10 WHERE u_id=?',[ids[1]]);
 });
 it('directory and tag defaults differ, tag minimum semantics follow OR filters and all filters intersect',async()=>{
  const directory=await get('channels?q=channel-ranking-fixture'),tagged=await get(`tags/${tag}/channels`);
  expect((await get('channels?q=channel-ranking-fixture&min=0')).rows.map((r:any)=>r.id)).toEqual([ids[0],ids[1],ids[4]]);
  expect((await get(`channels?q=channel-ranking-fixture&or=${other}&min=20`)).rows.map((r:any)=>r.id)).toEqual([ids[1]]);
  expect((await get(`tags/${tag}/channels?column=viewCount`)).rows.map((r:any)=>r.id)).toEqual([ids[1],ids[0]]);
  for(const [path,coverage] of [[`tags/${tag}/channels?or=${other}&min=20`,{rankingColumn:'view_month',minimum:20,minimumMetric:'views',rankingScope:'tag'}],['channels?q=channel-ranking-fixture',{rankingColumn:'view_week',minimum:null,minimumMetric:'subscribers',rankingScope:'directory'}]] as const)expect((await app.inject('/api/v1/'+path)).json().meta.coverage).toEqual(coverage);
  expect(directory.ranking).toMatchObject({column:'view_week',scope:'directory',min:null});expect(directory.rows[0].id).toBe(ids[0]);
  expect(tagged.ranking).toEqual({column:'view_month',scope:'tag',min:0,minMetric:'subscribers'});expect(tagged.rows.map((r:any)=>r.id)).toEqual([ids[1],ids[0]]);
  expect((await get(`tags/${tag}/channels?min=20`)).rows.map((r:any)=>r.id)).toEqual([ids[0]]);
  const or=await get(`tags/${tag}/channels?or=${other}&min=20`);expect(or.rows.map((r:any)=>r.id)).toEqual([ids[1]]);expect(or.ranking.minMetric).toBe('views');
  expect((await get(`tags/${tag}/channels?tagid=${other}&not=${other}`)).total).toBe(0);
  expect((await get('channels?q=channel-ranking-fixture&column=&min=')).rows).toHaveLength(4);
 });
 it('profile preserves unavailable cache counters and provides monthly/estimated/derived metrics',async()=>{
  await db.execute('UPDATE urt_count SET view_week=500,view_month=1000,video_week=5,sub_month=-3,video_month=-2,views_pred_month=1200 WHERE u_id=?',[ids[0]]);
  const d=await get('channels/'+ids[0]);expect(d.channel).toMatchObject({monthlySubscribers:-3,monthlyVideos:-2,legacyGrowthPercent:6.25,averageWeeklyViewsPerVideo:100,monthlyEstimateGap:200});
  const missing=await get('channels/'+ids[2]);expect(missing.channel).toMatchObject({views:null,subscribers:null,videoCount:null,monthlySubscribers:null,estimatedMonthlyViews:null});
  const source=await get('channels/'+ids[4]);expect(source.channel).toMatchObject({views:500,subscribers:400,videoCount:300,weeklyViews:null});
  expect((await app.inject('/api/v1/channels/'+ids[3])).statusCode).toBe(404);
 });
 it('rejects invalid sorting and unsafe or malformed thresholds through the real HTTP layer',async()=>{
  for(const base of [`tags/${tag}/channels`,'channels'])for(const query of ['column=view_week&column=sub_week','min=1&min=2','column=bad','column=__proto__','column=view_week%20DESC','min=-1','min=1.5','min=9007199254740992','min=abc','or=no'])expect((await app.inject(`/api/v1/${base}?${query}`)).statusCode,query).toBe(400);
 });
});
