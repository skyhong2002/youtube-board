import {ingressClientIp} from '../ingress-client-ip.js';
/** Same-family Google login, hardened from tag.analysis.tw afe0a653. */
import type {AccountSession,AccountUsers} from '../../../shared/account-contracts.js';
import {createHash} from 'node:crypto';
import {boundedLimiter,clientNetwork,RateLimitError} from '../rate-limit.js';
import type {FastifyInstance,FastifyReply,FastifyRequest} from 'fastify';
import {authConfig,authCookie,callbackUrl,cookieNames,equalToken,opaqueToken,readCookie,signedCookieToken,readSignedCookie,safeNext,tokenDigest,validToken,PRODUCTION_ORIGIN} from './config.js';
import {googleProvider} from './provider.js';
import {createAuthStore} from './store.js';
import {sessionView,type AuthRuntime,type AuthStore,type GoogleProvider,type SessionUser} from './types.js';
export type {AuthRuntime,AuthStore,GoogleProvider,SessionUser} from './types.js';
const wireDate=(value:string)=>new Date(value.includes('T')?value:value.replace(' ','T')+'Z').toISOString();
export interface AuthOptions{env?:NodeJS.ProcessEnv;databaseUrl?:string;store?:AuthStore|null;provider?:GoogleProvider;clock?:()=>Date}
export function privateAuthReply(reply:FastifyReply){return reply.header('Cache-Control','private, no-store').header('Vary','Cookie').header('X-Robots-Tag','noindex').header('Referrer-Policy','no-referrer');}
export function authStartLimiter(){const allow=boundedLimiter(20,600000,4000);return(ip:string,now:number)=>allow(clientNetwork(ip),now);}
export async function registerAuth(app:FastifyInstance,options:AuthOptions={}):Promise<AuthRuntime>{
 const env=options.env??process.env,parsed=authConfig(env),config=parsed.config,clock=options.clock??(()=>new Date());
 let store=options.store??null,reason=parsed.reason;
 if(config&&!store){const url=options.databaseUrl??env.DATABASE_URL;if(url)try{store=createAuthStore(url);}catch{reason='store_unavailable';}else reason='database_unconfigured';}
 if(config&&store){if(!await store.ready().catch(()=>false))reason='schema_missing';else reason=undefined;}
 const enabled=Boolean(config&&store&&!reason),origin=config?.origin??PRODUCTION_ORIGIN,names=cookieNames(origin),allowStart=authStartLimiter(),allowSession=boundedLimiter(120,60000,12000),allowCallback=boundedLimiter(30,60000,3000);
 if(reason&&reason!=='unconfigured')app.log.warn({code:reason},'authentication disabled');
 if(store)app.addHook('onClose',async()=>{await store!.close();});
 const sessionToken=(request:FastifyRequest)=>request.headers.authorization!==undefined?null:(config?readSignedCookie(config,request.headers.cookie,names.session):null);
 const csrfToken=(request:FastifyRequest)=>{const raw=sessionToken(request);return config&&raw?tokenDigest(config,'csrf',raw):null;};
 async function currentUser(request:FastifyRequest):Promise<SessionUser|null>{if(!enabled||!config||!store)return null;const raw=sessionToken(request);if(!raw)return null;if(!allowSession(tokenDigest(config,'session',raw),+clock()))throw new RateLimitError();const stored=await store.sessionUser(tokenDigest(config,'session',raw),clock());return stored?sessionView(stored,config.admins):null;}
 async function requireReader(request:FastifyRequest,reply:FastifyReply,write=false){privateAuthReply(reply);if(request.headers.authorization!==undefined){reply.code(401).send({error:{code:'SESSION_AUTH_REQUIRED'}});return null;}if(!enabled){reply.code(503).send({error:{code:'AUTH_DISABLED'}});return null;}
  const user=await currentUser(request);if(!user){reply.code(401).send({error:{code:'SIGN_IN_REQUIRED'}});return null;}
  if(write&&(request.headers.origin!==origin||(request.headers['sec-fetch-site']!==undefined&&request.headers['sec-fetch-site']!=='same-origin')||!equalToken(request.headers['x-csrf-token'],csrfToken(request)??''))){reply.code(403).send({error:{code:'CSRF_REJECTED'}});return null;}return user;
 }
 async function requireAdmin(request:FastifyRequest,reply:FastifyReply,write=false){const user=await requireReader(request,reply,write);if(user&&user.role!=='admin'){reply.code(403).send({error:{code:'ADMIN_REQUIRED'}});return null;}return user;}
 const runtime:AuthRuntime={enabled,origin,currentUser,requireReader,requireAdmin,actor:user=>{if(!Number.isSafeInteger(user.id)||user.id<1)throw new Error('invalid_account_id');return'user:'+user.id;}};
 const inactive=(reply:FastifyReply)=>privateAuthReply(reply).code(503).send({error:{code:'AUTH_DISABLED'}});
 const fail=(reply:FastifyReply,code:string)=>privateAuthReply(reply).redirect('/login?error='+code,303);
 const provider=config?(options.provider??googleProvider(config)):null;
 const allowMe=boundedLimiter(120,60000,12000),allowAnonymousMe=boundedLimiter(120,60000,12000);
 app.get('/auth/me',async(request,reply)=>{privateAuthReply(reply);const raw=sessionToken(request);if(!(raw&&config?allowMe(tokenDigest(config,'session',raw),+clock()):allowAnonymousMe(clientNetwork(ingressClientIp(request)),+clock())))return reply.header('Retry-After','60').code(429).send({error:{code:'RATE_LIMITED'}});const user=await currentUser(request);return{enabled,user,csrfToken:user?csrfToken(request):null} satisfies AccountSession;});
 app.get<{Querystring:{next?:unknown}}>('/auth/google',async(request,reply)=>{privateAuthReply(reply);if(!enabled||!store||!config)return inactive(reply);if(request.headers.authorization!==undefined)return reply.code(401).send({error:{code:'SESSION_AUTH_REQUIRED'}});
  if(!allowStart(ingressClientIp(request),+clock()))return reply.header('Retry-After','600').code(429).send({error:{code:'LOGIN_RATE_LIMITED'}});
  const binding=readSignedCookie(config,request.headers.cookie,names.flow)??opaqueToken(),state=opaqueToken(),nonce=opaqueToken(),verifier=opaqueToken(),createdAt=clock();
  if(!await store.putFlow({bindingHash:tokenDigest(config,'flow',binding),stateHash:tokenDigest(config,'state',state),nonce,verifier,next:safeNext(request.query.next,origin),createdAt,expiresAt:new Date(+createdAt+600000)}))return reply.header('Retry-After','60').code(429).send({error:{code:'LOGIN_RATE_LIMITED'}});
  const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');url.search=new URLSearchParams({client_id:config.clientId,redirect_uri:callbackUrl(config),response_type:'code',scope:'openid email profile',state,nonce,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',prompt:'select_account'}).toString();
  return reply.header('Set-Cookie',authCookie(origin,names.flow,signedCookieToken(config,names.flow,binding),600)).redirect(url.href,302);
 });
 app.get<{Querystring:{state?:unknown;code?:unknown;error?:unknown}}>('/auth/google/callback',async(request,reply)=>{
  privateAuthReply(reply);if(!enabled||!store||!config||!provider)return inactive(reply);if(!allowCallback(clientNetwork(ingressClientIp(request)),+clock()))return reply.header('Retry-After','60').code(429).send({error:{code:'RATE_LIMITED'}});reply.header('Set-Cookie',authCookie(origin,names.flow,'',0));
  const binding=readSignedCookie(config,request.headers.cookie,names.flow),state=request.query.state;if(!binding)return fail(reply,'state');
  let flow:Awaited<ReturnType<AuthStore['consumeFlow']>>;try{flow=await store.consumeFlow(tokenDigest(config,'flow',binding),tokenDigest(config,'state',validToken(state)?state:''),clock());}catch{return fail(reply,'failed');}if(!flow||!validToken(state)||request.headers.authorization!==undefined)return fail(reply,'state');
  if(request.query.error!==undefined)return fail(reply,'cancelled');const code=request.query.code;if(typeof code!=='string'||!code||code.length>2048)return fail(reply,'invalid');
  try{const at=clock(),identity=await provider.authenticate({code,verifier:flow.verifier,nonce:flow.nonce,now:at}),user=await store.upsertUser(identity,config.admins,at);if(user.disabledAt)return fail(reply,'invalid');
   const raw=opaqueToken(),old=sessionToken(request);if(!await store.rotateSession(tokenDigest(config,'session',raw),user.id,new Date(+at+30*86400000),old?tokenDigest(config,'session',old):null,at))return fail(reply,'failed');
   return reply.header('Set-Cookie',[authCookie(origin,names.flow,'',0),authCookie(origin,names.session,signedCookieToken(config,names.session,raw),30*86400)]).redirect(safeNext(flow.next,origin),303);
  }catch{request.log.warn({code:'google_login_failed'},'authentication failed');return fail(reply,'failed');}
 });
 app.post('/auth/logout',async(request,reply)=>{if(!await requireReader(request,reply,true))return reply;const raw=sessionToken(request);if(raw&&config&&store)await store.deleteSession(tokenDigest(config,'session',raw));return reply.header('Set-Cookie',authCookie(origin,names.session,'',0)).code(204).send();});
 app.get('/auth/users',async(request,reply)=>{if(!await requireAdmin(request,reply))return reply;const users=await store!.listUsers();return{users:users.map(u=>({...(sessionView(u,config!.admins)??{role:'reader' as const,adminSource:null}),id:u.id,email:u.email,name:u.name,picture:u.picture,disabled:Boolean(u.disabledAt),createdAt:wireDate(u.createdAt),lastLoginAt:wireDate(u.lastLoginAt),grantedBy:u.adminGrantedBy}))} satisfies AccountUsers;});
 app.put<{Params:{id:string};Body:{role?:unknown}}>('/auth/users/:id/role',async(request,reply)=>{const actor=await requireAdmin(request,reply,true);if(!actor)return reply;const id=Number(request.params.id),role=request.body?.role;
  if(!/^[1-9]\d*$/.test(request.params.id)||!Number.isSafeInteger(id)||(role!=='admin'&&role!=='reader'))return reply.code(400).send({error:{code:'INVALID_ROLE_REQUEST'}});
  const result=await store!.setAdmin(id,role==='admin',actor.id,config!.admins,clock());if(result!=='ok')return reply.code(result==='not_found'?404:result==='self'?400:result==='config'?409:403).send({error:{code:'ROLE_'+result.toUpperCase()}});return{ok:true,role};
 });
 return runtime;
}
