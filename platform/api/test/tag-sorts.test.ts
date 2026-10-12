import type {SQL} from 'drizzle-orm';
import {it,expect} from 'vitest';
import {MySqlDialect} from 'drizzle-orm/mysql-core';
import {buildApp} from '../src/app.js';
import {reports} from '../src/reports/service.js';
import type {Reader,Row} from '../src/db/client.js';
const counts=[{tags:'[1][1]',view_week:10},{tags:'[1][2]',view_week:20},{tags:'[1]',view_week:30},{tags:'[2]',view_week:200},{tags:'[3]',view_week:150}];
function reader(rows:Row[]):Reader{return {rows:async<T extends Row>(q:SQL)=> (new MySqlDialect().sqlToQuery(q).sql.includes('SELECT tags,view_week FROM urt_count')?rows:[]) as T[],close:async()=>{}};}
it('category legacy sorts rank before pagination and deduplicate channel membership',async()=>{
 const service=reports(reader(counts));
 for(const [sort,ids]of [['num',[1,2,3]],['total',[2,3,1]],['ave',[3,2,1]],['median',[3,2,1]]]as const){const data=await service.tags({sort,limit:'2',offset:'1'});expect(data.total).toBe(3);expect(data.rows.map(r=>r.id)).toEqual(ids.slice(1));}
 const d=await reports(reader(counts)).tags();expect(d.rows[0]).toMatchObject({id:1,channels:3,weeklyViews:60,average:20,median:20});
 await expect(service.tags({sort:'__proto__'})).rejects.toThrow('Invalid category sort');
});
it('oversized channel sets and unsafe totals fail instead of presenting rounded or truncated rankings',async()=>{
 await expect(reports(reader(Array.from({length:100001},()=>({tags:'[1]',view_week:1})))).tags()).rejects.toMatchObject({statusCode:422});
 await expect(reports(reader([{tags:'[1]',view_week:Number.MAX_SAFE_INTEGER},{tags:'[1]',view_week:1}])).tags()).rejects.toMatchObject({statusCode:422});
});

it('unsafe BIGINT values are never normalized into a zero and home preserves other panels',async()=>{
 const app=buildApp({reader:reader([{tags:'[1]',view_week:'9007199254740993'}])});
 expect((await app.inject('/api/v1/tags')).statusCode).toBe(422);expect((await app.inject('/api/v1/tags?sort=invalid')).statusCode).toBe(400);
 const response=await app.inject('/api/v1/home');expect(response.statusCode).toBe(200);expect(response.json().data).toMatchObject({tags:[],tagsStatus:'bounded',channels:[],live:[]});await app.close();
});
it('empty controls and exact capacity work with deterministic ties',async()=>{
 const rows=Array.from({length:100000},()=>({tags:'[2][1]',view_week:1}));
 const data=await reports(reader(rows)).tags({sort:'',min:''});expect(data.rows.map(row=>row.id)).toEqual([1,2]);expect(data.rows[0].channels).toBe(100000);
});
