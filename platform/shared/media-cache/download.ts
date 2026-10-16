import {lookup as dnsLookup} from 'node:dns/promises';
import {BlockList,isIP} from 'node:net';
import {request as httpsRequest,type RequestOptions} from 'node:https';
import type {ClientRequest,IncomingMessage} from 'node:http';
import {MEDIA_LIMITS,MediaCacheError} from './store.js';

const hosts=new Set(['yt3.ggpht.com','yt3.googleusercontent.com']);
const blocked=new BlockList(),globalV6=new BlockList();
for(const [ip,bits]of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]] as const)blocked.addSubnet(ip,bits,'ipv4');
globalV6.addSubnet('2000::',3,'ipv6');
for(const [ip,bits]of [['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20]] as const)blocked.addSubnet(ip,bits,'ipv6');
export function publicMediaAddress(address:string){const family=isIP(address);return family===4?!blocked.check(address,'ipv4'):family===6&&globalV6.check(address,'ipv6')&&!blocked.check(address,'ipv6');}
export function avatarSourceUrl(raw:string):URL{
 if(typeof raw!=='string'||raw.length>2048||/[\x00-\x20\x7f\\]/.test(raw)||/%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(raw))throw new MediaCacheError('SOURCE_URL_REJECTED');
 let url:URL;try{url=new URL(raw);}catch{throw new MediaCacheError('SOURCE_URL_REJECTED');}
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash||!hosts.has(url.hostname))throw new MediaCacheError('SOURCE_URL_REJECTED');return url;
}
export type MediaLookup=(hostname:string)=>Promise<Array<{address:string;family:number}>>;
export type MediaRequest=(options:RequestOptions,callback:(response:IncomingMessage)=>void)=>ClientRequest;
export interface DownloadOptions {signal?:AbortSignal;consume?:(bytes:number)=>void;lookup?:MediaLookup;request?:MediaRequest}
/** Public numeric classification only; never retain URL, headers or provider body. */
export class MediaHttpStatusError extends MediaCacheError {
 constructor(code:string,public readonly httpStatus:number){super(code);}
}
export async function downloadAvatar(sourceUrl:string,options:DownloadOptions={}):Promise<Buffer>{
 const url=avatarSourceUrl(sourceUrl),signal=AbortSignal.any([AbortSignal.timeout(10000),...(options.signal?[options.signal]:[])]);
 signal.throwIfAborted();
 const addresses=await new Promise<Array<{address:string;family:number}>>((resolve,reject)=>{
  const abort=()=>reject(new MediaCacheError('DOWNLOAD_TIMEOUT'));signal.addEventListener('abort',abort,{once:true});
  (options.lookup??(host=>dnsLookup(host,{all:true,verbatim:true})))(url.hostname).then(resolve,()=>reject(new MediaCacheError('DNS_FAILED'))).finally(()=>signal.removeEventListener('abort',abort));
 });
 signal.throwIfAborted();
 if(!addresses.length||addresses.length>32||addresses.some(item=>!publicMediaAddress(item.address)||isIP(item.address)!==item.family))throw new MediaCacheError('SOURCE_ADDRESS_REJECTED');
 const chosen=addresses[0]!;
 return new Promise((resolve,reject)=>{
  let settled=false;let req:ClientRequest|undefined;let response:IncomingMessage|undefined;
  const fail=(code:string,status?:number)=>{if(settled)return;settled=true;signal.removeEventListener('abort',abort);response?.destroy();req?.destroy();reject(status!==undefined&&Number.isInteger(status)&&status>=100&&status<=599?new MediaHttpStatusError(code,status):new MediaCacheError(code));};
  const abort=()=>fail('DOWNLOAD_TIMEOUT');signal.addEventListener('abort',abort,{once:true});
  try{
   const requestOptions:RequestOptions&{autoSelectFamily:boolean}={hostname:url.hostname,port:443,path:url.pathname+url.search,method:'GET',servername:url.hostname,rejectUnauthorized:true,agent:false,family:chosen.family,autoSelectFamily:false,lookup:(_host,_opts,callback)=>callback(null,chosen.address,chosen.family),headers:{Accept:'image/png,image/jpeg,image/webp','Accept-Encoding':'identity','User-Agent':'YouTubeBoard/avatar-cache'}};
   req=(options.request??httpsRequest)(requestOptions,res=>{
    response=res;
    if(res.statusCode!==200){fail(res.statusCode&&res.statusCode>=300&&res.statusCode<400?'REDIRECT_REJECTED':'DOWNLOAD_STATUS',res.statusCode);return;}
    const mime=String(res.headers['content-type']??'').split(';')[0]!.trim().toLowerCase(),length=res.headers['content-length'];
    if(!['image/png','image/jpeg','image/webp'].includes(mime)||res.headers['content-encoding']&&res.headers['content-encoding']!=='identity'){fail('IMAGE_TYPE_REJECTED');return;}
    if(length!==undefined&&(!/^\d+$/.test(length)||Number(length)>MEDIA_LIMITS.inputBytes)){fail('DOWNLOAD_TOO_LARGE');return;}
    const chunks:Buffer[]=[];let size=0;
    res.on('data',(chunk:Buffer)=>{if(settled)return;size+=chunk.length;if(size>MEDIA_LIMITS.inputBytes){fail('DOWNLOAD_TOO_LARGE');return;}try{options.consume?.(chunk.length);}catch{fail('RUN_BYTE_BUDGET');return;}chunks.push(Buffer.from(chunk));});
    res.on('error',()=>fail('DOWNLOAD_FAILED'));res.on('aborted',()=>fail('DOWNLOAD_FAILED'));
    res.on('end',()=>{if(settled)return;if(length!==undefined&&Number(length)!==size){fail('DOWNLOAD_FAILED');return;}const body=Buffer.concat(chunks,size);if(!rasterType(body)||rasterType(body)!==mime){fail('IMAGE_TYPE_REJECTED');return;}settled=true;signal.removeEventListener('abort',abort);resolve(body);});
   });
   req.on('error',()=>fail('DOWNLOAD_FAILED'));if(settled)req.destroy();else req.end();
   if(signal.aborted)abort();
  }catch{fail('DOWNLOAD_FAILED');}
 });
}
export function rasterType(body:Buffer):string|null{
 if(body.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
 if(body.length>=3&&body[0]===255&&body[1]===216&&body[2]===255)return 'image/jpeg';
 if(body.length>=12&&body.toString('ascii',0,4)==='RIFF'&&body.toString('ascii',8,12)==='WEBP')return 'image/webp';return null;
}
