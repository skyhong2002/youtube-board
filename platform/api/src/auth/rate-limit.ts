import {clientNetwork} from '../rate-limit.js';

interface Budget {until:number;hits:number}
interface Limits {network:number;aggregate:number;global:number;windowMs:number;capacity?:number}
export const AUTH_NETWORK_LIMITS={
 start:{network:20,aggregate:200,global:4000,windowMs:600000},
 callback:{network:30,aggregate:300,global:3000,windowMs:60000},
 anonymousSession:{network:120,aggregate:1200,global:12000,windowMs:60000},
} as const;

/** Auth-only hierarchy. /64 privacy-address churn shares an IPv6 /48 budget;
 * native and mapped IPv4 retain their existing single-address budgets. Separate
 * LRUs stop /64 churn from evicting the corresponding /48 counter. All ceilings
 * are checked before charging, so rejected traffic cannot spend another layer's
 * remaining budget. Limits are process-local, not distributed fleet quotas. */
export function authNetworkLimiter(limits:Limits){
 const capacity=limits.capacity??2048;
 if(![limits.network,limits.aggregate,limits.global,limits.windowMs,capacity].every(n=>Number.isSafeInteger(n)&&n>0))throw new Error('Invalid auth rate budget');
 const networks=new Map<string,Budget>(),aggregates=new Map<string,Budget>();
 let global:Budget={until:0,hits:0};
 const cell=(map:Map<string,Budget>,key:string,now:number)=>{const prior=map.get(key);return prior&&prior.until>now?prior:{until:now+limits.windowMs,hits:0};};
 const charge=(map:Map<string,Budget>,key:string,budget:Budget)=>{map.delete(key);if(map.size>=capacity)map.delete(map.keys().next().value!);budget.hits++;map.set(key,budget);};
 return(ip:string,now:number)=>{
  if(!Number.isFinite(now))return false;
  if(now>=global.until)global={until:now+limits.windowMs,hits:0};
  if(global.hits>=limits.global)return false;
  const network=clientNetwork(ip),aggregate=network.endsWith('::/64')?network.split(':').slice(0,3).join(':')+'::/48':null;
  const local=cell(networks,network,now);
  if(local.hits>=limits.network)return false;
  const wide=aggregate===null?null:cell(aggregates,aggregate,now);
  if(wide&&wide.hits>=limits.aggregate)return false;
  charge(networks,network,local);if(wide&&aggregate!==null)charge(aggregates,aggregate,wide);global.hits++;
  return true;
 };
}
