import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import mysql from 'mysql2/promise';
import {assertTestDatabaseUrl} from '../../shared/test-database.js';
import {buildApp} from '../src/app.js';
const url=process.env.TEST_DATABASE_URL?assertTestDatabaseUrl(process.env.TEST_DATABASE_URL):undefined;
const uid=986901,uids=[uid,uid+1],ids=['AggLiveA001','AggLivea001','AggZero0001','AggBulk0001'],stamp='2024-03-12 18:00:00',selection='[[986901],[],[]]';
describe.skipIf(!url)('live aggregate parity on MariaDB',()=>{
 let db:Awaited<ReturnType<typeof mysql.createConnection>>,cachePk:number;const app=buildApp({databaseUrl:url,dataset:'fixture',clock:()=>new Date('2024-03-12T10:00:00Z')});
 const clear=async()=>{for(const id of ids)for(const table of ['urt_video_live_log','urt_video','urt_show_video_live'])await db.execute(`DELETE FROM ${table} WHERE BINARY videoId=BINARY ?`,[id]);for(const id of uids)for(const table of ['urt_count','urt_channel'])await db.execute(`DELETE FROM ${table} WHERE u_id=?`,[id]);if(cachePk)await db.execute('DELETE FROM urt_show_live_tag_date WHERE pk=?',[cachePk]);await db.execute('DELETE FROM ts_live_tag_cache_lineage WHERE selection_key=?',[selection]);};
 beforeAll(async()=>{db=await mysql.createConnection(url!);await clear();for(const[i,id]of uids.entries()){await db.execute('INSERT INTO urt_channel(u_id,ctime,youtube_id,title)VALUES(?,?,?,?)',[id,stamp,'AGG_'+id,'Aggregate '+i]);await db.execute('INSERT INTO urt_count(u_id,ctime,tags)VALUES(?,?,?)',[id,stamp,i?'[986901][6]':'[986901][3][3]']);}
 for(const[id,date,peak,sample]of [[ids[0],'2024-03-12',10,100],[ids[0],'2024-03-12',20,90],[ids[0],'2024-03-11',70,80],[ids[0],'2024-03-06',14,20],[ids[1],'2024-03-12',80,200],[ids[2],'2024-03-12',null,0],[ids[0],'2024-03-10',0,5000]] as const)await db.execute('INSERT INTO urt_video_live_log(videoId,u_id,the_date,ctime,max_current,log_json)VALUES(?,?,?,?,?,?)',[id,id===ids[1]?uid+1:uid,date,stamp,peak,JSON.stringify({'17:00':sample,'17:30':sample})]);
 const[r]=await db.execute<mysql.ResultSetHeader>('INSERT INTO urt_show_live_tag_date(ctime,mtime,the_date,tagid,tag_or,tag_not,hour_result)VALUES(?,?,?,?,?,?,?)',[stamp,stamp,'2024-03-11',String(uid),'','',JSON.stringify({'17':{views:300,count:8},'18':{views:0,videos:0}})]);cachePk=r.insertId;
 });
 afterAll(async()=>{await app.close();if(db){await clear();await db.end();}});
 it('channels preserve stored row aggregation and rank by total rather than single peak or source sample',async()=>{const r=await app.inject('/api/v1/live/channels?tagid=986901&from=2024-03-11&to=2024-03-12');expect(r.statusCode).toBe(200);const rows=r.json().data.rows;expect(rows.map((r:any)=>r.total)).toEqual([100,80]);expect(rows[0]).toMatchObject({observations:3,peak:70,peakDate:'2024-03-11'});expect(rows[0].peakVideo.href).toBe('/videos/'+ids[0]);expect(r.json().meta.coverage.source).toBe('stored-log-row-peaks');});
 it('channel peaks break ties by latest date then source row without dropping duplicate observations',async()=>{
  const added:number[]=[];
  try{
   for(const id of [ids[0],ids[2]]){const[r]=await db.execute<mysql.ResultSetHeader>('INSERT INTO urt_video_live_log(videoId,u_id,the_date,ctime,max_current)VALUES(?,?,?,?,?)',[id,uid,'2024-03-12',stamp,70]);added.push(r.insertId);}
   const r=await app.inject('/api/v1/live/channels?tagid=986901&from=2024-03-11&to=2024-03-12');
   expect(r.statusCode).toBe(200);expect(r.json().data.rows[0]).toMatchObject({total:240,observations:5,peak:70,peakDate:'2024-03-12',peakVideo:{value:ids[2],href:'/videos/'+ids[2]}});
  }finally{for(const pk of added)await db.execute('DELETE FROM urt_video_live_log WHERE pk=?',[pk]);}
 });
 it('channel search and display use the latest byte-exact title once without multiplying log sums',async()=>{
  try{
   for(const[i,id]of ids.slice(0,2).entries())await db.execute('INSERT INTO urt_video(ctime,u_id,id,publishedAt,channelId,title,thumbnails,channelTitle,playlistId,position,videoId,description)VALUES(?,?,?,?,?,?,?,?,?,0,?,?)',[stamp,uids[i],id,stamp,'AGG_FIXTURE','Aggregate rawfallback '+i,'','Raw channel '+i,'fixture',id,'']);
   for(const[pk,id,title]of [[9869011,ids[0],'Aggregate obsolete'],[9869012,ids[0],'Aggregate selected latest'],[9869013,ids[1],'Aggregate lower latest']] as const)await db.execute('INSERT INTO urt_show_video_live(pk_live,v_pk,ctime,videoId,u_id,publishedAt,channelId,channelTitle,title,thumbnails,description)VALUES(?,0,?,?,?,?,?,?,?,?,?)',[pk,stamp,id,id===ids[0]?uid:uid+1,stamp,'AGG_FIXTURE','Display channel',title,'','']);
   const base='/api/v1/live/channels?tagid=986901&from=2024-03-11&to=2024-03-12';
   for(const suffix of ['', '&q=latest']){const r=await app.inject(base+suffix);expect(r.statusCode).toBe(200);expect(r.json().data.rows.map((row:any)=>[row.total,row.observations,row.peakVideo.value])).toEqual([[100,3,'Aggregate selected latest'],[80,1,'Aggregate lower latest']]);}
   for(const q of ['obsolete','rawfallback'])expect((await app.inject(base+'&q='+q)).json().data.rows).toEqual([]);
   const selected=await app.inject(base+'&q=selected');expect(selected.json().data.rows).toHaveLength(1);expect(selected.json().data.rows[0]).toMatchObject({total:100,observations:3});
   // A channel-name match includes every positive observation for that channel.
   const channel=await app.inject(base+'&q=Aggregate%200');expect(channel.json().data.rows[0]).toMatchObject({total:100,observations:3});expect(channel.json().data.rows).toHaveLength(1);
   await db.execute('DELETE FROM urt_show_video_live WHERE BINARY videoId=BINARY ?',[ids[0]]);
   const fallback=await app.inject(base+'&q=rawfallback');expect(fallback.statusCode).toBe(200);expect(fallback.json().data.rows).toHaveLength(1);expect(fallback.json().data.rows[0]).toMatchObject({total:100,peakVideo:{value:'Aggregate rawfallback 0'}});
  }finally{for(const id of ids.slice(0,2))for(const table of ['urt_video','urt_show_video_live'])await db.execute(`DELETE FROM ${table} WHERE BINARY videoId=BINARY ?`,[id]);}
 });
 it('hour matrix uses exact-filter cache per date and deduplicated byte-exact source fallback with true zeros',async()=>{const r=await app.inject('/api/v1/live/hours?tagid=986901&from=2024-03-11&to=2024-03-12');expect(r.statusCode).toBe(200);const d=r.json().data;expect(d.rows).toHaveLength(24);expect(d.rows[17]).toMatchObject({'2024-03-11':300,'2024-03-12':300,total:600});expect(d.rows[18]).toMatchObject({'2024-03-11':0,'2024-03-12':null});expect(d.rows[0]['2024-03-11']).toBeNull();expect(d.sections[0].rows[1]).toMatchObject({videos:3,observedHours:1,source:'來源取樣'});const count=await app.inject('/api/v1/live/hours?tagid=986901&from=2024-03-11&to=2024-03-12&type=count');expect(count.json().data.rows[17]).toMatchObject({'2024-03-11':8,'2024-03-12':3});});
 it('daily trend uses positive stored rows, exact groups and a disclosed7day divisor with warmup',async()=>{const r=await app.inject('/api/v1/live/trends/daily?from=2024-03-12&to=2024-03-12&today=1');expect(r.statusCode).toBe(200);const d=r.json().data;expect(d.series[0].points).toEqual([{time:'2024-03-12',value:16}]);expect(d.rows[0]).toMatchObject({total:30,observations:2,observedDays:1});expect(d.sections[0].rows[0]).toMatchObject({minDays:3,maxDays:3,partialWindows:1});expect(d.series[2].points[0].value).toBeNull();const count=await app.inject('/api/v1/live/trends/daily?from=2024-03-12&to=2024-03-12&type=count_videos&today=1');expect(count.json().data.series[0].points[0].value).toBe(1);});
 it('daily chart optionally excludes end date while summaries always include it',async()=>{const base='/api/v1/live/trends/daily?from=2024-03-11&to=2024-03-12';const a=(await app.inject(base)).json().data,b=(await app.inject(base+'&today=1')).json().data;expect(a.series[0].points).toHaveLength(1);expect(b.series[0].points).toHaveLength(2);expect(a.rows[0].total).toBe(100);expect(b.rows[0].total).toBe(100);});
 it('pending lineage blocks raw fallback even when cache row is absent; a published unknown-view count does not (Laravel counted unknown as 0)',async()=>{try{await db.execute('INSERT INTO ts_live_tag_cache_lineage(selection_key,the_date,vocabulary_version,coverage,rule_version,status,generated_at,unknown_view_videos)VALUES(?,?,?,?,?,?,?,?)',[selection,'2024-03-10','fixture','fixture','fixture','pending',stamp,0]);let r=await app.inject('/api/v1/live/hours?tagid=986901&from=2024-03-10&to=2024-03-10');expect(r.statusCode).toBe(200);expect(r.json().data.rows[17]['2024-03-10']).toBeNull();expect(r.json().meta.coverage).toMatchObject({sourceDates:0,withheldDates:['2024-03-10']});
  await db.execute("UPDATE ts_live_tag_cache_lineage SET status='published',unknown_view_videos=1 WHERE selection_key=?",[selection]);r=await app.inject('/api/v1/live/hours?tagid=986901&from=2024-03-10&to=2024-03-10');expect(r.statusCode).toBe(200);expect(r.json().meta.coverage.withheldDates).toEqual([]);}finally{await db.execute('DELETE FROM ts_live_tag_cache_lineage WHERE selection_key=?',[selection]);}});
 it('SQL aggregates exclude many zero rows and preserve more than20k positive repeated source rows without transfer truncation',async()=>{try{
  await db.execute('INSERT INTO urt_video_live_log(videoId,u_id,the_date,ctime,max_current) SELECT ?,?,?,?,0 FROM seq_1_to_20001',[ids[3],uid,'2024-03-12',stamp]);
  const base='/api/v1/live/trends/daily?from=2024-03-12&to=2024-03-12&today=1';const zero=await app.inject(base);expect(zero.statusCode).toBe(200);expect(zero.json().data.rows[0].total).toBe(30);
  await db.execute('UPDATE urt_video_live_log SET max_current=1 WHERE BINARY videoId=BINARY ?',[ids[3]]);
  const positive=await app.inject(base);expect(positive.statusCode).toBe(200);expect(positive.json().data.rows[0]).toMatchObject({total:20031,observations:20003});expect(positive.json().meta.coverage.aggregateRows).toBeLessThan(20);
  const channel=await app.inject('/api/v1/live/channels?tagid=986901&date=2024-03-12');expect(channel.statusCode).toBe(200);expect(channel.json().data.rows[0]).toMatchObject({total:20031,observations:20003,peak:20});
 }finally{await db.execute('DELETE FROM urt_video_live_log WHERE BINARY videoId=BINARY ?',[ids[3]]);}},20000);

});
