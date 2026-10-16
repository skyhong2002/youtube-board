import {it,expect} from 'vitest';
import {buildApp} from '../src/app.js';
import {channelWeek} from '../src/legacy/channel.js';
import type {Reader,Row} from '../src/db/client.js';
const logs=[{ctime:'2031-12-01 00:00:00',mtime:'2032-01-15 09:00:00',thedata:JSON.stringify(Object.fromEntries(Array.from({length:46},(_,i)=>[new Date(Date.UTC(2031,11,1+i)).toISOString().slice(0,10),{view:10000+i*100,video:20+i}])))}];
const fixture=(rows:Row[]):Reader=>({rows:async<T extends Row>()=>rows as T[],close:async()=>{}});
const reader=fixture(logs);
it('trend modes use the same reviewed projection while preserving measured fields and source time',async()=>{
 const app=buildApp({reader,clock:()=>new Date('2032-01-15T02:00:00Z')});
 for(const [query,key]of [['','moving'],['each=1','pred'],['orig=1','orig'],['videos=1','videos']]){
  const response=await app.inject('/api/v1/channels/1/trends?from=2032-01-09&to=2032-01-15&'+query);
  expect(response.statusCode).toBe(200);const d=response.json().data;
  expect(d.rows.at(-1)).toMatchObject({date:'2032-01-15',views:14500,viewChange:100,videoChange:1,value:key==='videos'?1:100});
  expect(d.updatedAt).toBe('2032-01-15T01:00:00.000Z');
 }
 expect((await app.inject('/api/v1/channels/1/trends?mode=bogus')).statusCode).toBe(400);await app.close();
});
it('missing observations remain null and never claim an unobserved zero estimate',async()=>{
 const empty=fixture([{thedata:'{}'}]);
 const app=buildApp({reader:empty,clock:()=>new Date('2032-01-15T02:00:00Z')});
 const d=(await app.inject('/api/v1/channels/1/trends?days=1')).json().data;
 expect(d.rows[0]).toMatchObject({views:null,viewChange:null,estimate:null,movingEstimate:null,value:null});
 expect(d.metrics[0].value).toBe(0);await app.close();
});
it('a malformed or oversized monthly payload cannot generate unbounded derived reports',async()=>{
 const app=buildApp({reader:fixture([{thedata:'x'.repeat(8*1024*1024+1)}])});
 expect((await app.inject('/api/v1/channels/1/trends')).statusCode).toBe(422);await app.close();
});

it('keeps ISO years separate and never converts stalled cumulative counts or partial weeks into estimates',async()=>{
 expect(channelWeek('2031-12-29',true)).toBe('2032-1');expect(channelWeek('2031-01-01',true)).toBe('2031-1');
 const sparse=fixture([{thedata:JSON.stringify({'2032-01-01':{view:100},'2032-01-02':{view:100},'2032-01-03':{view:100},'2032-01-04':{view:200},'2032-01-05':{view:300}})}]);
 const app=buildApp({reader:sparse});const d=(await app.inject('/api/v1/channels/1/trends?from=2032-01-02&to=2032-01-05')).json().data;
 expect(d.rows[0]).toMatchObject({viewChange:0,estimate:null,movingEstimate:null});expect(d.rows.at(-1)).toMatchObject({estimate:100,movingEstimate:null,movingDays:1});await app.close();
});
it('display start does not shorten a fixed endpoint projection and explicit modes override legacy flags',async()=>{
 const app=buildApp({reader});
 for(const from of ['2031-12-16','2032-01-09']){const d=(await app.inject('/api/v1/channels/1/trends?from='+from+'&to=2032-01-15&mode=observed&videos=1')).json().data;expect(d.rows.at(-1)).toMatchObject({value:100,estimate:100,movingEstimate:100});}
 expect((await app.inject('/api/v1/channels/1/trends?from=2032-01-15&to=2032-01-15&videos=1&orig=1')).json().data.rows[0].value).toBe(1);await app.close();
});

it('legacy metric aliases fall back consistently after malformed primary values',async()=>{
 const app=buildApp({reader:fixture([{thedata:JSON.stringify({'2032-01-01':{view:'bad',total_views:100},'2032-01-02':{view:false,total_views:200},'2032-01-03':{view:'',total_views:300}})}])});
 const data=(await app.inject('/api/v1/channels/1/trends?from=2032-01-03&to=2032-01-03&mode=pred')).json().data;
 expect(data.rows[0]).toMatchObject({views:300,viewChange:100,estimate:100});await app.close();
});
