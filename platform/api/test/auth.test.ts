import {it,expect} from 'vitest';
import Fastify from 'fastify';
import {createHash} from 'node:crypto';
import {registerAuth,authStartLimiter} from '../src/auth/index.js';
import {AUTH_NETWORK_LIMITS} from '../src/auth/rate-limit.js';
import {authConfig,callbackUrl,cookieNames,equalToken,safeNext,tokenDigest,readCookie} from '../src/auth/config.js';
import {sessionView,type GoogleProvider} from '../src/auth/types.js';
import {authEnv,memoryAuthStore} from './auth-fixture.js';
const initial=new Date('2026-10-12T01:00:00Z'),identity={sub:'123456',email:'reader@example.test',name:'Fixture Reader',picture:null};
const cookie=(headers:Record<string,any>,name:string)=>{const values=headers['set-cookie'];return(Array.isArray(values)?values:[values]).find((v:string)=>v?.startsWith(name+'='))?.split(';')[0] as string;};
async function setup(options:{env?:NodeJS.ProcessEnv;provider?:GoogleProvider;ready?:boolean}={}){const data=memoryAuthStore(),app=Fastify({logger:false});let now=initial;data.store.ready=async()=>options.ready!==false;const runtime=await registerAuth(app,{env:options.env??authEnv,store:data.store,provider:options.provider??{authenticate:async()=>identity},clock:()=>now});return{...data,app,runtime,setTime:(time:Date)=>{now=time;}};}
async function start(s:Awaited<ReturnType<typeof setup>>,next='/my'){const r=await s.app.inject('/auth/google?next='+encodeURIComponent(next));expect(r.statusCode,r.body).toBe(302);return{response:r,url:new URL(r.headers.location!),flowCookie:cookie(r.headers,'yt_dev_oauth')};}
async function login(s:Awaited<ReturnType<typeof setup>>,extraCookie=''){const f=await start(s),r=await s.app.inject({url:'/auth/google/callback?state='+f.url.searchParams.get('state')+'&code=fixture-code',headers:{cookie:f.flowCookie+(extraCookie?'; '+extraCookie:'')}});expect(r.statusCode,r.body).toBe(303);return{response:r,sessionCookie:cookie(r.headers,'yt_dev_session')};}
const authHeaders=(sessionCookie:string,csrf:string)=>({cookie:sessionCookie,origin:authEnv.AUTH_PUBLIC_ORIGIN,'sec-fetch-site':'same-origin','x-csrf-token':csrf});
it('auth config fails closed without disclosing malformed or partial configuration',()=>{
 expect(authConfig({})).toMatchObject({config:null,reason:'unconfigured'});expect(authConfig({GOOGLE_CLIENT_ID:'hidden-client'})).toMatchObject({config:null,reason:'incomplete_config'});
 for(const origin of ['https://user:pass@example.test','https://example.test/path','https://example.test?x=1','https://example.test#hash','https://example.test/','http://example.test'])expect(authConfig({...authEnv,AUTH_PUBLIC_ORIGIN:origin}).config).toBeNull();
 expect(authConfig({...authEnv,NODE_ENV:'production'}).config).toBeNull();const prod=authConfig({...authEnv,NODE_ENV:'production',AUTH_PUBLIC_ORIGIN:'https://youtube.observe.tw'}).config!;expect(callbackUrl(prod)).toBe('https://youtube.observe.tw/auth/google/callback');expect(cookieNames(prod.origin).session).toBe('__Host-yt_session');
});
it('redirects are local, normalized and cannot loop through authentication',()=>{
 for(const path of ['//elsewhere','/\\evil','https://evil','/auth/google','/%61uth/google','/%2felsewhere','/a/../auth/google','/a\nb','/%5cevil'])expect(safeNext(path)).toBe('/my');expect(safeNext('/videos/AbC?tab=one#x')).toBe('/videos/AbC?tab=one#x');
});
it('digest purposes are independent and constant-time comparison tolerates invalid Unicode',()=>{
 const config=authConfig(authEnv).config!;expect(new Set(['session','flow','state','csrf'].map(p=>tokenDigest(config,p as any,'same-value'))).size).toBe(4);expect(equalToken('測'.repeat(64),'a'.repeat(64))).toBe(false);expect(readCookie('yt_dev_session='+'a'.repeat(43)+'; yt_dev_session='+'b'.repeat(43),'yt_dev_session')).toBeNull();
});
it('missing auth tables disable login while keeping the anonymous session endpoint cache-private',async()=>{const s=await setup({ready:false});try{const me=await s.app.inject('/auth/me');expect(me.json()).toEqual({enabled:false,user:null,csrfToken:null});expect(me.headers['cache-control']).toBe('private, no-store');expect(me.headers['set-cookie']).toBeUndefined();expect((await s.app.inject('/auth/google')).statusCode).toBe(503);}finally{await s.app.close();}});
it('local start uses server-side single-use PKCE with a bounded opaque HttpOnly cookie',async()=>{const s=await setup();try{const f=await start(s,'/videos/AbC'),stored=[...s.flows.values()][0]!;expect(f.url.origin).toBe('https://accounts.google.com');expect(f.url.searchParams.get('redirect_uri')).toBe('http://localhost:3100/auth/google/callback');expect(f.url.searchParams.get('code_challenge_method')).toBe('S256');expect(f.url.searchParams.get('code_challenge')).toBe(createHash('sha256').update(stored.verifier).digest('base64url'));expect(f.url.searchParams.get('nonce')).toBe(stored.nonce);expect(stored.next).toBe('/videos/AbC');const header=String(f.response.headers['set-cookie']);expect(header).toContain('HttpOnly; SameSite=Lax');expect(header).not.toContain('Secure');expect(header).not.toContain(stored.verifier);expect(header).not.toContain(stored.nonce);}finally{await s.app.close();}});
it('HTTPS session/flow cookies use host-only Secure prefixes',async()=>{const s=await setup({env:{...authEnv,APP_ENV:'preview',AUTH_PUBLIC_ORIGIN:'https://preview.example.test'}});try{const r=await s.app.inject('/auth/google');expect(r.headers['set-cookie']).toContain('__Host-yt_oauth=');expect(r.headers['set-cookie']).toContain('; Secure');expect(r.headers['set-cookie']).not.toContain('Domain=');}finally{await s.app.close();}});
it('production builds support explicit isolated preview/local modes and reject ambiguous origins',()=>{
 expect(authConfig({...authEnv,AUTH_PUBLIC_ORIGIN:undefined}).config).toBeNull();
 for(const [APP_ENV,AUTH_PUBLIC_ORIGIN]of [['production','https://preview.example.test'],['preview','https://youtube.observe.tw'],['preview','http://localhost:38000'],['local','https://youtube.observe.tw'],['preveiw','https://preview.example.test'],['test','http://localhost:38000']])expect(authConfig({...authEnv,NODE_ENV:'production',APP_ENV,AUTH_PUBLIC_ORIGIN}).config).toBeNull();
 for(const [APP_ENV,AUTH_PUBLIC_ORIGIN]of [['preview','https://preview.example.test'],['local','http://127.0.0.1:38000']])expect(authConfig({...authEnv,NODE_ENV:'production',APP_ENV,AUTH_PUBLIC_ORIGIN}).config?.origin).toBe(AUTH_PUBLIC_ORIGIN);
 expect(authConfig({...authEnv,NODE_ENV:'production',AUTH_PUBLIC_ORIGIN:undefined}).config?.origin).toBe('https://youtube.observe.tw');
});
it('callback exchanges once, records only session digests, rotates existing sessions and revokes on logout',async()=>{
 let exchanges=0;const s=await setup({provider:{authenticate:async()=>{exchanges++;return identity;}}});try{const first=await login(s),before=[...s.sessions.keys()][0]!;expect(before).toHaveLength(64);expect(first.sessionCookie).not.toContain(before);const second=await login(s,first.sessionCookie);expect(exchanges).toBe(2);expect(s.sessions.has(before)).toBe(false);expect(second.sessionCookie).not.toBe(first.sessionCookie);const me=await s.app.inject({url:'/auth/me',headers:{cookie:second.sessionCookie}});expect(me.json().user).toMatchObject({email:identity.email,role:'reader'});expect(me.json()).not.toHaveProperty('tokenHash');expect(me.json().csrfToken).toHaveLength(64);expect(me.headers['access-control-allow-origin']).toBeUndefined();const out=await s.app.inject({method:'POST',url:'/auth/logout',headers:authHeaders(second.sessionCookie,me.json().csrfToken)});expect(out.statusCode).toBe(204);expect(out.headers['set-cookie']).toContain('Max-Age=0');expect((await s.app.inject({url:'/auth/me',headers:{cookie:second.sessionCookie}})).json().user).toBeNull();}finally{await s.app.close();}
});
it('callback replay, cookie mismatch, expiry and malformed state never exchange',async()=>{
 let calls=0;const s=await setup({provider:{authenticate:async()=>{calls++;return identity;}}});try{
 for(const mode of ['mismatch','expired','badstate']){s.setTime(initial);const f=await start(s);if(mode==='expired')s.setTime(new Date(+initial+600001));const r=await s.app.inject({url:'/auth/google/callback?state='+(mode==='badstate'?'invalid':f.url.searchParams.get('state'))+'&code=x',headers:{cookie:mode==='mismatch'?'yt_dev_oauth='+'x'.repeat(43):f.flowCookie}});expect(r.headers.location).toBe('/login?error=state');expect(r.headers['set-cookie']).toContain('Max-Age=0');}
 s.setTime(initial);const f=await start(s);const req={url:'/auth/google/callback?state='+f.url.searchParams.get('state')+'&code=x',headers:{cookie:f.flowCookie}};const results=await Promise.all([s.app.inject(req),s.app.inject(req)]);expect(results.map(r=>r.headers.location).sort()).toEqual(['/login?error=state','/my']);expect(calls).toBe(1);
 }finally{await s.app.close();}
});
it('cancelled and missing-code callbacks consume valid flows and return generic outcomes',async()=>{const s=await setup();try{for(const query of ['error=access_denied','']){const f=await start(s);const r=await s.app.inject({url:'/auth/google/callback?state='+f.url.searchParams.get('state')+'&'+query,headers:{cookie:f.flowCookie}});expect(r.headers.location).toBe(query?'/login?error=cancelled':'/login?error=invalid');expect(s.flows.size).toBe(0);}}finally{await s.app.close();}});
it('all session writes require exact Origin, CSRF and same-origin fetch metadata',async()=>{const s=await setup();try{const{sessionCookie}=await login(s),me=await s.app.inject({url:'/auth/me',headers:{cookie:sessionCookie}}),headers=authHeaders(sessionCookie,me.json().csrfToken);for(const change of [{origin:undefined},{origin:'http://localhost:4100'},{'sec-fetch-site':'same-site'},{'x-csrf-token':'wrong'},{'x-csrf-token':undefined}])expect((await s.app.inject({method:'POST',url:'/auth/logout',headers:Object.fromEntries(Object.entries({...headers,...change}).filter(([,value])=>value!==undefined))})).statusCode).toBe(403);expect((await s.app.inject({method:'POST',url:'/auth/logout',headers:Object.fromEntries(Object.entries(headers).filter(([key])=>key!=='sec-fetch-site'))})).statusCode).toBe(204);}finally{await s.app.close();}});
it('any Authorization header blocks cookie fallback, including valid cookie plus wrong bearer',async()=>{const s=await setup();try{const{sessionCookie}=await login(s);const r=await s.app.inject({url:'/auth/me',headers:{cookie:sessionCookie,authorization:'Bearer wrong'}});expect(r.json().user).toBeNull();expect((await s.app.inject({url:'/auth/users',headers:{cookie:sessionCookie,authorization:'Bearer wrong'}})).statusCode).toBe(401);}finally{await s.app.close();}});
it('expired and disabled users never resolve a session',async()=>{const s=await setup();try{const{sessionCookie}=await login(s);s.users.get(1)!.disabledAt=initial.toISOString();expect((await s.app.inject({url:'/auth/me',headers:{cookie:sessionCookie}})).json().user).toBeNull();s.users.get(1)!.disabledAt=null;s.setTime(new Date(+initial+30*86400000));expect((await s.app.inject({url:'/auth/me',headers:{cookie:sessionCookie}})).json().user).toBeNull();}finally{await s.app.close();}});
it('sub remains the identity and recycled configured-admin emails cannot inherit roles',async()=>{let sub='first';const s=await setup({provider:{authenticate:async()=>({...identity,sub,email:'admin@example.test'})}});try{const first=await login(s);expect((await s.app.inject({url:'/auth/me',headers:{cookie:first.sessionCookie}})).json().user.role).toBe('admin');sub='second';const second=await login(s);expect(s.users.size).toBe(2);expect((await s.app.inject({url:'/auth/me',headers:{cookie:second.sessionCookie}})).json().user.role).toBe('reader');expect(sessionView(s.users.get(1)!,new Set())?.role).toBe('reader');}finally{await s.app.close();}});
it('audited grants are immediate per request; self and configured-admin edits are refused',async()=>{
 let person={...identity,sub:'admin',email:'admin@example.test'};const s=await setup({provider:{authenticate:async()=>person}});try{const admin=await login(s),me=await s.app.inject({url:'/auth/me',headers:{cookie:admin.sessionCookie}}),headers=authHeaders(admin.sessionCookie,me.json().csrfToken);person=identity;const reader=await login(s);expect((await s.app.inject({url:'/auth/users',headers:{cookie:reader.sessionCookie}})).statusCode).toBe(403);
 expect((await s.app.inject({method:'PUT',url:'/auth/users/1/role',headers,payload:{role:'reader'}})).statusCode).toBe(400);
 expect((await s.app.inject({method:'PUT',url:'/auth/users/2/role',headers,payload:{role:'admin'}})).statusCode).toBe(200);expect((await s.app.inject({url:'/auth/users',headers:{cookie:reader.sessionCookie}})).statusCode).toBe(200);
 const readerMe=await s.app.inject({url:'/auth/me',headers:{cookie:reader.sessionCookie}});expect((await s.app.inject({method:'PUT',url:'/auth/users/1/role',headers:authHeaders(reader.sessionCookie,readerMe.json().csrfToken),payload:{role:'reader'}})).statusCode).toBe(409);
 expect((await s.app.inject({method:'PUT',url:'/auth/users/2/role',headers,payload:{role:'reader'}})).statusCode).toBe(200);expect((await s.app.inject({url:'/auth/users',headers:{cookie:reader.sessionCookie}})).statusCode).toBe(403);expect(s.audit.at(-1)).toEqual({userId:2,actorId:1,action:'admin_revoke'});
 }finally{await s.app.close();}
});
it('start limiter bounds attempts, cardinality and expiration',()=>{const allow=authStartLimiter();for(let i=0;i<20;i++)expect(allow('ip',0)).toBe(true);expect(allow('ip',0)).toBe(false);for(let i=0;i<2047;i++)expect(allow('ip'+i,0)).toBe(true);expect(allow('new',0)).toBe(true);expect(allow('new',600000)).toBe(true);});

