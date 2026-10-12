import {ingressClientIp} from '../ingress-client-ip.js';
import {boundedLimiter,clientNetwork,RateLimitError} from '../rate-limit.js';
import {AuthStoreFailure} from '../auth/store.js';
import {createHash,randomBytes} from 'node:crypto';
import type {FastifyInstance,FastifyReply,FastifyRequest} from 'fastify';
import type {AuthRuntime} from '../auth/index.js';
import {privateAuthReply} from '../auth/index.js';
import {createReader,DataSourceUnavailable,type Reader} from '../db/client.js';
import {AccountError,FOLLOWS_MAX,SAVES_MAX,fields,note,record,target,type FollowKind,type SaveKind} from './contracts.js';
import {accountTargets,accountFeed,privateRss} from './feed.js';
import {mysqlAccountStore,type AccountStore} from './store.js';
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const limiter=(limit:number)=>boundedLimiter(limit,60000,12000);
export async function registerReaderAccounts(app:FastifyInstance,auth:AuthRuntime,options:{databaseUrl?:string;store?:AccountStore|null;reader?:Reader;clock?:()=>Date}={}){
 const clock=options.clock??(()=>new Date()),store=options.store??(auth.enabled&&options.databaseUrl?mysqlAccountStore(options.databaseUrl):null),reader=options.reader??createReader(options.databaseUrl);
 const available=!!store&&await store.ready().catch(()=>false),writes=limiter(60),feeds=limiter(60);
 app.addHook('onClose',async()=>{if(store)await store.close();if(!options.reader)await reader.close();});
 await app.register(async routes=>{
  routes.setErrorHandler((error,_request,reply)=>{privateAuthReply(reply);if(error instanceof RateLimitError)return reply.header('Retry-After',String(error.retryAfter)).code(429).send({error:{code:'RATE_LIMITED'}});if(error instanceof AccountError)return reply.code(error.status).send({error:{code:error.code}});if(error&&typeof error==='object'&&'statusCode' in error&&typeof error.statusCode==='number'&&error.statusCode>=400&&error.statusCode<500)return reply.code(error.statusCode).send({error:{code:'INVALID_REQUEST'}});const code=error&&typeof error==='object'&&'code' in error?String(error.code):'';const unavailable=error instanceof AuthStoreFailure||error instanceof DataSourceUnavailable||['ECONNREFUSED','ECONNRESET','ETIMEDOUT','PROTOCOL_CONNECTION_LOST','ER_ACCESS_DENIED_ERROR','ER_DBACCESS_DENIED_ERROR','ER_TABLEACCESS_DENIED_ERROR','ER_STATEMENT_TIMEOUT','ER_LOCK_WAIT_TIMEOUT','ER_NO_SUCH_TABLE'].includes(code);return reply.code(unavailable?503:500).send({error:{code:unavailable?'ACCOUNT_UNAVAILABLE':'ACCOUNT_FAILED'}});});
  const user=async(req:FastifyRequest,reply:FastifyReply,write=false)=>{const u=await auth.requireReader(req,reply,write);if(!u)return null;if(!available){reply.code(503).send({error:{code:'ACCOUNT_UNAVAILABLE'}});return null;}if(write&&!writes(String(u.id),+clock())){reply.header('Retry-After','60').code(429).send({error:{code:'RATE_LIMITED'}});return null;}return u;};
  const follows=async(id:number)=>{const items=await store!.follows(id),labels=await accountTargets(reader,items);return {follows:items.map((i,n)=>({...i,...labels[n]})),max:FOLLOWS_MAX};};
  const saves=async(id:number)=>{const items=await store!.saves(id),labels=await accountTargets(reader,items);return {saves:items.map((i,n)=>({...i,...labels[n]})),max:SAVES_MAX};};
  routes.get('/auth/me/follows',async(req,reply)=>{const u=await user(req,reply);if(!u)return reply;return follows(u.id);});
  routes.put('/auth/me/follows',async(req,reply)=>{const u=await user(req,reply,true);if(!u)return reply;const body=record(req.body);fields(body,['kind','target','follow']);const t=target(body.kind,body.target);if(typeof body.follow!=='boolean')throw new AccountError('INVALID_REQUEST');if(body.follow&&!(await accountTargets(reader,[t as {kind:FollowKind;target:string}]))[0]?.available)throw new AccountError('TARGET_UNAVAILABLE',404);await store!.follow(u.id,t.kind as FollowKind,t.target,body.follow,clock());return follows(u.id);});
  routes.get('/auth/me/saves',async(req,reply)=>{const u=await user(req,reply);if(!u)return reply;return saves(u.id);});
  routes.put('/auth/me/saves',async(req,reply)=>{const u=await user(req,reply,true);if(!u)return reply;const body=record(req.body);fields(body,['kind','target','saved','note']);const t=target(body.kind,body.target,true);if(typeof body.saved!=='boolean')throw new AccountError('INVALID_REQUEST');const memo=note(body.note);if(body.saved&&!(await accountTargets(reader,[t as {kind:SaveKind;target:string}]))[0]?.available)throw new AccountError('TARGET_UNAVAILABLE',404);await store!.save(u.id,t.kind as SaveKind,t.target,body.saved,memo,clock());return saves(u.id);});
  routes.get('/auth/me/feed',async(req,reply)=>{const u=await user(req,reply);if(!u)return reply;return accountFeed(reader,u.id,clock);});
  routes.get('/auth/me/feed-token',async(req,reply)=>{const u=await user(req,reply);if(!u)return reply;const createdAt=await store!.feedStatus(u.id);return {active:createdAt!==null,createdAt};});
  routes.post('/auth/me/feed-token',async(req,reply)=>{const u=await user(req,reply,true);if(!u)return reply;if(req.body!==undefined)fields(record(req.body),[]);const token=randomBytes(32).toString('base64url'),at=clock();await store!.rotateFeed(u.id,digest(token),at);return {url:new URL('/feeds/u/'+token+'.xml',auth.origin).href,createdAt:at.toISOString()};});
  routes.delete('/auth/me/feed-token',async(req,reply)=>{const u=await user(req,reply,true);if(!u)return reply;await store!.revokeFeed(u.id);return {active:false};});
  routes.get<{Params:{token:string}}>('/feeds/u/:token.xml',async(req,reply)=>{
   privateAuthReply(reply);if(!available||!auth.enabled||!/^[A-Za-z0-9_-]{43}$/.test(req.params.token))return reply.code(404).send({error:{code:'NOT_FOUND'}});
   if(!feeds(clientNetwork(ingressClientIp(req)),+clock()))return reply.header('Retry-After','60').code(429).send({error:{code:'RATE_LIMITED'}});
   const id=await store!.feedUser(digest(req.params.token));if(id===null)return reply.code(404).send({error:{code:'NOT_FOUND'}});
   const data=await accountFeed(reader,id,clock);if(data.coverage.status==='changed')return reply.header('Retry-After','30').code(503).send({error:{code:'ACCOUNT_UNAVAILABLE'}});
   // Rotation/disable during a slow source read also invalidates this response.
   if(await store!.feedUser(digest(req.params.token))!==id)return reply.code(404).send({error:{code:'NOT_FOUND'}});
   return reply.type('application/rss+xml; charset=utf-8').send(privateRss(data,auth.origin));
  });
 });
 return {available};
}
