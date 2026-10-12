import {it,expect} from 'vitest';
import {buildApp} from '../src/app.js';
import {registerAuth} from '../src/auth/index.js';
import {authConfig,signedCookieToken} from '../src/auth/config.js';
import {registerReaderAccounts} from '../src/reader/routes.js';
import type {AccountStore} from '../src/reader/store.js';
import {authEnv,memoryAuthStore} from './auth-fixture.js';
it.each(['/auth/users','/auth/me/follows'])('session limits keep429 and Retry-After through real handler at %s',async url=>{
 const reader={rows:async()=>[],close:async()=>{}},app=buildApp({reader}),data=memoryAuthStore();let reads=0;data.store.sessionUser=async()=>{reads++;return null;};
 const auth=await registerAuth(app,{env:authEnv,store:data.store,clock:()=>new Date('2026-10-12T00:00:00Z')});
 if(url.includes('follows'))await registerReaderAccounts(app,auth,{reader,store:{ready:async()=>true,close:async()=>{}} as AccountStore});
 const cookie='yt_dev_session='+signedCookieToken(authConfig(authEnv).config!,'yt_dev_session','a'.repeat(43));
 try{for(let i=0;i<120;i++)expect((await app.inject({url,headers:{cookie}})).statusCode).toBe(401);const limited=await app.inject({url,headers:{cookie}});expect(limited.statusCode).toBe(429);expect(limited.json()).toEqual({error:{code:'RATE_LIMITED'}});expect(limited.headers['retry-after']).toBe('60');expect(limited.headers['cache-control']).toBe('private, no-store');expect(reads).toBe(120);}finally{await app.close();}
});
it('forged flow signature is rejected before any flow DB lookup or provider exchange',async()=>{
 const reader={rows:async()=>[],close:async()=>{}},app=buildApp({reader}),data=memoryAuthStore();let lookups=0,exchanges=0;data.store.consumeFlow=async()=>{lookups++;return null;};
 await registerAuth(app,{env:authEnv,store:data.store,provider:{authenticate:async()=>{exchanges++;throw Error('must not exchange');}}});
 try{const result=await app.inject({url:'/auth/google/callback?state='+'s'.repeat(43)+'&code=fixture',headers:{cookie:'yt_dev_oauth='+'a'.repeat(43)+'.'+'b'.repeat(22)}});expect(result.statusCode).toBe(303);expect(result.headers.location).toBe('/login?error=state');expect(lookups).toBe(0);expect(exchanges).toBe(0);}finally{await app.close();}
});
