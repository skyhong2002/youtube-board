import type {FastifyInstance} from 'fastify';
import {PUBLIC_ENDPOINTS} from './catalog.js';
export interface ApiAvailability {status:'ok'|'degraded';scope:'api_availability';checkedAt:string;services:Array<{id:'reports';status:'ok'|'unavailable'}>;endpoints:Array<{method:'GET';path:string}>}
export interface ApiStatusOptions {check:()=>Promise<void>;clock?:()=>Date;timeoutMs?:number}
/** One in-flight check per instance. The injected check must also bound its own DB work.
 * Timing out the HTTP response does not cancel an arbitrary injected promise.
 */
export function createApiStatus(options:ApiStatusOptions){
 const timeoutMs=options.timeoutMs??3000;
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>5000)throw new Error('Invalid API status timeout');
 let inFlight:Promise<boolean>|undefined;
 const endpoints=PUBLIC_ENDPOINTS.map(({method,path})=>({method,path}));
 return async():Promise<{statusCode:200|503;body:ApiAvailability}>=>{
  if(!inFlight){const check=Promise.resolve().then(options.check).then(()=>true,()=>false);inFlight=check;void check.finally(()=>{if(inFlight===check)inFlight=undefined;});}
  let timer:ReturnType<typeof setTimeout>|undefined;
  const ok=await Promise.race([inFlight,new Promise<false>(resolve=>{timer=setTimeout(()=>resolve(false),timeoutMs);})]).finally(()=>{if(timer)clearTimeout(timer);});
  return {statusCode:ok?200:503,body:{status:ok?'ok':'degraded',scope:'api_availability',checkedAt:(options.clock?.()??new Date()).toISOString(),services:[{id:'reports',status:ok?'ok':'unavailable'}],endpoints}};
 };
}
/** JSON-only registration; gateway HTML negotiation may call createApiStatus instead. */
export function registerApiStatus(app:FastifyInstance,options:ApiStatusOptions){
 const status=createApiStatus(options);
 app.get('/api/status',async(_request,reply)=>{const result=await status();return reply.code(result.statusCode).header('Cache-Control','no-store').send(result.body);});
}