it('session wire errors and account IDs fail closed at the safe-integer boundary',async()=>{
 const s=await setup();try{expect((await s.app.inject('/auth/users')).json()).toEqual({error:{code:'SIGN_IN_REQUIRED'}});expect(s.runtime.actor({id:1})).toBe('user:1');for(const id of [0,-1,2**53,Number('9007199254740993')])expect(()=>s.runtime.actor({id})).toThrow('invalid_account_id');}finally{await s.app.close();}
});

it('flow-store outages clear callback credentials from the browser URL with a sanitized redirect',async()=>{
 let exchanges=0;const s=await setup({provider:{authenticate:async()=>{exchanges++;return identity;}}});try{const f=await start(s);s.store.consumeFlow=async()=>{throw new Error('fixture internal database diagnostic');};const r=await s.app.inject({url:'/auth/google/callback?state='+f.url.searchParams.get('state')+'&code=fixture-code',headers:{cookie:f.flowCookie}});expect(r.statusCode).toBe(303);expect(r.headers.location).toBe('/login?error=failed');expect(r.headers['set-cookie']).toContain('Max-Age=0');expect(r.body).not.toContain('diagnostic');expect(exchanges).toBe(0);}finally{await s.app.close();}
});
it('roll-forward secret rotation invalidates previous sessions and pending OAuth flows',async()=>{
 const s=await setup(),next=Fastify();try{
  const previous=await login(s),pending=await start(s);await registerAuth(next,{env:{...authEnv,AUTH_SESSION_SECRET:'new-fixture-roll-forward-secret-32-bytes'},store:s.store,clock:()=>initial,provider:{authenticate:async()=>{throw new Error('old flow must not exchange');}}});
  expect((await next.inject({url:'/auth/me',headers:{cookie:previous.sessionCookie}})).json().user).toBeNull();
  const r=await next.inject({url:'/auth/google/callback?state='+pending.url.searchParams.get('state')+'&code=fixture',headers:{cookie:pending.flowCookie}});expect(r.headers.location).toBe('/login?error=state');
 }finally{await next.close();await s.app.close();}
});

