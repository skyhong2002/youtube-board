import {it,expect} from 'vitest';
import {cursorPk,cursorTimestamp,decodeVideoCursor,encodeVideoCursor,videoFilterDigest,VIDEO_CURSOR_MAX_AGE_MS,type VideoCursor} from '../src/public-api/cursor.js';
import {normalizedIdList} from '../src/reports/query.js';
const now=new Date('2036-05-12T04:00:00Z'),filters=videoFilterDigest({channelIds:[1,2],hours:24});
const value:VideoCursor={v:1,publishedAt:'2036-05-12 11:59:59.123456',pk:'9007199254740993',maxPk:'18446744073709551615',anchor:now.toISOString(),filters,vocabulary:null};
const raw=(v:unknown)=>Buffer.from(JSON.stringify(v)).toString('base64url');
it('roundtrips exact SQL timestamp microseconds and BIGINTs without timezone or number conversion',()=>{
 expect(decodeVideoCursor(encodeVideoCursor(value),now,filters)).toEqual(value);
 expect(cursorPk(Number.MAX_SAFE_INTEGER)).toBe('9007199254740991');
 expect(cursorTimestamp(null)).toBeNull();
 expect(normalizedIdList('2,01,2')).toEqual([1,2]);
});
it('rejects unbounded, noncanonical, wrong-scope or malformed unsigned tokens',()=>{
 const canonical=encodeVideoCursor(value);
 for(const token of ['',[],canonical+'=',canonical+'\n','A'.repeat(1025),raw({...value,extra:true}),raw({...value,v:2}),raw({...value,pk:'09007199254740993'}),raw({...value,pk:9007199254740992}),raw({...value,maxPk:'1'}),raw({...value,publishedAt:'2036-02-30 12:00:00'}),raw({...value,publishedAt:'2036-05-12T11:59:59Z'}),raw({...value,publishedAt:'2036-05-12 24:00:00'}),raw({...value,publishedAt:'2036-05-12 11:59:59.1234567'}),raw({...value,anchor:'2036-05-12T04:00:01.000Z'}),raw({...value,vocabulary:'x'.repeat(101)})])expect(()=>decodeVideoCursor(token,now,filters)).toThrow();
 expect(()=>decodeVideoCursor(canonical,now,'f'.repeat(64))).toThrow();
 expect(()=>decodeVideoCursor(canonical,new Date(+now+VIDEO_CURSOR_MAX_AGE_MS+1),filters)).toThrow();
 expect(()=>cursorPk(9007199254740992)).toThrow();
 expect(()=>cursorPk('18446744073709551616')).toThrow();
});
it('treats canonical modifications as public selectors rather than signatures or authority',()=>{
 const changed={...value,pk:'9007199254740992',publishedAt:null};
 expect(decodeVideoCursor(raw(changed),now,filters)).toEqual(changed);
});
it('invalid, expired or mismatched cursors return a public 400 through buildApp before any SQL',async()=>{
 const {buildApp}=await import('../src/app.js');
 let clock=now,reads=0;
 const app=buildApp({dataset:'fixture',clock:()=>clock,reader:{rows:async()=>{reads++;return [];},close:async()=>{}}});
 const general=videoFilterDigest({scope:'general',column:'publishedAt',channelId:null,channelIds:[],all:[],any:[],not:[],term:null,from:null,to:null,since:null,until:null,rankingPool:null,hours:null,min:null,days:null,keyword:null});
 const valid=encodeVideoCursor({...value,filters:general});
 try{
  for(const cursor of ['not-a-cursor',encodeVideoCursor(value),'A'.repeat(1025)]){
   const response=await app.inject({url:'/api/v1/videos?cursor='+encodeURIComponent(cursor),remoteAddress:'192.0.2.10'});
   expect(response.statusCode).toBe(400);expect(response.json()).toMatchObject({code:expect.any(String)});expect(response.headers['cache-control']).not.toContain('s-maxage');
  }
  expect((await app.inject({url:'/api/v1/videos?column=viewCount&cursor='+valid,remoteAddress:'192.0.2.10'})).statusCode).toBe(400);
  expect((await app.inject({url:'/api/v1/videos?offset=1&cursor='+valid,remoteAddress:'192.0.2.10'})).statusCode).toBe(400);
  clock=new Date(+now+VIDEO_CURSOR_MAX_AGE_MS+1);
  const expired=await app.inject({url:'/api/v1/videos?cursor='+valid,remoteAddress:'192.0.2.10'});
  expect(expired.statusCode).toBe(400);expect(expired.body).toContain('restart pagination');
  expect(reads).toBe(0);
 }finally{await app.close();}
});
