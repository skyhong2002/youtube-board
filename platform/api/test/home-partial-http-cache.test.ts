import {afterEach, expect, it, vi} from 'vitest';
import type {FastifyInstance} from 'fastify';
import {buildApp} from '../src/app.js';

// Exercise the actual route and onSend policy without a database or source writes.
const state=vi.hoisted(()=>({home:{} as Record<string,unknown>}));
vi.mock('../src/reports/service.js',()=>({reports:()=>({home:async()=>state.home})}));
let app:FastifyInstance|undefined;
afterEach(async()=>{await app?.close();app=undefined;});
const snapshot=()=>({channels:[],tags:[],live:[],events:[],tagsStatus:'available',
 exploration:{categories:{status:'available'},keywords:{status:'synchronized',rows:[]},keywordToday:{status:'synchronized',rows:[]}}});
function setup(){
 app=buildApp({publicApi:false,dataset:'fixture',reader:{rows:async()=>[],close:async()=>{}}});
 return app;
}

it.each(['categories','keywords','keywordToday'] as const)('retains a partial %s envelope but forbids shared caching for GET and HEAD',async section=>{
 const data=snapshot();data.exploration[section].status='unavailable';state.home=data;
 const server=setup();
 for(const method of ['GET','HEAD'] as const){
  const response=await server.inject({method,url:'/api/v1/home'});
  expect(response.statusCode).toBe(200);
  expect(response.headers['cache-control']).toBe('private, no-store');
  if(method==='GET')expect(response.json().data.exploration[section].status).toBe('unavailable');
 }
});

it.each(['synchronized','not-synchronized'])('keeps legitimate empty %s results cacheable and credential boundaries intact',async status=>{
 const data=snapshot();data.exploration.keywords.status=status;data.exploration.keywordToday.status=status;state.home=data;
 const server=setup();
 expect((await server.inject('/api/v1/home')).headers['cache-control']).toBe('public, max-age=0, s-maxage=60, stale-while-revalidate=120');
 for(const name of ['cookie','authorization','x-api-key','x-service-token','rsc']){
  const response=await server.inject({url:'/api/v1/home',headers:{[name]:'test-only'}});
  expect(response.headers['cache-control']).toBe('private, no-store');
 }
});
