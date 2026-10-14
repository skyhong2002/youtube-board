import {createHash} from 'node:crypto';
import {afterEach,expect,it,vi} from 'vitest';
import type {FastifyInstance} from 'fastify';
import {buildApp} from '../src/app.js';
import {PUBLIC_ENDPOINTS} from '../src/public-api/catalog.js';
import {responseValidator} from '../../tools/check-openapi.js';
const apps:FastifyInstance[]=[];
afterEach(async()=>{await Promise.all(apps.splice(0).map(app=>app.close()));});
const term='交通',path='/api/v1/keywords/'+encodeURIComponent(term)+'/relations';
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
const payload={tag:term,tagId:sha(term),truncated:false,relations:[]};
function server(options:Parameters<typeof buildApp>[0]={}){
 const rows=vi.fn(async()=>[]),app=buildApp({reader:{rows,close:async()=>{}},publicApi:false,...options});apps.push(app);return {app,rows};
}
it('defaults to disabled with truthful provenance and no DB, credential read or upstream request',async()=>{
 const fetcher=vi.fn(),credentials=vi.fn(),{app,rows}=server({tagRelations:{env:{},fetcher,credentials}});
 const result=await app.inject(path);
 expect(result.statusCode).toBe(200);expect(result.json()).toMatchObject({data:{status:'disabled',reason:'disabled',relations:[],tagId:null},meta:{source:'tag.observe.tw',updatedAt:null}});
 expect(fetcher).not.toHaveBeenCalled();expect(credentials).not.toHaveBeenCalled();expect(rows).not.toHaveBeenCalled();
 const validate=responseValidator(PUBLIC_ENDPOINTS.find(e=>e.path==='/api/v1/keywords/:keyword/relations')!);
 expect(validate(result.json()),JSON.stringify(validate.errors)).toBe(true);
 expect(result.headers['cache-control']).toContain('s-maxage=60');
});
it('keeps actual empty relations distinct from disabled and preserves all credential cache boundaries',async()=>{
 const fetcher=vi.fn(async(_url:unknown,init?:RequestInit)=>{
  const h=new Headers(init?.headers);expect(h.get('x-service-token')).toBe('configured-test-service');expect(h.get('cookie')).toBeNull();expect(h.get('authorization')).toBeNull();
  return Response.json(payload);
 });
 const {app}=server({tagRelations:{env:{TS_TAG_RELATIONS_ENABLED:'true'},fetcher,credentials:async()=>({serviceToken:'configured-test-service'})}});
 for(const header of [null,'cookie','authorization','x-api-key','x-service-token','rsc']){
  const result=await app.inject({url:path,headers:header?{[header]:'incoming-test-value'}:{}});
  expect(result.statusCode).toBe(200);expect(result.json().data).toMatchObject({status:'available',reason:null,tagId:sha(term),relations:[]});
  expect(result.headers['cache-control']).toBe('private, no-store');
  expect(result.body).not.toContain('configured-test-service');
 }
 const head=await app.inject({url:path,method:'HEAD'});expect(head.statusCode).toBe(200);expect(head.body).toBe('');
});
it.each([404,429,503])('degrades upstream %s without sharing the partial response',async status=>{
 const fetcher=vi.fn(async()=>new Response('',{status,headers:{'Retry-After':'7200'}}));
 const {app}=server({tagRelations:{env:{TS_TAG_RELATIONS_ENABLED:'true'},fetcher,credentials:async()=>({serviceToken:'mock'})}});
 const result=await app.inject(path);expect(result.statusCode).toBe(200);expect(result.headers['cache-control']).toBe('private, no-store');
 expect(result.json().data).toMatchObject({status:'unavailable',tagId:null,relations:[]});
 if(status===429)expect(result.json().data.retryAfterSeconds).toBeGreaterThanOrEqual(7200);
});
it('fails closed on missing service configuration without fetching anonymously',async()=>{
 const fetcher=vi.fn(),{app}=server({tagRelations:{env:{TS_TAG_RELATIONS_ENABLED:'true'},fetcher,credentials:async()=>({})}});
 const result=await app.inject(path);expect(result.json().data).toMatchObject({status:'unavailable',reason:'configuration'});expect(fetcher).not.toHaveBeenCalled();expect(result.headers['cache-control']).toBe('private, no-store');
});
it('reads published F1 only in explicitly selected anonymous mode, without inbound credentials',async()=>{
 const credentials=vi.fn(),fetcher=vi.fn(async(_url:unknown,init?:RequestInit)=>{
  const headers=new Headers(init?.headers);
  expect(headers.get('DNT')).toBe('1');expect(headers.get('Sec-GPC')).toBe('1');
  for(const name of ['cookie','authorization','x-service-token','x-api-key'])expect(headers.has(name)).toBe(false);
  return Response.json(payload,{headers:{'Cache-Control':'public, max-age=60'}});
 });
 const {app}=server({tagRelations:{env:{TS_TAG_RELATIONS_ENABLED:'true',TS_TAG_RELATIONS_AUTH_MODE:'anonymous'},fetcher,credentials}});
 for(const headers of [{},{cookie:'private-inbound',authorization:'private-inbound','x-api-key':'private-inbound'}]){
  const response=await app.inject({url:path,headers});
  expect(response.json().data.status).toBe('available');expect(response.headers['cache-control']).toBe('private, no-store');
  expect(response.body).not.toContain('private-inbound');
 }
 expect(credentials).not.toHaveBeenCalled();expect(fetcher).toHaveBeenCalledTimes(1);
});
it('rejects an unknown authentication mode instead of silently fetching anonymously',async()=>{
 const fetcher=vi.fn(),{app}=server({tagRelations:{env:{TS_TAG_RELATIONS_ENABLED:'true',TS_TAG_RELATIONS_AUTH_MODE:'invalid'},fetcher}});
 expect((await app.inject(path)).json().data.reason).toBe('configuration');expect(fetcher).not.toHaveBeenCalled();
});
it('rejects invalid tags with documented errors and no shared cache',async()=>{
 const {app}=server({tagRelations:{env:{}}});
 for(const term of [' '+ '交通','a'.repeat(61),'交通\n']){
  const result=await app.inject('/api/v1/keywords/'+encodeURIComponent(term)+'/relations');
  expect(result.statusCode).toBe(400);expect(typeof result.json().error).toBe('string');expect(result.headers['cache-control']).toBe('no-store');
 }
});

