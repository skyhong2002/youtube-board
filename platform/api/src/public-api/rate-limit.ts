import type {FastifyInstance,FastifyRequest} from 'fastify';
import {ingressClientIp} from '../ingress-client-ip.js';
import {clientNetwork} from '../rate-limit.js';
import {applyPublicV1Cache} from '../public-v1-cache.js';

interface BudgetOptions {internalLimit?:number;globalLimit?:number}
export interface PublicApiPolicyOptions extends BudgetOptions {clock?:()=>Date}
export interface RateDecision {allowed:boolean;limit:number;remaining:number;reset:number;scope:'ip'|'internal'|'global'}
/** Single-process fixed-minute quotas. No network entry is evicted mid-window;
 * the global budget bounds map size. CDN hits do not charge these counters. */
export function publicApiBudgets(options:BudgetOptions={}){
 const globalLimit=options.globalLimit??4000,internalLimit=options.internalLimit??3000;
 for(const n of [globalLimit,internalLimit])if(!Number.isSafeInteger(n)||n<1||n>12000)throw new Error('Invalid public API quota');
 const networks=new Map<string,number>();let reset=0,globalUsed=0,internalUsed=0;
 return (ip:string,internal:boolean,now:number):RateDecision=>{
  if(!Number.isFinite(now)||now<0)throw new Error('Invalid public API clock');
  if(now>=reset){reset=(Math.floor(now/60000)+1)*60000;globalUsed=0;internalUsed=0;networks.clear();}
  const decision=(allowed:boolean,scope:RateDecision['scope'],limit:number,used:number):RateDecision=>({allowed,scope,limit,remaining:Math.max(0,limit-used),reset:Math.ceil(reset/1000)});
  if(internal){if(internalUsed>=internalLimit)return decision(false,'internal',internalLimit,internalUsed);return decision(true,'internal',internalLimit,++internalUsed);}
  if(globalUsed>=globalLimit)return decision(false,'global',globalLimit,globalUsed);
  const network=clientNetwork(ip),used=networks.get(network)??0;
  if(used>=60)return decision(false,'ip',60,used);
  networks.set(network,used+1);globalUsed++;return decision(true,'ip',60,used+1);
 };
}
export function isPublicApiPath(path:string){return /^\/api\/v1(?:\/|$)/.test(path)||/^\/api\/[^/]+\.php$/.test(path)||path==='/api/status';}
function publicPath(request:FastifyRequest){const route=request.routeOptions.url;return route&&isPublicApiPath(route)?route:request.url.split('?')[0]!;}
function loopback(request:FastifyRequest){const ip=request.socket.remoteAddress;return ip==='127.0.0.1'||ip==='::1'||ip==='::ffff:127.0.0.1';}
/** Register before all public GET routes. Auth/ops/private RSS are outside scope. */
export function registerPublicApiPolicy(app:FastifyInstance,options:PublicApiPolicyOptions={}){
 // Anonymous-only release. No key store, SQL lookup or own-state pool.
 const clock=options.clock??(()=>new Date()),take=publicApiBudgets(options);
 const state=new WeakMap<FastifyRequest,{decision:RateDecision;private:boolean}>();
 app.addHook('onRequest',async(request,reply)=>{
  const path=publicPath(request);if(!isPublicApiPath(path))return;
  reply.header('Access-Control-Allow-Origin','*').header('Access-Control-Expose-Headers','x-ratelimit-limit, x-ratelimit-remaining, x-ratelimit-reset, Retry-After');
  if(request.method==='OPTIONS')return reply.header('Access-Control-Allow-Methods','GET, HEAD, OPTIONS').header('Access-Control-Allow-Headers','x-api-key, Accept').header('Access-Control-Max-Age','600').header('Cache-Control','public, max-age=600').code(204).send();
  const at=clock(),ip=ingressClientIp(request),internal=loopback(request),raw=request.headers['x-api-key'];
  const privateResponse=raw!==undefined||request.headers['x-service-token']!==undefined||request.headers.authorization!==undefined||request.headers.cookie!==undefined;
  const decision=take(ip,internal,+at);state.set(request,{decision,private:privateResponse});
  if(!decision.allowed)return reply.header('Retry-After',String(Math.max(1,decision.reset-Math.floor(+at/1000)))).code(429).send({error:'API rate limit exceeded',code:'RATE_LIMITED'});
 });
 app.addHook('onSend',async(request,reply,payload)=>{
  const path=publicPath(request);if(!isPublicApiPath(path))return payload;
  const vary=new Set(String(reply.getHeader('Vary')??'').split(',').map(v=>v.trim()).filter(Boolean));
  for(const name of ['X-Api-Key','X-Service-Token','Authorization','Cookie'])vary.add(name);
  reply.header('Vary',[...vary].join(', '));
  const current=state.get(request);
  if(current){const d=current.decision;reply.header('x-ratelimit-limit',String(d.limit)).header('x-ratelimit-remaining',String(d.remaining)).header('x-ratelimit-reset',String(d.reset));}
  const privateResponse=current?.private||request.headers['x-api-key']!==undefined||request.headers.authorization!==undefined||request.headers.cookie!==undefined||reply.hasHeader('set-cookie');
  const legacy=/^\/api\/[^/]+\.php$/.test(path);
  // Public v1 uses the documented string error; legacy/auth retain their wire
  // contracts. Only transform JSON error objects, never status availability/HTML.
  if(!legacy&&reply.statusCode>=400&&typeof payload==='string'&&String(reply.getHeader('content-type')??'').includes('application/json')){
   try{const body=JSON.parse(payload);if(body?.error&&typeof body.error==='object'&&typeof body.error.code==='string'){
    payload=JSON.stringify({...body,error:typeof body.error.message==='string'?body.error.message:body.error.code,code:body.error.code});
    reply.removeHeader('content-length');
   }}catch{/* Non-JSON payload remains untouched. */}
  }
  // Retain legacy wire/cache semantics; credentialed replies always tighten them.
  const legacyLifetime=path.includes('/live')?30:60;
  if(!applyPublicV1Cache(request,reply)&&request.method!=='OPTIONS'&&(!legacy||privateResponse||reply.statusCode>=400||!reply.hasHeader('Cache-Control')))reply.header('Cache-Control',privateResponse?'private, no-store':reply.statusCode<200||reply.statusCode>=300||path==='/api/status'?'no-store':`public, max-age=0, s-maxage=${legacyLifetime}, stale-while-revalidate=${legacyLifetime}`);
  return payload;
 });
 // Reserve only read preflights; unknown/nonpublic paths keep ordinary 404.
 app.options('/api/*',async(request,reply)=>isPublicApiPath(request.url.split('?')[0]!)?reply.code(204).send():reply.code(404).send({error:'Not found'}));
}
