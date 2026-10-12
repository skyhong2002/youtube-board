import {describe,it,expect,vi} from 'vitest';
import {MySqlDialect} from 'drizzle-orm/mysql-core';
import type {SQL} from 'drizzle-orm';
import type {Reader,Row} from '../src/db/client.js';
import {enrichPublicMedia,type MediaLookup} from '../src/reports/media.js';
import {channel,video} from '../src/reports/normalize.js';
import {isFilterOptions} from '../../shared/filter-options.js';
import type {ChannelAvatar} from '../../shared/media-assets.js';
const dialect=new MySqlDialect(),a='UC'+'A'.repeat(22),b='UC'+'B'.repeat(22),revision='f'.repeat(64);
const avatar=(id:number):ChannelAvatar=>({url:`/media/channels/${id}/${revision}.png`,revision,width:192,height:192,cachedAt:'2026-10-12T00:00:00.000Z'});
function reader(rows:Row[]=[]){const queries:ReturnType<MySqlDialect['sqlToQuery']>[]=[];const result:Reader={rows:async<T extends Row>(q:SQL)=>{queries.push(dialect.sqlToQuery(q));return rows as T[];},close:async()=>{}};return {reader:result,queries};}
function lookup(ids:number[]=[]):MediaLookup{return {cachedIds:vi.fn(async()=>new Set(ids)),avatars:vi.fn(async (items:Array<{id:number;channelId:string}>)=>new Map(items.map(i=>[i.id,avatar(i.id)])))};}
const videoRow=(id='Abcdef123_-',idChannel=a)=>video({videoId:id,u_id:1,channelId:idChannel,channelTitle:'相同媒體名',thumbnails:'https://private.invalid/secret',mtime:'2026-10-10 09:00:00'});
describe('public media presentation enrichment',()=>{
 it('normalizers never expose untrusted thumbnail URLs; valid video identity stays byte exact',()=>{
  expect(channel({u_id:1,youtube_id:a,thumbnails:'https://private.invalid/secret'},new Map()).thumbnail).toBeNull();
  expect(videoRow().thumbnail).toBe('https://i.ytimg.com/vi/Abcdef123_-/mqdefault.jpg');
  expect(videoRow('abcdef123_-').thumbnail).not.toBe(videoRow().thumbnail);
  for(const id of ['bad',' Abcdef123_-','../abcdef12','Abcdef123_-\n','Abcdef123_-?x'])expect(videoRow(id).thumbnail).toBeNull();
 });
 it('does no lookup for reports without media and no SQL when optional cache is missing',async()=>{
  const db=reader(),cache=lookup();await enrichPublicMedia(db.reader,{rows:[{value:'metric'}]},cache);expect(cache.cachedIds).not.toHaveBeenCalled();
  const data={rows:[videoRow()],channel:channel({u_id:1,youtube_id:a},new Map())};await enrichPublicMedia(db.reader,data,cache);
  expect(db.queries).toHaveLength(0);expect(cache.avatars).not.toHaveBeenCalled();expect(data.rows[0]?.channelAvatar).toBeNull();expect(data.channel.avatar).toBeNull();
 });
 it('batches directory, videos, live, evidence and linked cells with one current-identity query',async()=>{
  const db=reader([{u_id:1,youtube_id:a},{u_id:2,youtube_id:b}]),cache=lookup([1,2]);
  const data={channel:channel({u_id:1,youtube_id:a},new Map()),videos:Array.from({length:200},()=>videoRow()),live:[{...videoRow(),currentViewers:12}],evidence:[{channelId:2,channelTitle:'相同媒體名',videoIds:['Abcdef123_-']}],rows:[{source:{value:'第二頻道',href:'/channels/2?date=2026-10-12'}},{source:{value:'影片',href:'/videos/Abcdef123_-/analytics'}}]};
  await enrichPublicMedia(db.reader,data,cache);
  expect(db.queries).toHaveLength(1);expect(db.queries[0]?.params).toEqual([1,2]);expect(db.queries[0]?.sql).not.toContain(a);expect(cache.avatars).toHaveBeenCalledTimes(1);
  expect(data.channel.avatar).toEqual(avatar(1));expect(data.channel.thumbnail).toBe(avatar(1).url);expect(data.videos.every(v=>v.channelAvatar?.url===avatar(1).url)).toBe(true);
  expect(data.live[0]?.channelAvatar).toEqual(avatar(1));expect(data.evidence[0]).toHaveProperty('channelAvatar',avatar(2));expect(data.rows[0]?.source).toHaveProperty('media',{kind:'channel',channelId:2,avatar:avatar(2)});expect(data.rows[1]?.source).toHaveProperty('media',{kind:'video',videoId:'Abcdef123_-',thumbnail:'https://i.ytimg.com/vi/Abcdef123_-/mqdefault.jpg'});
 });
 it('batch-enriches nested account/editorial/citation sources and analytics without videoIds arrays',async()=>{
  const db=reader([{u_id:1,youtube_id:a},{u_id:2,youtube_id:b}]),cache=lookup([1,2]);
  const data={saved:{sourceChannel:{channelId:1,channelTitle:'saved',youtubeChannelId:a,channelAvatar:null}},citation:{sourceChannel:{channelId:2,channelTitle:'citation',channelAvatar:null}},analytics:{channelId:1,channelTitle:'analytics',youtubeChannelId:a},cell:{value:'same',sources:[{channelId:2,channelTitle:'hourly',channelAvatar:null}]},unresolved:{channelId:null,channelTitle:'same',channelAvatar:null}};
  await enrichPublicMedia(db.reader,data,cache);expect(db.queries).toHaveLength(1);expect(cache.avatars).toHaveBeenCalledTimes(1);expect(data.saved.sourceChannel.channelAvatar).toEqual(avatar(1));expect(data.citation.sourceChannel.channelAvatar).toEqual(avatar(2));expect(data.analytics).toHaveProperty('channelAvatar',avatar(1));expect(data.cell.sources[0]?.channelAvatar).toEqual(avatar(2));expect(data.unresolved.channelAvatar).toBeNull();
 });
 it('does not confuse case-sensitive channel identities or reassign old videos to current brands',async()=>{
  const db=reader([{u_id:1,youtube_id:a.toLowerCase()}]),cache=lookup([1]);const data={video:videoRow(),channel:channel({u_id:1,youtube_id:a},new Map())};await enrichPublicMedia(db.reader,data,cache);expect(data.video.channelAvatar).toBeNull();expect(data.channel.avatar).toBeNull();
 });
 it('never queries names, remote/malformed links, opaque historical snapshots, or uncached IDs',async()=>{
  const db=reader(),cache=lookup([9]);const opaque={source:{value:'media',href:'/channels/9'},video:videoRow()};const data={result:opaque,lineage:opaque,history:[{before:opaque}],rows:[{value:'media',href:'https://elsewhere.test/channels/9'},{value:'media',href:'/channels/01'},{value:'media',href:'/channels/9evil'},{value:'media',href:'/channels/9007199254740992'}],video:videoRow()};
  const before=JSON.stringify(opaque);await enrichPublicMedia(db.reader,data,cache);expect(JSON.stringify(opaque)).toBe(before);expect(db.queries).toHaveLength(0);expect(data.rows.every(r=>!('media' in r))).toBe(true);
 });
 it('conflicting identities and optional cache or identity-read errors keep safe null fallbacks',async()=>{
  const data=()=>({video:videoRow()});const conflicting=reader([{u_id:1,youtube_id:a},{u_id:1,youtube_id:b}]);const first=data();await enrichPublicMedia(conflicting.reader,first,lookup([1]));expect(first.video.channelAvatar).toBeNull();
  for(const cache of [{cachedIds:async()=>{throw Error('cache unavailable');},avatars:vi.fn()}, {cachedIds:async()=>new Set([1]),avatars:async()=>{throw Error('cache changed');}}]){const out=data();await enrichPublicMedia(reader([{u_id:1,youtube_id:a}]).reader,out,cache);expect(out.video.channelAvatar).toBeNull();}
  const failing:Reader={rows:async()=>{throw Error('optional read unavailable');},close:async()=>{}};await expect(enrichPublicMedia(failing,data(),lookup([1]))).resolves.toHaveProperty('video.channelAvatar',null);
 });
 it('filter-option decoder permits only matching local revisioned channel avatars',()=>{
  const option=(image:unknown)=>({kind:'channels',rows:[{id:'1',label:'Source',avatar:image}],hasMore:false,missingIds:[]});
  expect(isFilterOptions(option(avatar(1)),'channels')).toBe(true);expect(isFilterOptions(option(null),'channels')).toBe(true);
  for(const image of [avatar(2),{...avatar(1),url:'https://private.test/image'},{...avatar(1),revision:'e'.repeat(64)},{...avatar(1),width:12}])expect(isFilterOptions(option(image),'channels')).toBe(false);
 });
});
