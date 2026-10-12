import {it,expect} from 'vitest';
import {MySqlDialect} from 'drizzle-orm/mysql-core';
import type {SQL} from 'drizzle-orm';
import type {Reader,Row} from '../src/db/client.js';
import {registerEditorialPublic} from '../src/reports/editorial.js';
import type {Register} from '../src/reports/table.js';
const id='11111111-1111-4111-8111-111111111111',channelId='UC'+'a'.repeat(22),dialect=new MySqlDialect();
it.each([[channelId,channelId],['UC'+'b'.repeat(22),channelId],[undefined,undefined],[null,null],['',''],[channelId,undefined],[undefined,channelId],['invalid','invalid']])('editorial video source requires valid exact retained provenance identity (%s / %s)',async (current,captured)=>{
 const statements:string[]=[],row={id,title:'event',version:1,merged_into:null,created_at:'2026-10-12 00:00:00',updated_at:'2026-10-12 00:00:00'};
 const reader:Reader={rows:async<T extends Row>(query:SQL)=>{const q=dialect.sqlToQuery(query).sql;statements.push(q);let rows:Row[]=[];
  if(q.startsWith('SELECT id,title,version,merged_into')||q.startsWith('SELECT version,merged_into'))rows=[row];
  else if(q.startsWith('SELECT s.id,OCTET_LENGTH'))rows=[{id:'source',payload_bytes:100}];
  else if(q.startsWith('SELECT id,kind,source_id'))rows=[{id:'source',kind:'video',source_id:'ExactCase01',provenance_json:JSON.stringify({channelId:captured}),published_at:null,observed_at:null}];
  else if(q.includes('FROM urt_video v'))rows=[{videoId:'ExactCase01',u_id:7,channelTitle:'Source',youtubeChannelId:current}];
  return rows as T[];},close:async()=>{}};
 let handler:Parameters<Register>[1]|undefined;registerEditorialPublic((path,fn)=>{if(path.endsWith('/:id'))handler=fn;},reader);
 const data=await handler!({id},{}) as {sources:{thumbnail:string;sourceChannel:{channelId:number}|null}[]};expect(statements.filter(s=>s.includes('FROM urt_video v'))).toHaveLength(1);expect(data.sources[0]?.thumbnail).toBe('https://i.ytimg.com/vi/ExactCase01/mqdefault.jpg');expect(data.sources[0]?.sourceChannel?.channelId??null).toBe(current===channelId&&captured===channelId?7:null);
});
