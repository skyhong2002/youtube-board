import {Resolver} from 'node:dns/promises';
import {BlockList,isIP} from 'node:net';
interface DnsResolver {reverse(ip:string):Promise<string[]>;resolve4(host:string):Promise<string[]>;resolve6(host:string):Promise<string[]>;cancel():void}
interface Options {resolver?:()=>DnsResolver;now?:()=>number;deadlineMs?:number;maxConcurrent?:number;maxCache?:number;maxStartsPerMinute?:number}
const blocked=new BlockList();
for(const [ip,bits] of [['0.0.0.0',8],['10.0.0.0',8],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.168.0.0',16],['224.0.0.0',4],['240.0.0.0',4]] as const)blocked.addSubnet(ip,bits,'ipv4');
for(const [ip,bits] of [['::',128],['::1',128],['fc00::',7],['fe80::',10],['ff00::',8]] as const)blocked.addSubnet(ip,bits,'ipv6');
export function isGoogleCrawlerAgent(agent:unknown):boolean {
  return typeof agent==='string'&&agent.length<=512&&!/youtube-board-verify\/1\.0/i.test(agent)&&/(?:^|[\s;(])(?:Googlebot(?:-[A-Za-z]+)?|Google-InspectionTool)(?:\/[0-9.]+)?(?=$|[\s;)])/i.test(agent);
}
function address(raw:string):string|null {
  const family=isIP(raw);if(!family||raw.includes('%')||raw.length>45||blocked.check(raw,family===4?'ipv4':'ipv6'))return null;
  if(family===4)return raw;
  const normalized=new URL(`http://[${raw}]/`).hostname.slice(1,-1);
  // PTR for mapped IPv4 must use in-addr.arpa, not the mapped ip6.arpa name.
  const mapped=/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(normalized);
  if(mapped){const high=parseInt(mapped[1]!,16),low=parseInt(mapped[2]!,16);return address(`${high>>>8}.${high&255}.${low>>>8}.${low&255}`);}
  return normalized;
}
function hostname(raw:string):string|null {
  if(typeof raw!=='string'||raw.length>254)return null;
  const host=raw.toLowerCase().replace(/\.$/,'');
  if(!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(host)||!/(?:^|\.)(?:googlebot|google)\.com$/.test(host))return null;
  return host;
}
/** DNS evidence only, never a request-header claim. IPs and DNS names are bounded
 * ephemeral memory, never diagnostic output. False also means unverified, timeout,
 * pressure, or resolver failure; it does not prove a caller is malicious. */
export function createGoogleCrawlerVerifier(options:Options={}) {
  const now=options.now??Date.now,deadline=options.deadlineMs??750,maxConcurrent=options.maxConcurrent??4,maxCache=options.maxCache??1024,maxStarts=options.maxStartsPerMinute??60;
  if(!Number.isInteger(deadline)||deadline<1||deadline>2000||!Number.isInteger(maxConcurrent)||maxConcurrent<1||maxConcurrent>8||!Number.isInteger(maxCache)||maxCache<1||maxCache>4096||!Number.isInteger(maxStarts)||maxStarts<1||maxStarts>300)throw Error('Invalid crawler verifier limits');
  const cache=new Map<string,{verified:boolean;until:number}>(),active=new Map<string,()=>void>();let closed=false;const pending=new Set<Promise<boolean>>();
  let startsWindow=-1,starts=0;
  const factory=options.resolver??(()=>new Resolver({timeout:deadline,tries:1}));
  function verify(ip:string,agent:unknown):boolean|Promise<boolean> {
    if(closed||!isGoogleCrawlerAgent(agent))return false;
    const normalized=address(ip);if(!normalized)return false;
    const saved=cache.get(normalized);
    if(saved){cache.delete(normalized);if(saved.until>now()){cache.set(normalized,saved);return saved.verified;}}
    // Do not share promises: duplicate IP requests must not create unbounded
    // waiting response records while one lookup is running.
    if(active.has(normalized)||active.size>=maxConcurrent)return false;
    // New DNS starts have a separate fixed-minute budget. Saturation is not
    // evidence about this IP: do not insert a negative cache entry.
    const window=Math.floor(now()/60000);if(!Number.isFinite(window))return false;
    if(window!==startsWindow){startsWindow=window;starts=0;}
    if(starts>=maxStarts)return false;
    starts++;
    let resolver:DnsResolver;try{resolver=factory();}catch{return false;}
    let stop!:()=>void,stopped=false;
    const cancelled=new Promise<boolean>(resolve=>{stop=()=>{stopped=true;try{resolver.cancel();}catch{}resolve(false);};});
    active.set(normalized,stop);
    const timeout=setTimeout(stop,deadline);timeout.unref();
    const lookup=(async()=>{
      const names=await resolver.reverse(normalized);
      if(stopped)return false;
      const target=new BlockList();target.addAddress(normalized,isIP(normalized)===4?'ipv4':'ipv6');
      for(const name of names.slice(0,4)){
        if(stopped)return false;
        const host=hostname(name);if(!host)continue;
        const answers=await Promise.allSettled([resolver.resolve4(host),resolver.resolve6(host)]);
        if(stopped)return false;
        for(const answer of answers)if(answer.status==='fulfilled')for(const candidate of answer.value.slice(0,32)){
          const family=isIP(candidate);if(family&&target.check(candidate,family===4?'ipv4':'ipv6'))return true;
        }
      }
      return false;
    })().catch(()=>false);
    const result=Promise.race([lookup,cancelled]).then(verified=>{
      if(!closed){cache.set(normalized,{verified,until:now()+(verified?3600000:60000)});if(cache.size>maxCache)cache.delete(cache.keys().next().value!);}
      return verified;
    }).finally(()=>{clearTimeout(timeout);active.delete(normalized);pending.delete(result);try{resolver.cancel();}catch{}});
    pending.add(result);return result;
  }
  async function close(){closed=true;for(const stop of active.values())stop();cache.clear();await Promise.allSettled(pending);}
  return {verify,close};
}
