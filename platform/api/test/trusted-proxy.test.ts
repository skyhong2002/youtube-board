import {it,expect} from 'vitest';import Fastify from 'fastify';import {trustedProxies} from '../src/trusted-proxy.js';
import {registerAuth} from '../src/auth/index.js';
import {authEnv,memoryAuthStore} from './auth-fixture.js';
it('only explicit ingress networks determine client identity',async()=>{
 expect(trustedProxies(undefined)).toBe(false);for(const value of ['true','0.0.0.0/0','::/0','example.test','10.1.1.1/nope'])expect(()=>trustedProxies(value)).toThrow();
 for(const [allow,expected]of [[undefined,'127.0.0.1'],['127.0.0.1/32','198.51.100.7']]as const){const app=Fastify({trustProxy:trustedProxies(allow)});app.get('/ip',async r=>({ip:r.ip}));try{const r=await app.inject({url:'/ip',remoteAddress:'127.0.0.1',headers:{'x-forwarded-for':'198.51.100.7'}});expect(r.json().ip).toBe(expected);}finally{await app.close();}}
 const app=Fastify({trustProxy:trustedProxies('10.42.0.0/16')});app.get('/ip',async r=>({ip:r.ip}));try{expect((await app.inject({url:'/ip',remoteAddress:'198.51.100.9',headers:{'x-forwarded-for':'192.0.2.3'}})).json().ip).toBe('198.51.100.9');}finally{await app.close();}
});
it('direct Fastify auth ingress keeps distinct trusted clients in separate login buckets',async()=>{
 const app=Fastify({trustProxy:trustedProxies('10.42.0.1/32')}),data=memoryAuthStore();
 await registerAuth(app,{env:authEnv,store:data.store,clock:()=>new Date('2026-10-12T00:00:00Z'),provider:{authenticate:async()=>{throw new Error('must not call Google');}}});
 const start=(ip:string)=>app.inject({url:'/auth/google',remoteAddress:'10.42.0.1',headers:{'x-forwarded-for':ip}});
 try{for(let i=0;i<20;i++)expect((await start('198.51.100.1')).statusCode).toBe(302);expect((await start('198.51.100.1')).statusCode).toBe(429);expect((await start('198.51.100.2')).statusCode).toBe(302);}finally{await app.close();}
});
