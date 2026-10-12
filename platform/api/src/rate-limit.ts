import {isIP} from 'node:net';
export class RateLimitError extends Error{readonly statusCode=429;constructor(public readonly retryAfter=60){super('rate_limited');}}
/** Privacy IPv6 addresses share a /64; mapped IPv4 shares its IPv4 bucket. */
export function clientNetwork(ip:string):string{
 if(isIP(ip)!==6)return ip;let value=ip.toLowerCase().split('%')[0]!;
 if(value.includes('.')){const at=value.lastIndexOf(':');const bytes=value.slice(at+1).split('.').map(Number);value=value.slice(0,at+1)+((bytes[0]!<<8)|bytes[1]!).toString(16)+':'+((bytes[2]!<<8)|bytes[3]!).toString(16);}
 const [left,right]=value.split('::'),a=left?left.split(':'):[],b=right?right.split(':'):[];
 const words=(right!==undefined?[...a,...Array(8-a.length-b.length).fill('0'),...b]:a).map(x=>parseInt(x,16));
 if(words.slice(0,5).every(x=>x===0)&&words[5]===65535)return`${words[6]!>>8}.${words[6]!&255}.${words[7]!>>8}.${words[7]!&255}`;
 return words.slice(0,4).map(x=>x.toString(16)).join(':')+'::/64';
}
/** LRU bounds memory; independent global fixed-window budget bounds churn. */
export function boundedLimiter(limit:number,windowMs:number,globalLimit:number,capacity=2048){
 const cells=new Map<string,{until:number;hits:number}>();let globalUntil=0,globalHits=0;
 return(key:string,now:number)=>{if(now>=globalUntil){globalUntil=now+windowMs;globalHits=0;}if(globalHits>=globalLimit)return false;
 const old=cells.get(key),cell=old&&old.until>now?old:{until:now+windowMs,hits:0};if(cell.hits>=limit)return false;
 cells.delete(key);if(cells.size>=capacity)cells.delete(cells.keys().next().value!);cell.hits++;globalHits++;cells.set(key,cell);return true;};
}
