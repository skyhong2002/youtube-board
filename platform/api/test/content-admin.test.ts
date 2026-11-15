import {it,expect} from 'vitest';
import {MySqlDialect} from 'drizzle-orm/mysql-core';
import type {SQL} from 'drizzle-orm';
import type {Reader,Row} from '../src/db/client.js';
import {lookupContent,parseContentQuery} from '../src/manage/content.js';
const now=new Date('2026-11-15T12:00:00Z'),id='abcdefghijk',channelId='UCabcdefghijklmnopqrstuv',dialect=new MySqlDialect();
function fixture(tables:Record<string,Row[]>){
 const queries:{sql:string;params:unknown[]}[]=[];
 const reader:Reader={close:async()=>{},rows:async<T extends Row>(q:SQL)=>{const compiled=dialect.sqlToQuery(q);queries.push(compiled);const key=Object.keys(tables).find(k=>compiled.sql.includes(k));return (key?tables[key]:[]) as T[];}};
 return {reader,queries};
}
it('validates mutually exclusive bounded source and search queries',()=>{
 expect(parseContentQuery({source:`https://www.youtube.com/live/${id}`})).toEqual({source:`https://youtu.be/${id}`});
 expect(parseContentQuery({q:'  音樂  '})).toEqual({q:'音樂',kind:'live'});
 for(const q of [{q:'a'},{q:'x'.repeat(101)},{q:['music']},{q:'music',kind:'all'},{source:'https://evil.test/foo'},{source:channelId,q:'music'},{source:[channelId]},{q:'ab\ncd'}])expect(parseContentQuery(q)).toBeNull();
});
it('looks up exact source ingestion and owner tags without needing public cache rows',async()=>{
 const f=fixture({'FROM urt_video WHERE':[{videoId:id,u_id:7,title:'現場',ctime:'2026-11-15 20:00:00'}],'FROM urt_video_live l':[{videoId:id,u_id:7,title:'現場',del_flag:1}],'FROM urt_channel c':[{u_id:7,youtube_id:channelId,title:'樂團',flag_del:0,tags:'[1][8]'}]});
 const result=await lookupContent(f.reader,{source:`https://youtu.be/${id}`},now);
 expect(result).toMatchObject({videoId:id,channel:{channelId:7,youtubeChannelId:channelId,tags:[1,8],archived:false},video:{videoId:id,collectedAt:now.toISOString()},live:{retired:true}});
 expect(result.matches.map(m=>m.href)).toEqual([`/videos/${id}`,`/live/videos/${id}/trend`,'/channels/7']);
 expect(f.queries.every(q=>q.sql.startsWith('SELECT'))).toBe(true);
 expect(f.queries.slice(0,2).every(q=>q.sql.includes('BINARY'))).toBe(true);
});
it('does not claim unknown source is captured or silently resolve ambiguous handles',async()=>{
 expect(await lookupContent(fixture({}).reader,{source:`https://youtu.be/${id}`},now)).toMatchObject({channel:null,video:null,live:null,matches:[]});
 const f=fixture({'FROM urt_channel c':[{u_id:1},{u_id:2}]});
 expect((await lookupContent(f.reader,{source:'@duplicate'},now)).channel).toBeNull();
});
it('finds a live owner even before video metadata is ingested',async()=>{
 const f=fixture({'FROM urt_video_live l':[{videoId:id,u_id:7,title:null,del_flag:null}],'FROM urt_channel c':[{u_id:7,title:'台',youtube_id:channelId,tags:null}]});
 expect(await lookupContent(f.reader,{source:`https://youtu.be/${id}`},now)).toMatchObject({video:null,live:{videoId:id,title:id,channelId:7},channel:{channelId:7}});
});
it('escapes literal wildcard searches, includes retired lives and caps results',async()=>{
 const f=fixture({'FROM urt_video_live l':[{videoId:id,u_id:7,title:'100%_music',del_flag:1}]});
 const result=await lookupContent(f.reader,{q:'100%_!',kind:'live'},now);
 expect(result.matches).toMatchObject([{kind:'live',retired:true}]);
 expect(f.queries[0]!.params).toContain('%100!%!_!!%');
 expect(f.queries[0]!.sql).toContain('LIMIT 25');
 expect(f.queries[0]!.sql).not.toContain('del_flag=');
});
it('channel results carry their YouTube identity independently of the managed-channel list',async()=>{
 const f=fixture({'FROM urt_channel c':[{u_id:8,youtube_id:channelId,title:'頻道'}]});
 const result=await lookupContent(f.reader,{q:channelId,kind:'channel'},now);
 expect(result.matches[0]).toMatchObject({id:'8',youtubeChannelId:channelId,href:'/channels/8'});
 expect(f.queries[0]!.sql).toContain('BINARY c.youtube_id=BINARY');
});

it('resolves a new live owner without creating ingestion records or claiming collection',async()=>{
 const f=fixture({'FROM urt_channel c':[{u_id:7,youtube_id:channelId,title:'Owner',flag_del:0,tags:'[1]'}]});
 const result=await lookupContent(f.reader,{source:`https://youtu.be/${id}`},now,async videoId=>({videoId,title:'Live now',channelId,channelTitle:'Owner',broadcast:'live'}));
 expect(result).toMatchObject({youtube:{broadcast:'live',channelId},channel:{channelId:7},video:null,live:null});
 expect(f.queries.at(-1)?.params).toEqual([channelId,channelId]);expect(f.queries.every(q=>q.sql.startsWith('SELECT'))).toBe(true);
});
