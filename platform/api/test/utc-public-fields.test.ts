import {expect,it} from 'vitest';
import {MySqlDialect} from 'drizzle-orm/mysql-core';
import type {Connection} from 'mysql2/promise';
import type {Reader,Row} from '../src/db/client.js';
import type {Register} from '../src/reports/table.js';
import type {ReportData} from '../src/report-contracts.js';
import {registerGroups} from '../src/reports/groups.js';
import {channelAiDays} from '../src/reports/channel-ai.js';
import {registerPromptPreview} from '../src/reports/prompt-preview.js';
import {aiBusinessKey} from '../../shared/ai-business-key.js';
import {planAi} from '../../ai/src/planner.js';
const dialect=new MySqlDialect(),clock=()=>new Date('2026-10-12T01:00:00Z');
function readerFor(query:(sql:string,params:unknown[])=>Row[]):Reader{return {rows:async<T extends Row>(value:Parameters<Reader['rows']>[0])=>{const compiled=dialect.sqlToQuery(value);return query(compiled.sql,compiled.params) as T[];},close:async()=>{}};}
function registry(){const handlers=new Map<string,Parameters<Register>[1]>();return {handlers,register:((path,handler)=>handlers.set(path,handler)) as Register};}
it('group source timestamps cross Taipei midnight as UTC while labels and source rows stay exact',async()=>{
 const literal='2026-10-12 00:00:00',source=[{tag:literal,latest_time:literal},{tag:'unknown',latest_time:null}],{handlers,register}=registry();
 registerGroups(register,readerFor(()=>source),clock);
 const result=await handlers.get('/groups/:name')!({name:'fixture-utc'}, {}) as ReportData;
 expect(result.rows).toEqual([{term:{value:literal,href:'/keywords/2026-10-12%2000%3A00%3A00/videos'},updatedAt:'2026-10-11T16:00:00.000Z'},{term:{value:'unknown',href:'/keywords/unknown/videos'},updatedAt:null}]);
 expect(result.updatedAt).toBe('2026-10-11T16:00:00.000Z');expect(source[0]!.latest_time).toBe(literal);
});
it('channel analysis serializes source instants without changing daily buckets or publication business keys',async()=>{
 const source={pk:1,u_id:8,date_from:'2026-10-12 00:00:00',date_to:'2026-10-12 23:59:59',data_type:'oneday',user_token:'CLI',result_json:JSON.stringify([{事件:'2026-10-12 00:00:00',videoId:[]}])};
 const queries:{sql:string;params:unknown[]}[]=[],reader=readerFor((sql,params)=>{queries.push({sql,params});if(sql.includes('FROM ts_ai_runs'))return [{pk:1,published:0,pending:0,published_before:0}];if(sql.includes('MAX(pk)'))return [{pk:1}];if(sql.includes('FROM urt_channel_ai a'))return [source];throw Error('Unexpected fixture query');});
 const result=await channelAiDays(reader,8,{pk:'1'},{id:8,title:'fixture',status:'active',profileAvailable:true});
 expect(result.rows[0]).toMatchObject({date:'2026-10-12',title:'2026-10-12 00:00:00'});expect(result.period).toEqual({from:'2026-10-12',to:'2026-10-12'});
 expect(result.sections?.find(section=>section.key==='sources')?.rows[0]).toMatchObject({from:'2026-10-11T16:00:00.000Z',to:'2026-10-12T15:59:59.000Z'});
 expect(source.date_from).toBe('2026-10-12 00:00:00');expect(source.date_to).toBe('2026-10-12 23:59:59');
 expect(queries.find(query=>query.sql.includes('FROM ts_ai_runs'))?.params).toContain(aiBusinessKey('urt_channel_ai',{date_from:source.date_from,date_to:source.date_to,data_type:source.data_type,user_token:source.user_token,u_id:8}));
});
it('prompt preview exposes UTC period while retaining the exact planner SQL window and prompt',async()=>{
 const statements:{sql:string;params:unknown[]}[]=[],query=(sql:string,params:unknown[])=>{statements.push({sql,params});return sql.includes('COUNT(')?[{n:0}]:[];},reader=readerFor(query),{handlers,register}=registry();
 registerPromptPreview(register,reader,clock);const result=await handlers.get('/ai/days/prompt')!({}, {date:'2026-10-12'}) as {period:unknown;prompt:string;schema:unknown};
 expect(result.period).toEqual({from:'2026-10-11T16:00:00.000Z',to:'2026-10-12T15:59:59.000Z'});const actual=[...statements];statements.length=0;
 const planner=await planAi({query:async(sql:string,params:unknown[])=>[query(sql,params),[]]} as unknown as Pick<Connection,'query'>,{kind:'daily',from:'2026-10-12 00:00:00',to:'2026-10-12 23:59:59',dataType:'oneday',userToken:'CLI',condition:'all'});
 expect(statements).toEqual(actual);expect(result.prompt).toBe(planner.prompt);expect(result.schema).toEqual(planner.schema);expect(planner.input.from).toBe('2026-10-12 00:00:00');
});
