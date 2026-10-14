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
 for(const headers of [{'cache-control':'public, max-age=300'},{'cache-control':'private, no-store'},{'cache-control':'public, max-age=300','set-cookie':'private-value'}]){
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
