import Fastify from 'fastify';
import {it,expect,vi,afterEach} from 'vitest';
import {createApiStatus,registerApiStatus} from '../src/public-api/status.js';
import {PUBLIC_ENDPOINTS} from '../src/public-api/catalog.js';
import {responseValidator} from '../../tools/check-openapi.js';
afterEach(()=>vi.useRealTimers());
it('availability has abstract public-only services and its own no-store 200/503 contract',async()=>{
 for(const succeeds of [true,false]){const check=vi.fn(async()=>{if(!succeeds)throw new Error('private internal hostname and credentials');}),app=Fastify();registerApiStatus(app,{check,clock:()=>new Date('2026-10-11T10:00:00Z')});try{const response=await app.inject('/api/status');expect(response.statusCode).toBe(succeeds?200:503);expect(response.headers['cache-control']).toBe('no-store');expect(response.json()).toMatchObject({status:succeeds?'ok':'degraded',scope:'api_availability',services:[{id:'reports',status:succeeds?'ok':'unavailable'}]});expect(responseValidator(PUBLIC_ENDPOINTS.find(e=>e.path==='/api/status')!)(response.json())).toBe(true);expect(response.body).not.toMatch(/credentials|hostname|\/ops\/|\/auth\/|urt_video|grant/i);expect(check).toHaveBeenCalledTimes(1);}finally{await app.close();}}
});
it('bounds response time and shares a hanging check across concurrent requests',async()=>{
 vi.useFakeTimers();let resolve!:()=>void;const check=vi.fn(()=>new Promise<void>(done=>{resolve=done;})),status=createApiStatus({check,timeoutMs:20});const first=status(),second=status();await vi.advanceTimersByTimeAsync(20);expect((await first).statusCode).toBe(503);expect((await second).statusCode).toBe(503);expect(check).toHaveBeenCalledTimes(1);const third=status();await vi.advanceTimersByTimeAsync(20);expect((await third).statusCode).toBe(503);expect(check).toHaveBeenCalledTimes(1);resolve();await Promise.resolve();await Promise.resolve();
});
it('recovers after a failed check and rejects unsafe timeout settings',async()=>{
 let fail=true;const status=createApiStatus({check:async()=>{if(fail)throw Error('offline');}});expect((await status()).statusCode).toBe(503);fail=false;expect((await status()).statusCode).toBe(200);for(const timeoutMs of [0,5001,Infinity,1.5])expect(()=>createApiStatus({check:async()=>{},timeoutMs})).toThrow('Invalid API status timeout');
});
