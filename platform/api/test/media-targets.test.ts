import {beforeEach,it,expect,vi} from 'vitest';
import {MySqlDialect} from 'drizzle-orm/mysql-core';
import type {SQL} from 'drizzle-orm';
import type {Reader,Row} from '../src/db/client.js';
import type {Register} from '../src/reports/table.js';
import {accountTargets,accountFeed} from '../src/reader/feed.js';
import {registerFilterOptions} from '../src/reports/filter-options.js';
import type {FilterOptions} from '../../shared/filter-options.js';
const cache=vi.hoisted(()=>({readChannelAvatars:vi.fn()}));
vi.mock('../../shared/media-cache/index.js',()=>cache);
const dialect=new MySqlDialect(),channelId='UC'+'a'.repeat(22),revision='a'.repeat(64),avatar={url:`/media/channels/1/${revision}.png`,revision,width:192,height:192,cachedAt:'2026-10-12T00:00:00.000Z'};
function mock(respond:(sql:string)=>Row[]){const queries:ReturnType<MySqlDialect['sqlToQuery']>[]=[];const reader:Reader={rows:async<T extends Row>(q:SQL)=>{const query=dialect.sqlToQuery(q);queries.push(query);return respond(query.sql) as T[];},close:async()=>{}};return {reader,queries};}
beforeEach(()=>{cache.readChannelAvatars.mockReset().mockResolvedValue(new Map([[1,avatar]]));});
it('channel search suggestions resolve current identities in their existing query and one cache batch',async()=>{
 const db=mock(()=>[{id:1,label:' Source ',youtube_id:channelId},{id:2,label:'Other',youtube_id:'UC'+'b'.repeat(22)}]);let handler:Parameters<Register>[1]|undefined;
 registerFilterOptions((_path,fn)=>{handler=fn;},db.reader);const data=await handler!({kind:'channels'},{q:'Source',limit:'2'}) as FilterOptions;
 expect(db.queries).toHaveLength(1);expect(db.queries[0]?.sql).toContain('youtube_id');expect(cache.readChannelAvatars).toHaveBeenCalledOnce();expect(cache.readChannelAvatars).toHaveBeenCalledWith([{id:1,channelId},{id:2,channelId:'UC'+'b'.repeat(22)}]);
 expect(data.rows).toEqual([{id:'1',label:'Source',avatar},{id:'2',label:'Other',avatar:null}]);expect(JSON.stringify(data)).not.toContain(channelId);
});
it('taxonomy suggestions have no channel cache access',async()=>{
 const db=mock(()=>[{id:1,label:'Category'}]);let handler:Parameters<Register>[1]|undefined;registerFilterOptions((_path,fn)=>{handler=fn;},db.reader);
 const data=await handler!({kind:'tags'},{}) as FilterOptions;expect(data.rows).toEqual([{id:'1',label:'Category'}]);expect(cache.readChannelAvatars).not.toHaveBeenCalled();
});
it('follow targets use one cache batch for current exact channels and canonical saved thumbnails',async()=>{
 const db=mock(q=>q.includes('FROM urt_channel')?[{target:'1',label:'Source',youtube_id:channelId}]:q.includes('FROM urt_video')?[{target:'Abcdef123_-',label:'Video'}]:[]);
 const data=await accountTargets(db.reader,[{kind:'channel',target:'1'},{kind:'channel',target:'2'},{kind:'video',target:'Abcdef123_-'}]);
 expect(db.queries).toHaveLength(2);expect(cache.readChannelAvatars).toHaveBeenCalledOnce();expect(cache.readChannelAvatars).toHaveBeenCalledWith([{id:1,channelId}]);expect(data[0]).toMatchObject({avatar,available:true});expect(data[1]).toMatchObject({avatar:null,available:false});expect(data[2]).toMatchObject({thumbnail:'https://i.ytimg.com/vi/Abcdef123_-/mqdefault.jpg',available:true});expect(JSON.stringify(data)).not.toContain(channelId);
});
it('failed optional cache leaves target availability and labels intact',async()=>{
 cache.readChannelAvatars.mockRejectedValue(Error('cache unavailable'));const db=mock(()=>[{target:'1',label:'Source',youtube_id:channelId}]);
 expect((await accountTargets(db.reader,[{kind:'channel',target:'1'}]))[0]).toMatchObject({avatar:null,available:true,label:'Source'});
});
it('reader feed constructs canonical video images without another query or cache read',async()=>{
 const db=mock(q=>q.includes('SELECT kind,target')?[{kind:'channel',target:'1'}]:q.includes('FROM urt_video')?[{videoId:'Abcdef123_-',title:'Video',publishedAt:'2026-10-12 08:00:00',mtime:'2026-10-12 08:00:00',thumbnails:'https://unsafe.invalid'}]:[]);
 const data=await accountFeed(db.reader,1,()=>new Date('2026-10-12T05:00:00Z'));expect(data.items[0]?.thumbnail).toBe('https://i.ytimg.com/vi/Abcdef123_-/mqdefault.jpg');expect(cache.readChannelAvatars).not.toHaveBeenCalled();expect(db.queries).toHaveLength(3);expect(JSON.stringify(data)).not.toContain('unsafe.invalid');
});
