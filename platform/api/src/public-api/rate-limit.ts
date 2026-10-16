import type {FastifyInstance,FastifyRequest} from 'fastify';
import {ingressClientIp} from '../ingress-client-ip.js';
import {clientNetwork} from '../rate-limit.js';
import {applyPublicV1Cache} from '../public-v1-cache.js';
import {looksLikePersonalApiKey} from '../reader/api-key-store.js';

export interface PublicKeyLookup {lookup(token:unknown,at?:Date):Promise<{keyId:string;userId:string}|null>}
interface BudgetOptions {internalLimit?:number;globalLimit?:number;anonymousLimit?:number;keyTrafficLimit?:number}
export interface PublicApiPolicyOptions extends BudgetOptions {keys?:PublicKeyLookup|null;clock?:()=>Date;lookupGlobalLimit?:number}
type Budget={used:number;reset:number};
export interface RateDecision {allowed:boolean;limit:number;remaining:number;reset:number;scope:'ip'|'key'|'internal'|'network'|'global'}
/** Single-process fixed-window counters, bounded LRUs and independent global caps.
 * A CDN hit does not reach these counters; cached headers describe origin state. */
export function publicApiBudgets(options:BudgetOptions={}){
 const counters=new Map<string,Budget>(),owners=new Map<string,Budget>();let ownerReset=0;
 const wide={anonymous:new Map<string,Budget>(),keyed:new Map<string,Budget>()};
 const lanes={anonymous:{used:0,reset:0},keyed:{used:0,reset:0}};
 const capacity=4096,globalLimit=options.globalLimit??12000,internalLimit=options.internalLimit??3000;
 const anonymousLimit=options.anonymousLimit??Math.ceil(globalLimit/3),keyTrafficLimit=options.keyTrafficLimit??globalLimit-anonymousLimit;
 for(const n of [globalLimit,internalLimit])if(!Number.isSafeInteger(n)||n<1||n>12000)throw new Error('Invalid public API quota');
 for(const n of [anonymousLimit,keyTrafficLimit])if(!Number.isSafeInteger(n)||n<0)throw new Error('Invalid public API quota');
 if(anonymousLimit+keyTrafficLimit>globalLimit)throw new Error('Public API lanes exceed global quota');
 const current=(map:Map<string,Budget>,key:string,now:number)=>{const old=map.get(key);return old&&old.reset>now?old:{used:0,reset:(Math.floor(now/60000)+1)*60000};};
 const charge=(map:Map<string,Budget>,key:string,b:Budget)=>{map.delete(key);if(map.size>=capacity)map.delete(map.keys().next().value!);b.used++;map.set(key,b);};
 return (ip:string,ownerId:string|null,internal:boolean,now:number):RateDecision=>{
  if(!Number.isFinite(now)||now<0)throw new Error('Invalid public API clock');
  if(now>=ownerReset){owners.clear();ownerReset=(Math.floor(now/60000)+1)*60000;}
  const identity=clientNetwork(ip),scope=internal?'internal':ownerId?'key':'ip',limit=internal?internalLimit:ownerId?1000:60;
  const cells=!internal&&ownerId?owners:counters,key=internal?'internal':ownerId?'owner:'+ownerId:'ip:'+identity,cell=current(cells,key,now);
  const decision=(allowed:boolean,which:RateDecision['scope'],cap:number,b:Budget)=>({allowed,scope:which,limit:cap,remaining:Math.max(0,cap-b.used),reset:Math.ceil(b.reset/1000)});
  // Internal ISR has its own bounded lane; callers cannot choose socket.remoteAddress.
  if(internal){if(cell.used>=limit)return decision(false,scope,limit,cell);charge(counters,key,cell);return decision(true,scope,limit,cell);}
  const lane=ownerId?'keyed':'anonymous',laneLimit=ownerId?keyTrafficLimit:anonymousLimit;
  if(now>=lanes[lane].reset){lanes[lane]={used:0,reset:(Math.floor(now/60000)+1)*60000};wide[lane].clear();}
  const global=lanes[lane];
  if(global.used>=laneLimit)return decision(false,'global',laneLimit,global);
  // Keep owner's full-window usage; anonymous/network churn must never evict
  // an owner into a new1000-request allowance. New owners fail closed at cap.
  if(ownerId&&!owners.has(key)&&owners.size>=capacity)return decision(false,'global',laneLimit,global);
  if(cell.used>=limit)return decision(false,scope,limit,cell);
  const aggregate=identity.endsWith('::/64')?identity.split(':').slice(0,3).join(':')+'::/48':null;
  const networks=wide[lane];
  // Retain every charged /48 until its lane's window ends. At bookkeeping
  // saturation new /48s fail closed; another lane cannot evict/block them.
  if(aggregate&&!networks.has(aggregate)&&networks.size>=capacity)return decision(false,'network',4000,{used:4000,reset:global.reset});
  const aggregateCell=aggregate?current(networks,aggregate,now):null;
  if(aggregateCell&&aggregateCell.used>=4000)return decision(false,'network',4000,aggregateCell);
  charge(cells,key,cell);if(aggregate&&aggregateCell){aggregateCell.used++;networks.set(aggregate,aggregateCell);}global.used++;
  return decision(true,scope,limit,cell);
 };
}
export function isPublicApiPath(path:string){return /^\/api\/v1(?:\/|$)/.test(path)||/^\/api\/[^/]+\.php$/.test(path)||path==='/api/status';}
function publicPath(request:FastifyRequest){const route=request.routeOptions.url;return route&&isPublicApiPath(route)?route:request.url.split('?')[0]!;}
function loopback(request:FastifyRequest){const ip=request.socket.remoteAddress;return ip==='127.0.0.1'||ip==='::1'||ip==='::ffff:127.0.0.1';}
/** Register before all public GET routes. Auth/ops/private RSS are outside scope. */
export function registerPublicApiPolicy(app:FastifyInstance,options:PublicApiPolicyOptions={}){
 const lookupLimit=options.lookupGlobalLimit??12000;
 if(!Number.isSafeInteger(lookupLimit)||lookupLimit<1||lookupLimit>12000)throw new Error('Invalid key lookup quota');
 const clock=options.clock??(()=>new Date()),take=publicApiBudgets(options),lookupBudgets=publicApiBudgets({internalLimit:3000,globalLimit:lookupLimit,anonymousLimit:0,keyTrafficLimit:lookupLimit});
 // Keep active misses for the entire fixed window. Never evict a hot network
 // into a fresh allowance; map saturation degrades new networks to anonymous.
 const misses=new Map<string,{misses:number;pending:number}>();let missReset=0;
 const reserveLookup=(network:string,now:number)=>{
  if(now>=missReset){misses.clear();missReset=(Math.floor(now/60000)+1)*60000;}
  const cell=misses.get(network)??{misses:0,pending:0};
  if(cell.misses+cell.pending>=20||(!misses.has(network)&&misses.size>=4096))return null;
  cell.pending++;misses.set(network,cell);
  return (miss:boolean)=>{cell.pending--;if(miss)cell.misses++;if(!cell.misses&&!cell.pending&&misses.get(network)===cell)misses.delete(network);};
 };
 const state=new WeakMap<FastifyRequest,{decision:RateDecision;private:boolean}>();
 app.addHook('onRequest',async(request,reply)=>{
  const path=publicPath(request);if(!isPublicApiPath(path))return;
  reply.header('Access-Control-Allow-Origin','*').header('Access-Control-Expose-Headers','x-ratelimit-limit, x-ratelimit-remaining, x-ratelimit-reset, Retry-After');
  if(request.method==='OPTIONS')return reply.header('Access-Control-Allow-Methods','GET, HEAD, OPTIONS').header('Access-Control-Allow-Headers','x-api-key, Accept').header('Access-Control-Max-Age','600').header('Cache-Control','public, max-age=600').code(204).send();
  const at=clock(),ip=ingressClientIp(request),internal=loopback(request),raw=request.headers['x-api-key'];let ownerId:string|null=null;
  const privateResponse=raw!==undefined||request.headers['x-service-token']!==undefined||request.headers.authorization!==undefined||request.headers.cookie!==undefined;
  // The lookup gate is separate from the public quota: valid clients can reach
  // 1,000/owner, while arbitrary canonical token churn is bounded before SQL.
  const network=clientNetwork(ip);
  const finishLookup=!internal&&options.keys&&looksLikePersonalApiKey(raw)?reserveLookup(network,+at):null;
  if(finishLookup&&options.keys){
   const gate=lookupBudgets(ip,'lookup:'+network,false,+at);
   if(gate.allowed){
    let miss=false;
    try{
     const identity=await options.keys.lookup(raw,at);
     if(identity)ownerId=identity.userId;
     else miss=true;
    }catch{return reply.header('Cache-Control','private, no-store').code(503).send({error:'API key service unavailable',code:'API_KEY_UNAVAILABLE'});}
    finally{finishLookup(miss);}
   }else finishLookup(false);
  }
  const decision=take(ip,ownerId,internal,+at);state.set(request,{decision,private:privateResponse});
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