it('accepts long decoded Unicode terms within the documented scalar limit',async()=>{
 const {app}=server({tagRelations:{env:{}}});
 for(const term of ['交通'.repeat(30),'😀'.repeat(60)]){
  const response=await app.inject('/api/v1/keywords/'+encodeURIComponent(term)+'/relations');
  expect(response.statusCode).toBe(200);expect(response.json().data.keyword).toBe(term);
 }
});
it('uses actual env credential validation without reading files or falling back to API-key quota',async()=>{
 const fetcher=vi.fn();
 const {app}=server({tagRelations:{env:{TS_TAG_RELATIONS_ENABLED:'true',TAG_SOURCE_API_KEY:'only-test-api-key'},fetcher}});
 const response=await app.inject(path);expect(response.json().data.reason).toBe('configuration');expect(fetcher).not.toHaveBeenCalled();
});
it('validates nonempty relation and unavailable envelopes against the documented schema',async()=>{
 const validate=responseValidator(PUBLIC_ENDPOINTS.find(e=>e.path==='/api/v1/keywords/:keyword/relations')!);
 const fetcher=vi.fn(async()=>Response.json({...payload,relations:[{id:'fixture-group',type:'is-a',target:{id:'group:3',label:'城市',href:'/group/3/'},source:'manual',sourceDetail:'fixture',createdAt:'2026-10-13T00:00:00Z',status:'approved',inherited:false,depth:1}]}));
 const {app}=server({tagRelations:{env:{TS_TAG_RELATIONS_ENABLED:'true'},fetcher,credentials:async()=>({serviceToken:'mock'})}});
 const response=await app.inject(path);expect(response.json().data.relations).toHaveLength(1);expect(validate(response.json()),JSON.stringify(validate.errors)).toBe(true);
 const bad=server({tagRelations:{env:{TS_TAG_RELATIONS_ENABLED:'true'},fetcher:async()=>new Response('',{status:429,headers:{'retry-after':'999999999999999999999999999999999999999'}}),credentials:async()=>({serviceToken:'mock'})}});
 const unavailable=await bad.app.inject(path);expect(validate(unavailable.json()),JSON.stringify(validate.errors)).toBe(true);expect(unavailable.headers['cache-control']).toBe('private, no-store');
});
