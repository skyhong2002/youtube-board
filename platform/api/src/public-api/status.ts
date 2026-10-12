import type {FastifyInstance} from 'fastify';
import {PUBLIC_ENDPOINTS} from './catalog.js';
/** Prefer the most specific media range before its quality; explicit q=0
 * cannot be overridden by a broader wildcard. JSON is the default/tie choice. */
export function statusRepresentation(accept:string|undefined):'json'|'html'|null{
 const ranges=(accept?.trim()||'*/*').split(',').map(value=>{
  const [media,...parameters]=value.trim().toLowerCase().split(';');
  const parameter=parameters.map(p=>p.trim()).find(p=>p.startsWith('q='));
  const valueQ=parameter?.slice(2)??'1';
  return {media:media?.trim(),q:/^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(valueQ)?Number(valueQ):0};
 });
 const quality=(mime:string)=>{
  let specificity=-1,q=0;
  for(const range of ranges){
   const score=range.media===mime?2:range.media===mime.split('/')[0]+'/*'?1:range.media==='*/*'?0:-1;
   if(score>specificity){specificity=score;q=range.q;}
  }
  return q;
 };
 const json=quality('application/json'),html=quality('text/html');
 return json<=0&&html<=0?null:json>=html?'json':'html';
}
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
