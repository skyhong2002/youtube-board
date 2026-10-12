import {it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {MySqlDialect} from 'drizzle-orm/mysql-core';
import type {Reader,Row} from '../src/db/client.js';
import type {Register} from '../src/reports/table.js';
import {registerLiveVideoTrend} from '../src/reports/live-video-trend.js';
const id='TrendAa0001',dialect=new MySqlDialect();
function fixture(raw:string,pk=1){const common={pk,the_date:'2026-10-11',ctime:'2026-10-11 00:00:00',mtime:'2026-10-11 12:00:00',log_bytes:Buffer.byteLength(raw)};return{metadata:{...common,log_hash:createHash('sha256').update(raw).digest('hex')},body:{...common,log_json:raw}};}
async function report(metadata:Row[],bodies:Row[],display:Row[]=[{title:'Observed live'}]){
 const queries:{sql:string;params:unknown[]}[]=[];let handler:Parameters<Register>[1]|undefined;
 const reader:Reader={close:async()=>{},rows:async<T extends Row>(query:any)=>{const statement=dialect.sqlToQuery(query);queries.push(statement);return(statement.sql.includes('urt_show_video_live')?display:statement.sql.includes('AS log_hash')?metadata:bodies) as T[];}};
 registerLiveVideoTrend((_path,fn)=>{handler=fn;},reader);return{data:await handler!({id},{limit:'2'}),queries};
}
it('hourly and daily peaks retain measured zero and exact byte identity without inventing max_current',async()=>{
 const a=fixture('{"00:00":0,"01:00":5,"01:30":7}'),b=fixture('{"01:15":9,"02:00":4}',2);const {data,queries}=await report([a.metadata,b.metadata],[a.body,b.body]);
 expect((data as any).series[0].points.map((p:any)=>p.value)).toEqual([0,9,4]);expect((data as any).series[1].points).toEqual([{time:'2026-10-11',value:9}]);expect((data as any).evidenceCoverage.partialLogEvidence).toBe(false);
 for(const q of queries)expect(q.sql).toContain('BINARY videoId=BINARY ?');expect(queries.find(q=>q.sql.includes('CASE WHEN'))?.sql).toContain('SUM(COALESCE(OCTET_LENGTH(log_json),0)) OVER');
});
it('oversized metadata never requests bodies, even when source reports a stored peak',async()=>{
 const a=fixture('{}');a.metadata.log_bytes=131073;const {data,queries}=await report([{...a.metadata,max_current:500}],[]);expect((data as any).series[0].points).toEqual([]);expect((data as any).evidenceCoverage.skippedRows).toBe(1);expect(queries).toHaveLength(2);
});
it('same-length payload mutation and changed dates are withheld rather than mixing observations',async()=>{
 const a=fixture('{"00:00":1}'),b=fixture('{"00:00":3}',2);const {data}=await report([a.metadata,b.metadata],[{...a.body,log_json:'{"00:00":2}'},{...b.body,the_date:'2026-10-12'}]);expect((data as any).series[0].points).toEqual([]);expect((data as any).evidenceCoverage.changedRows).toBe(2);
});
it('malformed payload and invalid samples are reported separately from valid zero',async()=>{
 const a=fixture('{'),b=fixture('{"00:00":0,"00:01":-1,"bad":99,"00:02":"2.5"}',2);const {data}=await report([a.metadata,b.metadata],[a.body,b.body]);expect((data as any).evidenceCoverage).toMatchObject({malformedRows:1,invalidSamples:3,partialLogEvidence:true});expect((data as any).series[0].points[0].value).toBe(0);
});
it('NULL, blank and explicitly empty logs have distinct coverage without invented zero points',async()=>{
 const blank=fixture('',1),empty=fixture('{}',2),missing={...blank.metadata,pk:3,log_bytes:null};const {data}=await report([blank.metadata,empty.metadata,missing],[empty.body]);expect((data as any).series[0].points).toEqual([]);expect((data as any).evidenceCoverage).toMatchObject({missingLogRows:2,emptyLogRows:1,validSamples:0,partialLogEvidence:true});
});
