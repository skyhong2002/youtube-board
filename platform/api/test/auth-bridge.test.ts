import {it,expect} from 'vitest';
import Fastify from 'fastify';
import {createHash} from 'node:crypto';
import {privateProxy} from '../../web/src/lib/private-proxy.js';
import {registerAuth} from '../src/auth/index.js';
import {authEnv,memoryAuthStore} from './auth-fixture.js';

it('fixed Next bridge completes mock OAuth, cancellation, logout and expiry through real auth routes',async()=>{
 const app=Fastify(),data=memoryAuthStore();let now=new Date('2026-10-12T01:00:00Z'),exchanges=0,failProvider=false;
 await registerAuth(app,{env:authEnv,store:data.store,clock:()=>now,provider:{authenticate:async({verifier,nonce})=>{exchanges++;expect(verifier.length).toBeGreaterThan(40);expect(nonce.length).toBeGreaterThan(40);if(failProvider)throw new Error('provider diagnostic');return{sub:'bridge-reader',email:'bridge@example.test',name:'Bridge Reader',picture:null};}}});
 const jar=new Map<string,string>();
 const fetcher:typeof fetch=async(input,init)=>{const url=new URL(String(input));expect(url.origin).toBe('http://127.0.0.1:4100');expect(init?.redirect).toBe('manual');const inbound:Record<string,string>={};new Headers(init?.headers).forEach((v,k)=>{inbound[k]=v;});const res=await app.inject({method:init!.method as 'GET'|'POST',url:url.pathname+url.search,headers:inbound,...(init?.body?{payload:Buffer.from(init.body as Uint8Array)}:{})});const headers=new Headers();for(const [k,v]of Object.entries(res.headers))if(v!==undefined)for(const item of Array.isArray(v)?v:[v])headers.append(k,String(item));return new Response(res.statusCode===204?null:res.body,{status:res.statusCode,headers});};
 async function visit(path:string,init:RequestInit={}){const headers=new Headers(init.headers);headers.set('cookie',[...jar].map(([k,v])=>k+'='+v).join('; '));const r=await privateProxy(new Request(authEnv.AUTH_PUBLIC_ORIGIN+path,{...init,headers}),{fetcher});expect(r.headers.get('cache-control')).toBe('private, no-store');for(const c of r.headers.getSetCookie()){const [k,v]=c.split(';')[0]!.split('=');if(v)jar.set(k!,v);else jar.delete(k!);}return r;}
 async function start(){const r=await visit('/auth/google?next=%2Fmy%2Fsaved');expect(r.status).toBe(302);const target=new URL(r.headers.get('location')!);const flow=[...data.flows.values()][0]!;expect(target.searchParams.get('redirect_uri')).toBe(authEnv.AUTH_PUBLIC_ORIGIN+'/auth/google/callback');expect(target.searchParams.get('code_challenge')).toBe(createHash('sha256').update(flow.verifier).digest('base64url'));return '/auth/google/callback?state='+target.searchParams.get('state');}
 try{
  const cancelled=await visit(await start()+'&error=access_denied');expect(cancelled.headers.get('location')).toBe('/login?error=cancelled');expect(exchanges).toBe(0);
  failProvider=true;expect((await visit(await start()+'&code=fixture')).headers.get('location')).toBe('/login?error=failed');failProvider=false;
  const callback=await start(),success=await visit(callback+'&code=fixture');expect(success.status).toBe(303);expect(success.headers.get('location')).toBe('/my/saved');expect(success.headers.getSetCookie().some(c=>c.includes('HttpOnly; SameSite=Lax'))).toBe(true);
  const me=await(await visit('/auth/me')).json();expect(me.user.email).toBe('bridge@example.test');
  expect((await visit('/auth/logout',{method:'POST'})).status).toBe(403);
  const logout=await visit('/auth/logout',{method:'POST',headers:{origin:authEnv.AUTH_PUBLIC_ORIGIN,'x-csrf-token':me.csrfToken,'sec-fetch-site':'same-origin'}});expect(logout.status).toBe(204);expect((await(await visit('/auth/me')).json()).user).toBeNull();
  await visit(await start()+'&code=fixture');now=new Date(+now+30*86400000);expect((await(await visit('/auth/me')).json()).user).toBeNull();
 }finally{await app.close();}
});
