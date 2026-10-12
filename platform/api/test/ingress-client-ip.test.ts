import {it,expect} from 'vitest';
import Fastify from 'fastify';
import {ingressClientIp,CLOUDFLARE_RANGES} from '../src/ingress-client-ip.js';
import {trustedProxies} from '../src/trusted-proxy.js';
import {clientNetwork} from '../src/rate-limit.js';
import {registerAuth} from '../src/auth/index.js';
import {authEnv,memoryAuthStore} from './auth-fixture.js';
it('only an official Cloudflare nearest hop enables a single valid connecting IP',()=>{
 expect(CLOUDFLARE_RANGES.ipv4).toHaveLength(15);expect(CLOUDFLARE_RANGES.ipv6).toHaveLength(7);
 for(const ip of ['104.16.0.1','::ffff:104.16.0.1','2606:4700::1'])expect(ingressClientIp({ip,headers:{'cf-connecting-ip':'2001:db8:1:2::1'}})).toBe('2001:db8:1:2::1');
 for(const ip of ['198.51.100.8','104.15.255.255','104.28.0.1','127.0.0.1','10.0.1.17'])expect(ingressClientIp({ip,headers:{'cf-connecting-ip':'192.0.2.5','x-forwarded-for':'104.16.0.1'}})).toBe(ip);
 for(const value of [undefined,['192.0.2.1','192.0.2.2'],'192.0.2.1, 192.0.2.2','invalid','fe80::1%eth0',' 192.0.2.1','192.0.2.1 '])expect(ingressClientIp({ip:'104.16.0.1',headers:{'cf-connecting-ip':value}})).toBe('104.16.0.1');
});
it('trusted Traefik selects nearest untrusted hop before CF normalization and ignores spoofed XFF prefixes',async()=>{
 const app=Fastify({trustProxy:trustedProxies('10.0.1.17/32')});app.get('/ip',r=>({ip:r.ip,client:ingressClientIp(r),network:clientNetwork(ingressClientIp(r))}));
 try{
  const get=(remoteAddress:string,forwarded:string,cf:string)=>app.inject({url:'/ip',remoteAddress,headers:{'x-forwarded-for':forwarded,'cf-connecting-ip':cf}});
  expect((await get('10.0.1.17','192.0.2.100, 104.16.0.1','2001:db8:1:2:3:4:5:6')).json()).toEqual({ip:'104.16.0.1',client:'2001:db8:1:2:3:4:5:6',network:'2001:db8:1:2::/64'});
  expect((await get('10.0.1.17','104.16.0.1, 198.51.100.5','192.0.2.99')).json().client).toBe('198.51.100.5');
  expect((await get('198.51.100.5','104.16.0.1','192.0.2.99')).json().client).toBe('198.51.100.5');
  expect((await get('10.0.1.17','2001:db8::999, 2606:4700::1','2001:db8:7:8::1')).json().network).toBe('2001:db8:7:8::/64');
 }finally{await app.close();}
});
it('login limiter separates actual CF visitors and direct forged headers cannot reset the origin bucket',async()=>{
 const app=Fastify({trustProxy:trustedProxies('10.0.1.17/32')}),data=memoryAuthStore();await registerAuth(app,{env:authEnv,store:data.store,clock:()=>new Date('2026-10-12T00:00:00Z'),provider:{authenticate:async()=>{throw Error('no provider request');}}});
 const start=(remoteAddress:string,forwarded:string,client:string)=>app.inject({url:'/auth/google',remoteAddress,headers:{'x-forwarded-for':forwarded,'cf-connecting-ip':client}});
 try{
  for(let i=0;i<20;i++)expect((await start('10.0.1.17','104.16.0.1','2001:db8:1:2::'+(i+1).toString(16))).statusCode).toBe(302);
  expect((await start('10.0.1.17','104.16.0.1','2001:db8:1:2::ffff')).statusCode).toBe(429);
  expect((await start('10.0.1.17','104.16.0.1','2001:db8:1:3::1')).statusCode).toBe(302);
  for(let i=0;i<20;i++)expect((await start('198.51.100.5','104.16.0.1','192.0.2.'+(i+1))).statusCode).toBe(302);
  expect((await start('198.51.100.5','104.16.0.1','192.0.2.99')).statusCode).toBe(429);
 }finally{await app.close();}
});
