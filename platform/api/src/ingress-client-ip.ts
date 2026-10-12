import {BlockList,isIP} from 'node:net';
/** Pinned from https://api.cloudflare.com/client/v4/ips on 2026-10-12;
 * etag38f79d050aa027e3be3865e495dcc9bc. Update only after reviewing official ranges.
 * Fastify must trust only the actual ingress proxy, not arbitrary XFF prefixes. */
export const CLOUDFLARE_RANGES={
 ipv4:['173.245.48.0/20','103.21.244.0/22','103.22.200.0/22','103.31.4.0/22','141.101.64.0/18','108.162.192.0/18','190.93.240.0/20','188.114.96.0/20','197.234.240.0/22','198.41.128.0/17','162.158.0.0/15','104.16.0.0/13','104.24.0.0/14','172.64.0.0/13','131.0.72.0/22'],
 ipv6:['2400:cb00::/32','2606:4700::/32','2803:f800::/32','2405:b500::/32','2405:8100::/32','2a06:98c0::/29','2c0f:f248::/32'],
} as const;
const cloudflare=new BlockList();
for(const [family,ranges]of Object.entries(CLOUDFLARE_RANGES))for(const cidr of ranges){const [address,bits]=cidr.split('/');cloudflare.addSubnet(address!,Number(bits),family as 'ipv4'|'ipv6');}
/** request.ip is Fastify's nearest untrusted hop. Never derive trust from raw XFF.
 * A direct origin caller cannot activate CF headers by adding a forged prefix. */
export function ingressClientIp(request:{ip:string;headers:Record<string,string|string[]|undefined>}):string{
 const family=isIP(request.ip);if(!family||request.ip.includes('%')||!cloudflare.check(request.ip,family===4?'ipv4':'ipv6'))return request.ip;
 const client=request.headers['cf-connecting-ip'];
 return typeof client==='string'&&client.length<=45&&!client.includes('%')&&isIP(client)?client:request.ip;
}
