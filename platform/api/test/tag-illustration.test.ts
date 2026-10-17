import {afterEach,expect,it,vi} from 'vitest';
import {buildApp} from '../src/app.js';
import {createTagIllustration,inertTagSvg,parseTagPicture} from '../src/reports/tag-illustration.js';
import {pictureRevision,tagPicturePath,tagPictureUpstream} from '../../shared/tag-illustration.js';
import {PUBLIC_ENDPOINTS} from '../src/public-api/catalog.js';
import {responseValidator} from '../../tools/check-openapi.js';
import type {FastifyInstance} from 'fastify';
const tag='沈伯洋',revision='t3.1-1';
const credit={pageUrl:'https://commons.wikimedia.org/wiki/File:Example.jpg',artist:'範例作者',license:'CC BY-SA 4.0',licenseUrl:'https://creativecommons.org/licenses/by-sa/4.0/'};
const person={tag,person:{label:tag,avatar:{url:'/api/v1/tags/'+encodeURIComponent(tag)+'/avatar?v='+revision,...credit}}};
const env={TS_TAG_RELATIONS_ENABLED:'true',TS_TAG_RELATIONS_AUTH_MODE:'anonymous'};
const apps:FastifyInstance[]=[];afterEach(async()=>{await Promise.all(apps.splice(0).map(app=>app.close()));});
const server=(fetcher:typeof fetch)=>{const rows=vi.fn(async()=>[]),app=buildApp({reader:{rows,close:async()=>{}},publicApi:false,tagRelations:{env,fetcher}});apps.push(app);return {app,rows};};
const mock=(fn:(url:string,init:RequestInit)=>Promise<Response>)=>vi.fn((url:unknown,init:RequestInit={})=>fn(String(url),init)) as unknown as typeof fetch;
it('keeps exact keyword encoding and only allows fixed upstream picture paths',()=>{
 const special='a/b%41';const url='/api/v1/tags/'+encodeURIComponent(special)+'/avatar?v='+revision;
 expect(pictureRevision(url,special,'avatar')).toBe(revision);
 expect(tagPictureUpstream(special,'avatar',revision)).toBe('https://tag.observe.tw'+url+'&accent=ff0000&layer=color');
 for(const bad of ['https://evil.example'+url,url+'&url=https://evil.example',url+'&v=second',url+'&layer=fill',url+'#x',url.replace(encodeURIComponent(special),encodeURIComponent('other'))])expect(pictureRevision(bad,special,'avatar')).toBeNull();
 expect(pictureRevision(url,special,'visual')).toBeNull();expect(()=>tagPicturePath(' private','avatar',revision)).toThrow();
});
it('copies public picture and license fields without private/future source data',()=>{
 const result=parseTagPicture({...person,privateToken:'secret'},tag,'person');
 expect(result).toEqual({kind:'avatar',label:tag,image:tagPicturePath(tag,'avatar',revision),emoji:null,attribution:credit});
 expect(JSON.stringify(result)).not.toContain('secret');
 expect(()=>parseTagPicture({...person,tag:'other'},tag,'person')).toThrow();
 expect(()=>parseTagPicture({tag,person:{label:tag,avatar:{...person.person.avatar,pageUrl:'javascript:alert(1)'}}},tag,'person')).toThrow();
});
it('distinguishes nonperson visuals, emoji and genuine missing pictures',()=>{
 expect(parseTagPicture({tag,person:null},tag,'person')).toBeNull();
 expect(parseTagPicture({tag,visual:null},tag,'visual')).toBeNull();
 expect(parseTagPicture({tag,visual:{kind:'emoji',label:null,emoji:'🚆',image:null,source:null}},tag,'visual')).toMatchObject({kind:'emoji',label:tag,emoji:'🚆',image:null});
 expect(parseTagPicture({tag,visual:{kind:'place',label:'範例地方',image:'/api/v1/tags/'+encodeURIComponent(tag)+'/visual-image?v='+revision,source:null}},tag,'visual')).toMatchObject({kind:'place',image:tagPicturePath(tag,'visual',revision)});
});
it('does not read credentials or contact upstream when disabled; missing credentials fail closed',async()=>{
 const fetcher=vi.fn(),credentials=vi.fn();expect((await createTagIllustration({env:{},fetcher,credentials}).report(tag)).status).toBe('disabled');
 expect(fetcher).not.toHaveBeenCalled();expect(credentials).not.toHaveBeenCalled();
 expect((await createTagIllustration({env:{TS_TAG_RELATIONS_ENABLED:'true'},fetcher,credentials:async()=>({})}).report(tag)).status).toBe('unavailable');expect(fetcher).not.toHaveBeenCalled();
});
it('serves picture metadata private/no-store for every sensitive request and sends only its own DNT headers',async()=>{
 const fetcher=mock(async(_url,init)=>{
  const h=new Headers(init.headers);expect(h.get('dnt')).toBe('1');expect(h.get('sec-gpc')).toBe('1');
  for(const k of ['cookie','authorization','x-api-key','x-service-token','referer','x-forwarded-for'])expect(h.has(k)).toBe(false);
  expect(init.credentials).toBe('omit');expect(init.redirect).toBe('error');return Response.json(person);
 });
 const {app,rows}=server(fetcher),validate=responseValidator(PUBLIC_ENDPOINTS.find(e=>e.path==='/api/v1/keywords/:keyword/illustration')!);
 for(const header of [null,'cookie','authorization','x-api-key','x-service-token','rsc']){
  const response=await app.inject({url:'/api/v1/keywords/'+encodeURIComponent(tag)+'/illustration',headers:header?{[header]:'private-inbound'}:{}});
  expect(response.statusCode).toBe(200);expect(response.json().data.status).toBe('available');expect(response.headers['cache-control']).toBe('private, no-store');
  expect(response.body).not.toContain('private-inbound');expect(validate(response.json()),JSON.stringify(validate.errors)).toBe(true);
 }
 expect(rows).not.toHaveBeenCalled();
});
it('falls back to visual only after a successful empty person read',async()=>{
 const fetcher=mock(async url=>Response.json(url.includes('/person?')?{tag,person:null}:{tag,visual:null}));
 expect(await createTagIllustration({env,fetcher}).report(tag)).toMatchObject({status:'available',illustration:null});
 expect(fetcher).toHaveBeenCalledTimes(2);
 const failing=mock(async()=>new Response('',{status:503}));expect((await createTagIllustration({env,fetcher:failing}).report(tag)).status).toBe('unavailable');expect(failing).toHaveBeenCalledTimes(1);
});
it.each([429,503,307])('does not turn upstream %s into successful absence',async status=>{
 const fetcher=mock(async()=>new Response('',{status,headers:{'Retry-After':'120'}}));
 expect(await createTagIllustration({env,fetcher}).report(tag)).toMatchObject({status:'unavailable',illustration:null});
});
it('respects upstream cooldown across keywords',async()=>{
 const fetcher=mock(async()=>new Response('',{status:429,headers:{'Retry-After':'120'}})),client=createTagIllustration({env,fetcher});
 await client.report(tag);await client.report('另一詞');expect(fetcher).toHaveBeenCalledTimes(1);
});
it('rejects oversized metadata and does not expose transport errors',async()=>{
 const fetcher=mock(async()=>Response.json({...person,extra:'x'.repeat(131072)}));
 expect((await createTagIllustration({env,fetcher}).report(tag)).status).toBe('unavailable');
 const failed=mock(async()=>{throw Error('SECRET-runtime');});expect(JSON.stringify(await createTagIllustration({env,fetcher:failed}).report(tag))).not.toContain('SECRET-runtime');
});
it('permits inert SVG shapes and rejects external resources, active elements and malformed markup',()=>{
 const safe='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><g fill="#ff0000"><path d="M0 0L10 10"/></g></svg>';
 expect(inertTagSvg(Buffer.from(safe)).toString()).toContain('<path');
 for(const content of ['<script>alert(1)</script>','<image href="https://evil.example/x"/>','<path fill="url(https://evil.example/x)"/>','<foreignObject/>','<g style="fill:red"/>','<g onclick="x()"/>','<style>@import "https://evil.example"</style>','<use href="#a"/>'])expect(()=>inertTagSvg(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">'+content+'</svg>'))).toThrow();
 for(const input of ['<!DOCTYPE svg><svg/>','<?xml version="1.0"?><svg/>','<svg/> <svg/>','<svg>&#65;</svg>'])expect(()=>inertTagSvg(Buffer.from(input))).toThrow();
});
it('same-origin image endpoint returns inert SVG with sandbox and no-store; never forwards user data',async()=>{
 const fetcher=mock(async(url,init)=>{expect(url).toBe(tagPictureUpstream(tag,'visual',revision));expect(new Headers(init.headers).has('cookie')).toBe(false);return new Response('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L1 1"/></svg>',{headers:{'content-type':'image/svg+xml'}});});
 const {app}=server(fetcher),response=await app.inject({url:tagPicturePath(tag,'visual',revision),headers:{cookie:'private-cookie'}});
 expect(response.statusCode).toBe(200);expect(response.headers['content-type']).toContain('image/svg+xml');expect(response.headers['cache-control']).toBe('private, no-store');expect(response.headers['content-security-policy']).toContain('sandbox');expect(response.body).not.toContain('private-cookie');
});
it('rejects bad image MIME, magic, oversized bytes and unsafe SVG as 404 without raw upstream output',async()=>{
 for(const r of [new Response('SECRET',{headers:{'content-type':'text/html'}}),new Response('SECRET',{headers:{'content-type':'image/webp'}}),new Response('x'.repeat(524289),{headers:{'content-type':'image/webp'}}),new Response('<svg onload="SECRET"/>',{headers:{'content-type':'image/svg+xml'}})]){
  const {app}=server(mock(async()=>r));const response=await app.inject(tagPicturePath(tag,'avatar',revision));expect(response.statusCode).toBe(404);expect(response.body).not.toContain('SECRET');
 }
});
it('only reuses explicitly public anonymous responses, never private or cookie-bearing pictures',async()=>{
 const variants:Array<Record<string,string>>=[{'cache-control':'public, max-age=300'},{'cache-control':'private, no-store'},{'cache-control':'public, max-age=300','set-cookie':'private-value'}];
 for(const headers of variants){
  const fetcher=mock(async()=>Response.json(person,{headers})),client=createTagIllustration({env,fetcher});
  await client.report(tag);await client.report(tag);
  expect(fetcher).toHaveBeenCalledTimes('set-cookie' in headers||headers['cache-control'].startsWith('private')?2:1);
 }
});
it('deadlines include ignored-abort transports and stalled bodies; late work cannot cache or grow beyond two',async()=>{
 vi.useFakeTimers();
 try{
  const pending:Array<(r:Response)=>void>=[],fetcher=mock(()=>new Promise(resolve=>pending.push(resolve))),client=createTagIllustration({env,fetcher});
  const first=client.report(tag);await vi.advanceTimersByTimeAsync(3000);expect((await first).status).toBe('unavailable');
  const second=client.report('另一詞');await vi.advanceTimersByTimeAsync(3000);expect((await second).status).toBe('unavailable');
  expect((await client.report('第三詞')).status).toBe('unavailable');expect(fetcher).toHaveBeenCalledTimes(2);
  for(const resolve of pending)resolve(Response.json(person,{headers:{'cache-control':'public, max-age=60'}}));
  await vi.advanceTimersByTimeAsync(0);
  const third=client.report(tag);await vi.advanceTimersByTimeAsync(3000);expect((await third).status).toBe('unavailable');expect(fetcher).toHaveBeenCalledTimes(3);
  pending.at(-1)!(Response.json(person));await vi.advanceTimersByTimeAsync(0);
  const cancel=vi.fn(),stalled=createTagIllustration({env,fetcher:mock(async()=>new Response(new ReadableStream({pull(){},cancel}),{headers:{'content-type':'application/json'}}))});
  const body=stalled.report(tag);await vi.advanceTimersByTimeAsync(3000);expect((await body).status).toBe('unavailable');expect(cancel).toHaveBeenCalled();
  const creds=createTagIllustration({env:{TS_TAG_RELATIONS_ENABLED:'true'},credentials:()=>new Promise(()=>{}),fetcher});
  const config=creds.report(tag);await vi.advanceTimersByTimeAsync(3000);expect((await config).status).toBe('unavailable');expect(fetcher).toHaveBeenCalledTimes(3);
 }finally{vi.useRealTimers();}
});
const webp=()=>{const b=Buffer.alloc(16);b.write('RIFF',0,'ascii');b.writeUInt32LE(8,4);b.write('WEBP',8,'ascii');return b;};
const avatarUrl=(t:string,v=revision)=>'/api/v1/tags/'+encodeURIComponent(t)+'/avatar?v='+v;
const visualUrl=(t:string,v=revision,extra='')=>'/api/v1/tags/'+encodeURIComponent(t)+'/visual-image?v='+v+extra;
const bulk=(avatars:unknown,visuals:unknown)=>mock(async url=>url.endsWith('/api/v1/tag-avatars')?Response.json(avatars):url.endsWith('/api/v1/tag-visuals')?Response.json(visuals):new Response('',{status:404}));
it('bulk pictures: avatar wins, bad entries are skipped, aspect is clamped and __proto__ stays data',async()=>{
 const entries:Record<string,unknown>={
  [tag]:{kind:'logo',image:visualUrl(tag),emoji:null,aspect:2},'台積電':{kind:'logo',image:visualUrl('台積電','tmqtza'),emoji:null,aspect:3.97},'台北市':{kind:'place',image:visualUrl('台北市','tmqplo','&size=large'),emoji:null},
  '寬':{kind:'flag',image:visualUrl('寬'),aspect:40},'窄':{kind:'flag',image:visualUrl('窄'),aspect:0.01},'怪':{kind:'flag',image:visualUrl('怪'),aspect:'2'},'火車':{kind:'emoji',image:null,emoji:'🚆',aspect:3},'只有視覺':{kind:'place',image:visualUrl('只有視覺')},
  '壞種類':{kind:'svg',image:visualUrl('壞種類')},'壞網址':{kind:'logo',image:'https://evil.example/x.png'},'錯詞':{kind:'logo',image:visualUrl('別詞')},'空表情':{kind:'emoji',emoji:''},'長表情':{kind:'emoji',emoji:'x'.repeat(33)},'控制':{kind:'emoji',emoji:'a\u0007'},' 空白':{kind:'logo',image:visualUrl(' 空白')},'非物件':'x',
 };
 // Raw JSON text so __proto__ arrives as an own upstream key, as JSON.parse produces it.
 const visuals=JSON.parse('{"visuals":{"__proto__":{"kind":"emoji","emoji":"🧪"},'+JSON.stringify(entries).slice(1)+'}');
 const avatars={avatars:{[tag]:avatarUrl(tag),'壞頭像':'https://evil.example/a.webp','只有視覺':avatarUrl('別人')}};
 const result=await createTagIllustration({env,fetcher:bulk(avatars,visuals)}).pictures();
 expect(result.status).toBe('available');expect(result.source).toBe('https://tag.observe.tw');
 expect(result.pictures[tag]).toEqual({kind:'avatar',image:tagPicturePath(tag,'avatar',revision),emoji:null,aspect:null});
 expect(result.pictures['台積電']).toEqual({kind:'logo',image:tagPicturePath('台積電','visual','tmqtza'),emoji:null,aspect:3.97});
 expect(result.pictures['台北市']).toEqual({kind:'place',image:tagPicturePath('台北市','visual','tmqplo'),emoji:null,aspect:null});
 expect(result.pictures['寬']!.aspect).toBe(8);expect(result.pictures['窄']!.aspect).toBe(0.25);expect(result.pictures['怪']!.aspect).toBeNull();
 expect(result.pictures['火車']).toEqual({kind:'emoji',image:null,emoji:'🚆',aspect:null});
 expect(result.pictures['只有視覺']).toMatchObject({kind:'place'});
 expect(Object.getPrototypeOf(result.pictures)).toBeNull();expect(Object.hasOwn(result.pictures,'__proto__')).toBe(true);expect(result.pictures['__proto__']).toEqual({kind:'emoji',image:null,emoji:'🧪',aspect:null});
 expect(Object.keys(result.pictures).sort()).toEqual([tag,'台積電','台北市','寬','窄','怪','火車','只有視覺','__proto__'].sort());
});
it('bulk pictures: disabled does not contact upstream; malformed envelopes or a failed read are unavailable',async()=>{
 const fetcher=vi.fn();expect(await createTagIllustration({env:{},fetcher}).pictures()).toEqual({source:'https://tag.observe.tw',status:'disabled',pictures:{}});expect(fetcher).not.toHaveBeenCalled();
 for(const [a,v] of [[{avatars:[]},{visuals:{}}],[{avatars:{}},{visuals:null}],[{},{visuals:{}}],[[],{visuals:{}}]] as Array<[unknown,unknown]>)
  expect(await createTagIllustration({env,fetcher:bulk(a,v)}).pictures()).toEqual({source:'https://tag.observe.tw',status:'unavailable',pictures:{}});
 const failing=mock(async url=>url.endsWith('tag-visuals')?new Response('',{status:503}):Response.json({avatars:{[tag]:avatarUrl(tag)}}));
 expect((await createTagIllustration({env,fetcher:failing}).pictures()).status).toBe('unavailable');
 // 512 KiB envelope cap instead of the 128 KiB single-tag cap.
 const big=bulk({avatars:{[tag]:avatarUrl(tag),pad:'x'.repeat(200000)}},{visuals:{}});expect((await createTagIllustration({env,fetcher:big}).pictures()).status).toBe('available');
 const huge=bulk({avatars:{pad:'x'.repeat(524288)}},{visuals:{}});expect((await createTagIllustration({env,fetcher:huge}).pictures()).status).toBe('unavailable');
});
it('bulk route matches the catalog schema, keeps private/no-store and is not a :keyword route',async()=>{
 const {app}=server(bulk({avatars:{[tag]:avatarUrl(tag)}},{visuals:{'台北市':{kind:'place',image:visualUrl('台北市','tmqplo','&size=large'),emoji:null,aspect:1.5}}}));
 const endpoint=PUBLIC_ENDPOINTS.find(e=>e.path==='/api/v1/keywords/illustrations')!;expect(endpoint.parameters.filter(p=>p.in==='path')).toEqual([]);
 const response=await app.inject('/api/v1/keywords/illustrations'),validate=responseValidator(endpoint);
 expect(response.statusCode).toBe(200);expect(response.headers['cache-control']).toBe('private, no-store');
 const body=response.json();expect(validate(body),JSON.stringify(validate.errors)).toBe(true);expect(body.meta.source).toBe('tag.observe.tw');
 expect(body.data.pictures).toEqual({[tag]:{kind:'avatar',image:tagPicturePath(tag,'avatar',revision),emoji:null,aspect:null},'台北市':{kind:'place',image:tagPicturePath('台北市','visual','tmqplo'),emoji:null,aspect:1.5}});
});
it('accepts size=large on visual-image URLs but nothing else',()=>{
 expect(pictureRevision(visualUrl(tag,revision,'&size=large'),tag,'visual')).toBe(revision);
 expect(pictureRevision(visualUrl(tag,revision,'&size=huge'),tag,'visual')).toBeNull();
});
it('queues concurrent image reads behind the two upstream slots instead of failing',async()=>{
 let running=0,peak=0;
 const fetcher=mock(async()=>{running++;peak=Math.max(peak,running);await new Promise(r=>setTimeout(r,40));running--;return new Response(webp(),{headers:{'content-type':'image/webp'}});});
 const client=createTagIllustration({env,fetcher});
 const results=await Promise.allSettled(Array.from({length:9},(_,i)=>client.image(tag,'avatar','r'+i)));
 expect(results.map(r=>r.status)).toEqual(Array(9).fill('fulfilled'));expect(peak).toBe(2);expect(fetcher).toHaveBeenCalledTimes(9);
 const {app}=server(fetcher),responses=await Promise.all(Array.from({length:9},(_,i)=>app.inject(tagPicturePath(tag,'avatar','s'+i))));
 expect(responses.map(r=>r.statusCode)).toEqual(Array(9).fill(200));expect(responses.every(r=>r.headers['cache-control']==='private, no-store')).toBe(true);
});
it('bounds the image queue at 24 waiters and 4 seconds, and JSON reads still fail fast',async()=>{
 vi.useFakeTimers();
 try{
  const pending:Array<(r:Response)=>void>=[],fetcher=mock(()=>new Promise(resolve=>pending.push(resolve))),client=createTagIllustration({env,fetcher});
  const reads=Array.from({length:27},(_,i)=>client.image(tag,'avatar','q'+i).then(()=>'ok',()=>'failed'));
  expect(await reads[26]).toBe('failed');expect((await client.report(tag)).status).toBe('unavailable');
  await vi.advanceTimersByTimeAsync(0);expect(fetcher).toHaveBeenCalledTimes(2);
  // Two ignored-abort transports keep their slots; every waiter gives up at 4 s.
  await vi.advanceTimersByTimeAsync(4000);expect(await Promise.all(reads)).toEqual(Array(27).fill('failed'));expect(fetcher).toHaveBeenCalledTimes(2);
  for(const resolve of pending)resolve(new Response(webp(),{headers:{'content-type':'image/webp'}}));await vi.advanceTimersByTimeAsync(0);
  const later=client.image(tag,'avatar','after');await vi.advanceTimersByTimeAsync(0);pending.at(-1)!(new Response(webp(),{headers:{'content-type':'image/webp'}}));
  await expect(later).resolves.toMatchObject({mime:'image/webp'});
 }finally{vi.useRealTimers();}
});
it('queued image reads re-check the 429 cooldown when they receive a slot',async()=>{
 const gates:Array<()=>void>=[],fetcher=mock(async()=>{await new Promise<void>(r=>gates.push(r));return new Response('',{status:429,headers:{'Retry-After':'120'}});});
 const client=createTagIllustration({env,fetcher}),reads=Array.from({length:5},(_,i)=>client.image(tag,'avatar','c'+i).then(()=>'ok',()=>'failed'));
 await new Promise(r=>setTimeout(r,0));expect(fetcher).toHaveBeenCalledTimes(2);for(const open of gates)open();
 expect(await Promise.all(reads)).toEqual(Array(5).fill('failed'));expect(fetcher).toHaveBeenCalledTimes(2);
});
it('caches revisioned public images up to min(max-age, one day) in either auth mode, never private ones',async()=>{
 let now=Date.parse('2026-10-17T00:00:00Z');const clock=()=>new Date(now);
 const service={TS_TAG_RELATIONS_ENABLED:'true',TS_TAG_RELATIONS_AUTH_MODE:'service'},credentials=async()=>({serviceToken:'service-secret'});
 for(const [control,ttl] of [['public, max-age=86400',86400],['public, max-age=999999',86400],['public, max-age=120',120],['private, max-age=86400',0],['public, no-store, max-age=86400',0],['public',0]] as Array<[string,number]>){
  const fetcher=mock(async()=>new Response(webp(),{headers:{'content-type':'image/webp','cache-control':control}}));
  const client=createTagIllustration({env:service,credentials,fetcher,clock});
  await client.image(tag,'avatar',revision);now+=Math.max(0,ttl-1)*1000;await client.image(tag,'avatar',revision);
  expect(fetcher,control).toHaveBeenCalledTimes(ttl?1:2);
  now+=2000;await client.image(tag,'avatar',revision);expect(fetcher,control).toHaveBeenCalledTimes(ttl?2:3);
 }
 const cookie=mock(async()=>new Response(webp(),{headers:{'content-type':'image/webp','cache-control':'public, max-age=86400','set-cookie':'a=b'}})),client=createTagIllustration({env,fetcher:cookie,clock});
 await client.image(tag,'avatar',revision);await client.image(tag,'avatar',revision);expect(cookie).toHaveBeenCalledTimes(2);
 // Service-mode JSON metadata keeps the existing no-reuse rule.
 const json=bulk({avatars:{}},{visuals:{}}),meta=createTagIllustration({env:service,credentials,fetcher:json,clock});await meta.pictures();await meta.pictures();expect(json).toHaveBeenCalledTimes(4);
});
it('image cache keeps at most 64 entries and evicts oldest first',async()=>{
 const fetcher=mock(async()=>new Response(webp(),{headers:{'content-type':'image/webp','cache-control':'public, max-age=86400'}})),client=createTagIllustration({env,fetcher});
 for(let i=0;i<65;i++)await client.image(tag,'avatar','e'+i);expect(fetcher).toHaveBeenCalledTimes(65);
 await client.image(tag,'avatar','e64');await client.image(tag,'avatar','e1');expect(fetcher).toHaveBeenCalledTimes(65);
 await client.image(tag,'avatar','e0');expect(fetcher).toHaveBeenCalledTimes(66);
});
