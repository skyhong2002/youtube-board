import {it,expect} from 'vitest';
import {MySqlDialect} from 'drizzle-orm/mysql-core';
import {reports} from '../src/reports/service.js';
import {DataQueryFailed,DataSourceUnavailable,type Reader} from '../src/db/client.js';
const dialect=new MySqlDialect();
it('search selects a metric boundary then all ties with exact pk order, and never invents an exact count',async()=>{
 const queries:ReturnType<MySqlDialect['sqlToQuery']>[]=[],reader:Reader={rows:async query=>{const q=dialect.sqlToQuery(query);queries.push(q);return(q.sql.includes('MIN(boundary.')?[{selected:4,nulls:0,cutoff:'90'}]:[{pk:21,videoId:'ExactAa01'},{pk:12,videoId:'Exactaa01'},{pk:10,videoId:'Next'}])as any;},close:async()=>{}};
 const result=await reports(reader).videos({q:'%_=',limit:'2',offset:'1',column:'viewCount'});
 expect(result).toMatchObject({total:null,totalStatus:'not-computed',hasNext:true,evidenceCoverage:{totalStatus:'not-computed'}});expect(result.rows.map(row=>row.id)).toEqual(['ExactAa01','Exactaa01']);expect(queries).toHaveLength(2);
 expect(queries[0]!.sql).toContain('SELECT STRAIGHT_JOIN `v`.`viewCount` AS sort_value');expect(queries[0]!.sql).toContain('ORDER BY `v`.`viewCount` DESC LIMIT ?');expect(queries[0]!.params).toEqual(['%=%=_==%','%=%=_==%',4]);
 expect(queries[1]!.params).toEqual(['%=%=_==%','%=%=_==%','90',3,1]);expect(queries[1]!.sql).toContain('AND `v`.`viewCount`>=? ORDER BY `v`.`viewCount` DESC,v.pk DESC');
});
it('zero matches avoid hydration but remain transparently not-counted',async()=>{
 let queries=0;const reader:Reader={rows:async()=>{queries++;return [{selected:0,nulls:0,cutoff:null}]as any;},close:async()=>{}};
 expect(await reports(reader).videos({q:'none'})).toMatchObject({total:null,totalStatus:'not-computed',hasNext:false,rows:[]});expect(queries).toBe(1);
});
it('beyond-total offsets skip a second potentially broad source query',async()=>{let queries=0;const reader:Reader={rows:async()=>{queries++;return [{selected:4,nulls:0,cutoff:'2034-01-01'}]as any;},close:async()=>{}};expect(await reports(reader).videos({q:'search',offset:'100000'})).toMatchObject({rows:[],hasNext:false,total:null});expect(queries).toBe(1);});
it.each([{selected:3,nulls:1,cutoff:7,range:'(`v`.`viewCount`>=? OR `v`.`viewCount` IS NULL)'},{selected:3,nulls:3,cutoff:null,range:'`v`.`viewCount` IS NULL'}])('retains null boundary ties (%j)',async boundary=>{
 const queries:string[]=[];const reader:Reader={rows:async query=>{const q=dialect.sqlToQuery(query);queries.push(q.sql);return(q.sql.includes('MIN(boundary.')?[boundary]:[])as any;},close:async()=>{}};
 await reports(reader).videos({q:'search',column:'viewCount',limit:'2'});expect(queries[1]).toContain(boundary.range);
});
it.each([new DataSourceUnavailable(),new DataQueryFailed('ER_BAD_FIELD_ERROR')])('only source unavailability can degrade exact count (%s)',async error=>{
 const reader:Reader={rows:async query=>{const q=dialect.sqlToQuery(query);if(q.sql.startsWith('SELECT COUNT(*) AS total'))throw error;return(q.sql.includes('MIN(boundary.')?[{selected:1,nulls:0,cutoff:'2034-01-01 00:00:00'}]:[{videoId:'one'}])as any;},close:async()=>{}};
 const result=reports(reader).videos({});if(error instanceof DataSourceUnavailable)expect(await result).toMatchObject({total:null,totalStatus:'unavailable',hasNext:false});else await expect(result).rejects.toBe(error);
});
it('page errors remain errors rather than empty successful data',async()=>{
 const reader:Reader={rows:async()=>{throw new DataSourceUnavailable();},close:async()=>{}};await expect(reports(reader).videos({q:'search'})).rejects.toBeInstanceOf(DataSourceUnavailable);
});
it('rejects invalid bounds before database access',async()=>{
 const reader:Reader={rows:async()=>{throw Error('Unexpected database access');},close:async()=>{}};for(const query of [{limit:'1) UNION SELECT 1'},{offset:'-1'},{limit:'1001'}])await expect(reports(reader).videos({q:'search',...query})).rejects.toThrow();
});
