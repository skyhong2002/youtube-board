import {isIP} from 'node:net';
/** Only operator-configured ingress IP/CIDRs are trusted. Never infer trust from a request header. */
export function trustedProxies(value:string|undefined,production=(process.env.APP_ENV??process.env.NODE_ENV)==='production'):false|string[]{
 if(!value?.trim()){if(production)throw new Error('Production requires an explicit trusted ingress allowlist');return false;}const values=value.split(',').map(v=>v.trim());
 if(values.length>16||values.some(v=>{const [ip,bits,...extra]=v.split('/'),family=isIP(ip!);return !family||extra.length>0||(bits!==undefined&&(!/^\d{1,3}$/.test(bits)||Number(bits)<(family===4?8:32)||Number(bits)>(family===4?32:128)));}))throw new Error('Invalid trusted proxy allowlist');
 return values;
}
