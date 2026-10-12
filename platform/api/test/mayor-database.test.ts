import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import mysql from 'mysql2/promise';
import {assertTestDatabaseUrl} from '../../shared/test-database.js';
import {buildApp} from '../src/app.js';
const url=process.env.TEST_DATABASE_URL?assertTestDatabaseUrl(process.env.TEST_DATABASE_URL):undefined;
describe.skipIf(!url)('mayor bounded MariaDB parity',()=>{
 let db:mysql.Connection;const inserted:number[]=[],day='2020-02-20',app=buildApp({databaseUrl:url,dataset:'fixture'});
 beforeAll(async()=>{db=await mysql.createConnection(url!);for(const [tag,date,views,videos]of [
 ['3',day,'{"蔣萬安":900}',null],
 ['3',day,'{"蔣萬安":3,"沈伯洋":1}',null],
 ['4',day,'broken',null],
 ['5',day,' '.repeat(131073),null],
 ['3','2020-02-21','{}','{"蔣萬安":2}']
 ]as const){const[r]=await db.execute<mysql.ResultSetHeader>('INSERT INTO urt_show_tag_date(ctime,mtime,the_date,tagid,tag_or,tag_not,tags_views,tags_video) VALUES(?,?,?,?,?,?,?,?)',['2020-02-21 12:00:00','2020-02-21 12:00:00',date,tag,'','',views,videos]);inserted.push(r.insertId);}});
 afterAll(async()=>{await app.close();for(const pk of inserted)await db.execute('DELETE FROM urt_show_tag_date WHERE pk=?',[pk]);await db.end();});
 it('selects latest exact category revision and bounds malformed/oversized bodies',async()=>{const r=await app.inject('/api/v1/mayor/cities/taipei?from='+day+'&to='+day+'&type=views');expect(r.statusCode,r.body).toBe(200);expect(r.json().data.rows[0]).toMatchObject({'蔣萬安':3,'沈伯洋':1,'蔣萬安：占比':75,observedBuckets:1});expect(r.json().meta.coverage).toMatchObject({observedBuckets:1,malformedBuckets:1,oversizedBuckets:1});});
 it('preserves explicit metric aliases and warmup buckets',async()=>{const r=await app.inject('/api/v1/mayor?from=2020-02-21&to=2020-02-21&type=videos');expect(r.statusCode,r.body).toBe(200);expect(r.json().data.rows[0]['蔣萬安']).toBe(2);expect(r.json().data.series[0].unit).toBe('影片引用');expect(r.json().meta.coverage.metric).toBe('tags_video');});
});
