import {it,expect} from 'vitest';
import {buildApp} from '../src/app.js';
import type {Reader,Row} from '../src/db/client.js';
import {groupDefinitions} from '../src/reports/group-definitions.js';
import {contentGroups} from '../src/reports/content-groups.js';
const fixture=(rows:Row[]):Reader=>({rows:async<T extends Row>()=>rows as T[],close:async()=>{}});
it('configured content groups retain exact Laravel directory terms independently of live-wall definitions',()=>{
 expect(Object.keys(contentGroups).filter(key => Object.hasOwn(groupDefinitions,key))).toEqual([]);
 // Frozen from Laravel app/Services/Legacy/GroupDirectoryReport.php (removed after d0f2b9c).
 expect(Object.fromEntries(Object.entries(contentGroups).map(([name,value])=>[name,value.terms]))).toEqual({
  tags_president2024:['侯友宜','柯文哲','賴清德','趙少康','蕭美琴','吳欣盈'],
  tags_coldwar:['美國','中國','俄羅斯','烏克蘭','北約'],
  tags_elect:['總統大選','立委','民調','政見','投票'],
  tags_straits:['石斑魚','軍演','共軍','航母','解放軍','台海','兩岸','兩岸統一','台獨'],
  tags_economy:['通膨','景氣','股市','匯率','房價'],
 });
});
it('empty membership still offers all five configured groups and historical terms without claiming an update',async()=>{
 const app=buildApp({reader:fixture([])});
 const directory=(await app.inject('/api/v1/groups?limit=200')).json().data;
 for(const name of Object.keys(contentGroups))expect(directory.rows.filter((r:any)=>r.group.href==='/groups/'+name)).toHaveLength(1);
 const response=await app.inject('/api/v1/groups/tags_president2024');expect(response.statusCode).toBe(200);
 expect(response.json().data.title).toContain('2024');expect(response.json().data.total).toBe(6);expect(response.json().data.updatedAt).toBeNull();
 expect((await app.inject('/api/v1/groups/tags_president2024%20')).statusCode).toBe(200);
 expect((await app.inject('/api/v1/groups/not-configured')).statusCode).toBe(404);await app.close();
});
it('stored membership takes precedence without duplicate directory entries',async()=>{
 const app=buildApp({reader:fixture([{group_name:'tags_coldwar',count:1,tag:'已維護詞彙',latest_time:'2026-10-01 00:00:00'}])});
 const d=(await app.inject('/api/v1/groups?limit=200')).json().data;
 expect(d.rows.filter((r:any)=>r.group.href==='/groups/tags_coldwar')).toHaveLength(1);
 const g=(await app.inject('/api/v1/groups/tags_coldwar')).json().data;expect(g.total).toBe(1);expect(g.rows[0].term.value).toBe('已維護詞彙');expect(g.notes[0]).toContain('既有內容詞彙群組');await app.close();
});
it('bounded reads fail explicitly rather than publishing silently truncated totals',async()=>{
 const app=buildApp({reader:fixture(Array.from({length:10001},()=>({group_name:'x',tag:'x'})))});
 expect((await app.inject('/api/v1/groups')).statusCode).toBe(422);
 expect((await app.inject('/api/v1/groups/custom')).statusCode).toBe(422);await app.close();
});
it.skipIf(!process.env.TEST_DATABASE_URL)('reads stored group membership and deletion flags in isolated MariaDB',async()=>{
 const {assertTestDatabaseUrl}=await import('../../shared/test-database.js');
 const {createReader}=await import('../src/db/client.js');
 const mysql=await import('mysql2/promise');const url=process.env.TEST_DATABASE_URL!;assertTestDatabaseUrl(url);
 const db=await mysql.createConnection(url);const name='__directory_test_987601';
 const reader=createReader(url);const app=buildApp({reader});
 try{
  await db.execute('DELETE FROM tag_group WHERE group_name=?',[name]);
  await db.execute("INSERT INTO tag_group(group_name,tag,del_flag,ctime,latest_time) VALUES (?, 'visible-term', NULL, NOW(), NOW()), (?, 'deleted-term', '1', NOW(), NOW())",[name,name]);
  const response=await app.inject('/api/v1/groups/'+name);expect(response.statusCode).toBe(200);expect(response.json().data.total).toBe(1);expect(response.json().data.rows[0].term.value).toBe('visible-term');
  let found=0;for(let offset=0;offset<2200;offset+=200){const directory=await app.inject('/api/v1/groups?limit=200&offset='+offset);expect(directory.statusCode).toBe(200);const data=directory.json().data;found+=data.rows.filter((r:any)=>r.group.href==='/groups/'+name).length;if(offset+200>=data.total)break;}expect(found).toBe(1);
 }finally{await db.execute('DELETE FROM tag_group WHERE group_name=?',[name]);await app.close();await db.end();}
});

it('directory freshness excludes content rows replaced by static channel definitions',async()=>{
 const key=Object.keys(groupDefinitions)[0]!;const app=buildApp({reader:fixture([{group_name:key,count:1,latest:'2032-01-01 00:00:00'}])});
 const d=(await app.inject('/api/v1/groups?limit=200')).json().data;expect(d.updatedAt).toBeNull();expect(d.rows.filter((r:any)=>r.group.href==='/groups/'+key)).toHaveLength(1);await app.close();
});
it('enforces exact report capacity boundaries',async()=>{
 for(const [path,size,status]of [['groups',2000,200],['groups',2001,422],['groups/custom',10000,200],['groups/custom',10001,422]]as const){const app=buildApp({reader:fixture(Array.from({length:size},(_,i)=>({group_name:'fixture'+i,tag:'term'+i})))});expect((await app.inject('/api/v1/'+path)).statusCode).toBe(status);await app.close();}
});

it('distinguishes group scopes and counting units without changing identifiers or memberships',async()=>{
 const app=buildApp({reader:fixture([{group_name:'現任立委',count:111,latest:'2023-01-24 06:20:00'}])});
 const directory=(await app.inject('/api/v1/groups?limit=200')).json().data;
 const a=directory.rows.find((r:any)=>r.group.href==='/groups/two'),b=directory.rows.find((r:any)=>r.group.href==='/groups/two_all');
 expect(a.group.value).not.toBe(b.group.value);expect(a.count).toBe(2);expect(b.count).toBe(7);
 expect(directory.columns.find((c:any)=>c.key==='count').label).toBe('項目數');
 expect(directory.notes.join(' ')).toContain('不是頻道數');expect(directory.notes.join(' ')).toContain('不代表已查核目前任職');expect(directory.notes.join(' ')).not.toContain('tag_group');
 expect(directory.updatedAt).toBeTruthy();
 for(const name of ['two','two_all']){const detail=(await app.inject('/api/v1/groups/'+name)).json().data;expect(detail.rows).toHaveLength(name==='two'?2:7);}
 await app.close();
});