it('forged signed cookies never reach the session store and auth/me is rate limited',async()=>{const s=await setup();let calls=0;s.store.sessionUser=async()=>{calls++;return null;};try{for(let i=0;i<120;i++){const r=await s.app.inject({url:'/auth/me',headers:{cookie:'yt_dev_session='+('a'.repeat(43))+'.'+('b'.repeat(22))}});expect(r.statusCode).toBe(200);expect(r.json().user).toBeNull();}expect(calls).toBe(0);expect((await s.app.inject('/auth/me')).statusCode).toBe(429);}finally{await s.app.close();}});
it('anonymous address churn cannot consume signed-session budget',async()=>{const s=await setup();try{const signed=await login(s);for(let i=0;i<12000;i++)await s.app.inject({url:'/auth/me',remoteAddress:`198.51.${Math.floor(i/200)}.${i%200}`,headers:{cookie:'yt_dev_session='+'a'.repeat(43)}});expect((await s.app.inject({url:'/auth/me',headers:{cookie:signed.sessionCookie}})).json().user?.email).toBe(identity.email);}finally{await s.app.close();}},15000);

it.each([
 ['/auth/google',AUTH_NETWORK_LIMITS.start,302,'600'],
 ['/auth/google/callback',AUTH_NETWORK_LIMITS.callback,303,'60'],
 ['/auth/me',AUTH_NETWORK_LIMITS.anonymousSession,200,'60'],
] as const)('enforces the IPv6 aggregate on %s and preserves other prefixes and IPv4',async(url,limits,status,retry)=>{
 const s=await setup();try{
  for(let i=0;i<limits.aggregate;i++)expect((await s.app.inject({url,remoteAddress:`2001:db8:1:${i.toString(16)}::1`})).statusCode).toBe(status);
  const denied=await s.app.inject({url,remoteAddress:'2001:db8:1:ffff::1'});expect(denied.statusCode).toBe(429);expect(denied.headers['retry-after']).toBe(retry);expect(denied.headers['cache-control']).toBe('private, no-store');
  for(const remoteAddress of ['2001:db8:2:ffff::1','192.0.2.1','::ffff:192.0.2.2'])expect((await s.app.inject({url,remoteAddress})).statusCode).toBe(status);
  s.setTime(new Date(+initial+limits.windowMs));expect((await s.app.inject({url,remoteAddress:'2001:db8:1:ffff::1'})).statusCode).toBe(status);
 }finally{await s.app.close();}
});
it('signed sessions behind one IPv4 NAT retain independent session budgets',async()=>{
 const s=await setup();try{
  const first=await login(s),second=await login(s);
  for(let i=0;i<120;i++)for(const sessionCookie of [first.sessionCookie,second.sessionCookie]){
   const response=await s.app.inject({url:'/auth/me',remoteAddress:'192.0.2.1',headers:{cookie:sessionCookie}});expect(response.statusCode).toBe(200);expect(response.json().user?.email).toBe(identity.email);
  }
 }finally{await s.app.close();}
});
