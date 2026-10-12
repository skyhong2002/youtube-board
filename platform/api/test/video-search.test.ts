import {it,expect} from 'vitest';
import {MySqlDialect} from 'drizzle-orm/mysql-core';
import {reports} from '../src/reports/service.js';
import {DataQueryFailed,type Reader} from '../src/db/client.js';
const dialect=new MySqlDialect();
it('search counts and chooses bounded ordered keys in one text scan, then reads only those primary keys',async()=>{
 const queries:ReturnType<MySqlDialect['sqlToQuery']>[]=[],reader:Reader={rows:async query=>{const q=dialect.sqlToQuery(query);queries.push(q);return (q.sql.includes('GROUP_CONCAT')?[{total:4,pageKeys:'21#,12#'}]:[{pk:21,videoId:'ExactAa01'},{pk:12,videoId:'Exactaa01'}]) as any;},close:async()=>{}};
 const result=await reports(reader).videos({q:'%_=',limit:'2',offset:'1',column:'viewCount'});
 expect(result.total).toBe(4);expect(result.rows.map(row=>row.id)).toEqual(['ExactAa01','Exactaa01']);expect(queries).toHaveLength(2);
 expect(queries[0]!.sql).toContain("ORDER BY `v`.`viewCount` DESC,v.pk DESC SEPARATOR ',' LIMIT 2 OFFSET 1");
 expect(queries[0]!.params).toEqual(['%=%=_==%','%=%=_==%']);
 expect(queries[1]!.sql).toContain('WHERE v.pk IN (?,?)');expect(queries[1]!.params).toEqual(['21','12','%=%=_==%','%=%=_==%']);expect(queries[1]!.sql).toContain("AND (v.title LIKE ? ESCAPE '=' OR v.description LIKE ? ESCAPE '=')");
});
it.each([{total:0,pageKeys:null,offset:'0'},{total:4,pageKeys:'',offset:'10'}])('empty or beyond-total search returns exact total without a second scan (%j)',async row=>{
 let queries=0;const reader:Reader={rows:async()=>{queries++;return [row] as any;},close:async()=>{}};
 const result=await reports(reader).videos({q:'search',offset:row.offset});expect(result).toMatchObject({total:row.total,rows:[]});expect(queries).toBe(1);
});
it.each(['123#,456','123#,','123#','123#,123#','123#,456#extra',null])('rejects truncated, short, duplicate or malformed key aggregates: %s',async pageKeys=>{
 let queries=0;const reader:Reader={rows:async()=>{queries++;return [{total:2,pageKeys}] as any;},close:async()=>{}};
 await expect(reports(reader).videos({q:'search',limit:'2'})).rejects.toBeInstanceOf(DataQueryFailed);expect(queries).toBe(1);
});
it('rejects unvalidated pagination before producing any literal SQL',async()=>{
 const reader:Reader={rows:async()=>{throw Error('Unexpected database access');},close:async()=>{}};
 for(const query of [{limit:'1) UNION SELECT 1'},{offset:'-1'},{limit:'1001'}])await expect(reports(reader).videos({q:'search',...query})).rejects.toThrow();
});
