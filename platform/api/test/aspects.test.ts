import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import mysql,{type ResultSetHeader} from 'mysql2/promise';
import {randomUUID,createHash} from 'node:crypto';
import {aspectValues} from '../src/reports/aspect-shapes.js';
import {aspectReport} from '../src/reports/aspects.js';
import {buildApp} from '../src/app.js';
import {createReader,type Reader} from '../src/db/client.js';
import {assertTestDatabaseUrl} from '../../shared/test-database.js';
import {aiBusinessKey} from '../../shared/ai-business-key.js';
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
