import type {SQL} from 'drizzle-orm';
import type {Register} from '../src/reports/table.js';
import {it,expect} from 'vitest';
import {MySqlDialect} from 'drizzle-orm/mysql-core';
import type {Reader,Row} from '../src/db/client.js';
import {channelSource,readVideoChannels,sourceForLabel} from '../src/reports/channel-sources.js';
const dialect=new MySqlDialect();
it('one exact bounded video-source query resolves repeated references without a channel-name lookup',async()=>{
 const queries:ReturnType<MySqlDialect['sqlToQuery']>[]=[],reader:Reader={rows:async<T extends Row>(query:SQL)=>{queries.push(dialect.sqlToQuery(query));return [{videoId:'ExactCase01',u_id:1,channelTitle:'同名',youtubeChannelId:'UC'+'a'.repeat(22)},{videoId:'exactcase01',u_id:2,channelTitle:'同名'}] as unknown as T[];},close:async()=>{}};
 const result=await readVideoChannels(reader,['ExactCase01','ExactCase01','invalid']);expect(queries).toHaveLength(1);expect(queries[0]?.params).toEqual(['ExactCase01','ExactCase01']);expect(queries[0]?.sql).toContain('BINARY v.videoId IN');expect(queries[0]?.sql).toContain('BINARY n.videoId=BINARY v.videoId');expect(result.size).toBe(1);expect(result.get('ExactCase01')).toMatchObject({channelId:1,channelTitle:'同名',channelAvatar:null});
});
it('same labels across explicit source identities remain unresolved, never guessed by global name',()=>{
 const first=channelSource({u_id:1,channelTitle:'同名'}),second=channelSource({u_id:2,channelTitle:'同名'});
 expect(sourceForLabel('同名',[first,first])).toEqual(first);expect(sourceForLabel('同名',[first,second])).toEqual({channelId:null,channelTitle:'同名',channelAvatar:null});expect(sourceForLabel('不相干',[first])).toMatchObject({channelId:null});for(const sources of [[first,channelSource({channelTitle:'同名'})],[channelSource({channelTitle:'同名'}),first]])expect(sourceForLabel('同名',sources)).toMatchObject({channelId:null});expect(channelSource({u_id:0,channelTitle:'missing'})).toMatchObject({channelId:null});
});
it('invalid-only references have no database IO',async()=>{let calls=0;expect((await readVideoChannels({rows:async()=>{calls++;return[];},close:async()=>{}},['../bad'])).size).toBe(0);expect(calls).toBe(0);});
it('hourly channel cells bind only that topic exact video sources and preserve punctuation in labels',async()=>{
 const {registerAiHistory}=await import('../src/reports/ai-history.js');
 const rows=[{pk:1,date_from:'2035-01-01 12:00:00',date_to:'2035-01-01 12:59:59',data_type:'hourly',condition_type:'all',user_token:'cli',result_json:JSON.stringify({events:[{event:'A',media:['甲、乙','同名'],video_ids:['ExactCase01','OtherCase01','OtherCase02']},{event:'B',media:['甲、乙'],video_ids:['Missing0001']}]})}];let videoReads=0;
 const reader:Reader={rows:async<T extends Row>(query:SQL)=>{const q=dialect.sqlToQuery(query).sql;let result:Row[]=[];if(q.includes('FROM urt_ai_hour'))result=rows;else if(q.includes('FROM urt_video v')){videoReads++;result=[{videoId:'ExactCase01',u_id:1,channelTitle:'甲、乙'},{videoId:'OtherCase01',u_id:2,channelTitle:'同名'},{videoId:'OtherCase02',u_id:3,channelTitle:'同名'}];}return result as T[];},close:async()=>{}};
 let handler:Parameters<Register>[1]|undefined;
 registerAiHistory((path,fn)=>{if(path==='/ai/hours')handler=fn;},reader,()=>new Date('2035-01-01T04:00:00Z'));
 const result=await handler!({}, {date:'2035-01-01'}) as import('../src/report-contracts.js').ReportData;
 expect(videoReads).toBe(1);expect(result.rows[0]?.channels).toMatchObject({value:'甲、乙、同名',sources:[{channelId:1,channelTitle:'甲、乙'},{channelId:null,channelTitle:'同名'}]});expect(result.rows[1]?.channels).toMatchObject({sources:[{channelId:null}]});expect(result.sections?.[0]?.rows[0]?.channel).toMatchObject({value:'甲、乙',sources:[{channelId:1}]});
});
