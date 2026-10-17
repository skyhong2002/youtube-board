import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import mysql,{type ResultSetHeader} from 'mysql2/promise';
import {randomUUID,createHash} from 'node:crypto';
import {aspectValues} from '../src/reports/aspect-shapes.js';
import {aspectReport} from '../src/reports/aspects.js';
import {buildApp} from '../src/app.js';
import {createReader,type Reader} from '../src/db/client.js';
import {assertTestDatabaseUrl} from '../../shared/test-database.js';
import {aiBusinessKey} from '../../shared/ai-business-key.js';
import {MySqlDialect} from 'drizzle-orm/mysql-core';
it('accepts wrappers, flat lists, scalar aliases, and first existing group precedence',()=>{
 const r=aspectValues({result:{data:[{group:'兩岸角度',item:'台灣',score:'3.9',description:42},{group:'兩岸',name:'台灣',value:99},{group:'政治傾向',name:'泛綠',偏好度:'invalid',preference:'-2.8'},{group:'政治立場',name:'泛藍',value:99}]}});
 expect(r.values['台灣']).toEqual({value:3,detail:'42'});expect(r.values['泛綠'].value).toBe(-2);expect(r.values['泛藍'].value).toBeNull();expect(r.sortBalance).toBe(1n);
 expect(aspectValues({'政治傾向':[],'政治':[{name:'泛綠',score:9}]}).values['泛綠'].value).toBeNull();
});
it('preserves missing scores, exact large balance ordering and ignores nonnumeric data',()=>{
 const r=aspectValues(JSON.stringify([{name:'中國',value:4.9},{name:'泛紅',value:null},{name:'泛白',score:false},{name:'台灣',score:Number.MAX_SAFE_INTEGER},{name:'泛綠',score:Number.MAX_SAFE_INTEGER}]));
 expect(r.values['泛紅'].value).toBeNull();expect(r.values['泛白'].value).toBeNull();expect(r.values['中國'].value).toBe(4);expect(r.sortBalance).toBe(BigInt(Number.MAX_SAFE_INTEGER)*2n-4n);
 expect(aspectValues([{name:'台灣',score:'1e50'}]).values['台灣'].value).toBeNull();
 expect(aspectValues([{group:'__proto__',name:'台灣',score:8}]).values['台灣'].value).toBeNull();
});
it('rejects metadata row and byte bounds before requesting payloads',async()=>{
 for(const rows of [Array.from({length:2001},(_,pk)=>({pk,bytes:11})),[{pk:1,bytes:16*1024*1024+1}],[{pk:1,bytes:9*1024*1024},{pk:2,bytes:9*1024*1024}]]){
  let calls=0;const reader={rows:async()=>{calls++;return rows;},close:async()=>{}} as Reader;
  await expect(aspectReport(reader,{})).rejects.toMatchObject({statusCode:422});expect(calls).toBe(1);const app=buildApp({reader});expect((await app.inject('/api/v1/ai/aspects')).statusCode).toBe(422);await app.close();
 }
});
it('adds Laravel visible channel tags, filter tag names and the 傾向 balance for the returned page',async()=>{
 const payloads:Record<number,unknown>={1:[{name:'泛綠',score:9,description:'綠'},{name:'台灣',score:8},{name:'泛白',score:1},{name:'泛藍',score:2},{name:'泛紅',score:0},{name:'中國',score:1}],2:[{name:'泛藍',score:6}],3:[{name:'其他',score:1}]};
 const statements:{sql:string;params:unknown[]}[]=[];
 const reader={close:async()=>{},rows:async(query:any)=>{const q=new MySqlDialect().sqlToQuery(query);statements.push(q);
  if(q.sql.includes('AS bytes'))return [1,2,3].map(pk=>({pk,bytes:20}));
  if(q.sql.includes('ai.result_json,c.title'))return [1,2,3].map(pk=>({pk,u_id:pk*10,date_from:'2026-10-10 00:00:00',date_to:'2026-10-10 23:59:59',data_type:'aspect',user_token:'cli',ctime:'2026-10-10 00:00:00',mtime:null,result_json:JSON.stringify(payloads[pk]),title:'ch'+pk}));
  if(q.sql.includes('ts_ai_runs'))return q.params.filter(v=>typeof v==='number').map(pk=>({pk,published:1,pending:0,published_before:0}));
  if(q.sql.includes('FROM urt_count'))return [{u_id:10,tags:'[12][4][1][4][81][99]'},{u_id:30,tags:null}];
  if(q.sql.includes('FROM urt_tag'))return [{tag_id:1,tag_name:'社論'},{tag_id:2,tag_name:'政治人物'},{tag_id:3,tag_name:'泛藍'},{tag_id:4,tag_name:'泛綠'},{tag_id:5,tag_name:null}];
  return [];}} as Reader;
 const r=await aspectReport(reader,{condition:'blue',tagid:'9',or:'2',not:'5,3',limit:'2'});
 expect(r.columns.map(c=>c.key)).toEqual(['channel','台灣','泛綠','泛白','泛藍','泛紅','中國','balance','source']);
 expect(r.rows.map(row=>(row.channel as any).value)).toEqual(['ch1','ch3']);expect(r.total).toBe(3);
 expect(r.rows.map(row=>row.balance)).toEqual([{value:15,detail:''},{value:null,detail:''}]);
 expect((await aspectReport(reader,{offset:'2'})).rows[0]!.balance).toEqual({value:-6,detail:'部分分數缺值，以 0 計入'});
 expect(r.channelTags).toEqual({'10':[{id:4,name:'泛綠'},{id:1,name:'社論'},{id:81,name:'81'}],'30':[]});
 expect(r.filterTags).toEqual([{id:3,name:'泛藍'},{id:2,name:'政治人物'},{id:5,name:'5'}]);
 const count=statements.find(s=>s.sql.includes('SELECT u_id,tags FROM urt_count'))!;expect(count.params).toEqual([10,30,2]);
 statements.length=0;const empty={...reader,rows:async(query:any)=>{statements.push(new MySqlDialect().sqlToQuery(query));return [];}} as Reader;
 expect(await aspectReport(empty,{})).toMatchObject({rows:[],channelTags:{},filterTags:[]});expect(statements).toHaveLength(1);
});
const url=process.env.TEST_DATABASE_URL?assertTestDatabaseUrl(process.env.TEST_DATABASE_URL):undefined;
describe.skipIf(!url)('aspect reports on isolated MariaDB',()=>{
 let db:mysql.Connection;const token=randomUUID().replaceAll('-',''),ids:number[]=[],pks:number[]=[],runs:string[]=[],tag=976132;
 const app=buildApp({databaseUrl:url,dataset:'fixture'}),stamp='2026-10-10 00:00:00';
 const payload=(score:number)=>JSON.stringify([{name:'泛綠',score,description:'fixture analysis'},{name:'中國',score:2}]);
 const insert=async(id:number,json:string,deleted:number|null=null)=>{const [r]=await db.execute<ResultSetHeader>('INSERT INTO urt_channel_ai(u_id,ctime,date_from,date_to,data_type,user_token,result_json,del_flag,ai_type)VALUES(?,?,?,?,?,?,?,?,?)',[id,stamp,stamp,'2026-10-10 23:59:59','aspect','cli',json,deleted,'fixture']);pks.push(r.insertId);return r.insertId;};
 beforeAll(async()=>{db=await mysql.createConnection(url!);for(let i=0;i<4;i++){const [r]=await db.execute<ResultSetHeader>('INSERT INTO urt_channel(title,youtube_id,ctime,flag_del)VALUES(?,?,?,?)',['aspect-fixture-'+i,token.slice(0,20)+i,stamp,i===1?0:i===3?1:null]);ids.push(r.insertId);await db.execute('INSERT INTO urt_count(u_id,tags,ctime)VALUES(?,?,?)',[r.insertId,`[${tag}]${i===0?'[3]':i===1?'[4]':''}`,stamp]);await insert(r.insertId,payload(i===0?1:i===1?9:4));}await insert(ids[0]!,payload(30),1);await insert(ids[0]!,'{}');});
 afterAll(async()=>{await app.close();if(db){for(const id of runs)await db.execute('DELETE FROM ts_ai_runs WHERE run_id=?',[id]);for(const id of pks)await db.execute('DELETE FROM urt_channel_ai WHERE pk=?',[id]);for(const id of ids){await db.execute('DELETE FROM urt_count WHERE u_id=?',[id]);await db.execute('DELETE FROM urt_channel WHERE u_id=?',[id]);}await db.end();}});
 const get=async(q='')=>{const r=await app.inject(`/api/v1/ai/aspects?or=${tag}${q}`);expect(r.statusCode,r.body).toBe(200);return r.json();};
 it('sorts by legacy balance before paging, excludes short/deleted rows and inactive channels',async()=>{
  const {data,meta}=await get();expect(data.limit).toBe(100);expect(data.total).toBe(3);expect(data.rows.map((r:any)=>r.channel.value)).toEqual(['aspect-fixture-1','aspect-fixture-2','aspect-fixture-0']);expect(data.rows[2]['泛綠'].value).toBe(1);expect(data.rows[0]['台灣'].value).toBeNull();expect(meta.coverage.sourceRows).toBe(3);
  expect((await get('&limit=1&offset=1')).data.rows[0].channel.value).toBe('aspect-fixture-2');expect(data.rows[0].source.href).toBe(`/channels/${ids[1]}/ai?pk=${pks[1]}`);
 });
 it('applies condition taxonomy with intersecting OR filters and validates input',async()=>{
  for(const [condition,name]of [['blue','aspect-fixture-0'],['green','aspect-fixture-1'],['neutral','aspect-fixture-2']])expect((await get('&condition='+condition)).data.rows.map((r:any)=>r.channel.value)).toEqual([name]);
  expect((await get('&condition=finance')).data.total).toBe(0);expect((await app.inject('/api/v1/ai/aspects?condition=unsupported')).statusCode).toBe(400);
 });
 it('excludes a superseded source between metadata and payload reads',async()=>{
  const reader=createReader(url);let calls=0;
  const guarded={close:()=>reader.close(),rows:async(query:any)=>{calls++;if(calls===2)await insert(ids[0]!,payload(42));return reader.rows(query);}} as Reader;
  try{const r=await aspectReport(guarded,{or:String(tag),condition:'blue'});expect(r.rows).toEqual([]);expect(r.evidenceCoverage.changedSources).toBe(1);}finally{await reader.close();}
  const newest=pks.pop()!;await db.execute('DELETE FROM urt_channel_ai WHERE pk=?',[newest]);
 });
 it('withholds pending exact output and diverged publication, retains explicit coverage',async()=>{
  const pk=pks[2]!,uId=ids[2]!,runId=createHash('sha256').update(token).digest('hex');runs.push(runId);
  await db.execute('INSERT INTO ts_ai_runs(run_id,workflow,business_key_sha256,input_sha256,input_json,status,target_pk,result_json,created_at,updated_at)VALUES(?,?,?,?,?,?,?,?,?,?)',[runId,'ai.channel',aiBusinessKey('urt_channel_ai',{u_id:uId,date_from:stamp,date_to:'2026-10-10 23:59:59',data_type:'aspect',user_token:'cli'}),'a'.repeat(64),'{}','validated',pk,payload(4),stamp,stamp]);
  expect((await get()).meta.coverage).toMatchObject({sourceRows:2,withheldSources:1});await db.execute("UPDATE ts_ai_runs SET status='published' WHERE run_id=?",[runId]);expect((await get()).meta.coverage.sourceRows).toBe(3);
  await db.execute('UPDATE urt_channel_ai SET result_json=? WHERE pk=?',[payload(8),pk]);expect((await get()).meta.coverage).toMatchObject({sourceRows:2,divergedSources:1});
 });
 it('exposes malformed latest source without falling back to an older analysis',async()=>{
  await insert(ids[0]!,'invalid-json-long-enough');const r=await get('&condition=blue');expect(r.data.rows).toEqual([]);expect(r.meta.coverage.malformedSources).toBe(1);
 });
});
