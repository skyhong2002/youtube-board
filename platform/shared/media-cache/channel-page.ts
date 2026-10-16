import {lookup as dnsLookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {request as httpsRequest,type RequestOptions} from 'node:https';
import type {ClientRequest,IncomingMessage} from 'node:http';
import {parse,type DefaultTreeAdapterTypes as Tree} from 'parse5';
import {avatarSourceUrl,publicMediaAddress,MediaHttpStatusError,type DownloadOptions} from './download.js';
import {MediaCacheError,validChannel} from './store.js';

export const CHANNEL_PAGE_LIMITS=Object.freeze({bytes:2*1024*1024,headBytes:256*1024,timeoutMs:10000});
const fail=(code:string):never=>{throw new MediaCacheError(code);};
export function channelPageUrl(channelId:string):string {
 if(!validChannel(channelId))return fail('INVALID_CHANNEL_ID');
 return 'https://www.youtube.com/channel/'+channelId;
}
/** Parse only inert head metadata, never scripts/JSON, links in the body or a base URL.
 * Require both canonical and OpenGraph identities to equal the requested channel. */
export function channelAvatarFromHtml(channelId:string,body:Buffer):string {
 const expected=channelPageUrl(channelId);
 if(body.length>CHANNEL_PAGE_LIMITS.bytes)return fail('CHANNEL_PAGE_TOO_LARGE');
 let html:string;try{html=new TextDecoder('utf-8',{fatal:true}).decode(body);}catch{return fail('CHANNEL_PAGE_INVALID');}
 const close=/<\/head\s*>/i.exec(html.slice(0,CHANNEL_PAGE_LIMITS.headBytes));
 if(!close)return fail('CHANNEL_PAGE_METADATA_MISSING');
 const headHtml=html.slice(0,close.index+close[0].length);
 if(Buffer.byteLength(headHtml,'utf8')>CHANNEL_PAGE_LIMITS.headBytes)return fail('CHANNEL_PAGE_METADATA_MISSING');
 const document=parse(headHtml);
 const element=(node:Tree.Node):node is Tree.Element=>'tagName'in node;
 const root=document.childNodes.find(n=>element(n)&&n.tagName==='html') as Tree.Element|undefined;
 const head=root?.childNodes.find(n=>element(n)&&n.tagName==='head') as Tree.Element|undefined;
 const canonical:string[]=[],identities:string[]=[],images:string[]=[];
 for(const node of head?.childNodes??[]){
  if(!element(node)||node.namespaceURI!=='http://www.w3.org/1999/xhtml')continue;
  const attr=(name:string)=>node.attrs.find(a=>a.name===name)?.value;
  if(node.tagName==='link'&&(attr('rel')??'').toLowerCase().split(/\s+/).includes('canonical'))canonical.push(attr('href')??'');
  if(node.tagName==='meta'){
   const property=(attr('property')??'').toLowerCase();
   if(property==='og:url')identities.push(attr('content')??'');
   if(property==='og:image')images.push(attr('content')??'');
  }
 }
 if(!canonical.length||!identities.length||[...canonical,...identities].some(value=>value!==expected))return fail('CHANNEL_PAGE_IDENTITY_MISMATCH');
 if(!images.length||new Set(images).size!==1)return fail('CHANNEL_PAGE_IMAGE_MISSING');
 try{return avatarSourceUrl(images[0]!).href;}catch{return fail('CHANNEL_PAGE_IMAGE_REJECTED');}
}
/** No configurable URL, credentials, cookies, redirects, compression or JS runtime.
 * DNS answers are all checked before one address is pinned into the TLS request. */
export async function resolveChannelAvatar(channelId:string,options:DownloadOptions={}):Promise<string> {
 const url=new URL(channelPageUrl(channelId)),signal=AbortSignal.any([AbortSignal.timeout(CHANNEL_PAGE_LIMITS.timeoutMs),...(options.signal?[options.signal]:[])]);
 signal.throwIfAborted();
 const addresses=await new Promise<Array<{address:string;family:number}>>((resolve,reject)=>{
  const abort=()=>reject(new MediaCacheError('CHANNEL_PAGE_TIMEOUT'));signal.addEventListener('abort',abort,{once:true});
  (options.lookup??(host=>dnsLookup(host,{all:true,verbatim:true})))(url.hostname).then(resolve,()=>reject(new MediaCacheError('CHANNEL_PAGE_DNS_FAILED'))).finally(()=>signal.removeEventListener('abort',abort));
 });
 signal.throwIfAborted();
 if(!addresses.length||addresses.length>32||addresses.some(item=>!publicMediaAddress(item.address)||isIP(item.address)!==item.family))return fail('CHANNEL_PAGE_ADDRESS_REJECTED');
 const chosen=addresses[0]!;
 const body=await new Promise<Buffer>((resolve,reject)=>{
  let settled=false,req:ClientRequest|undefined,response:IncomingMessage|undefined;
  const rejectRequest=(code:string,status?:number)=>{if(settled)return;settled=true;signal.removeEventListener('abort',abort);response?.destroy();req?.destroy();reject(status!==undefined&&Number.isInteger(status)&&status>=100&&status<=599?new MediaHttpStatusError(code,status):new MediaCacheError(code));};
  const abort=()=>rejectRequest('CHANNEL_PAGE_TIMEOUT');signal.addEventListener('abort',abort,{once:true});
  try{
   const requestOptions:RequestOptions&{autoSelectFamily:boolean}={hostname:url.hostname,port:443,path:url.pathname,method:'GET',servername:url.hostname,rejectUnauthorized:true,agent:false,family:chosen.family,autoSelectFamily:false,lookup:(_host,_opts,callback)=>callback(null,chosen.address,chosen.family),headers:{Accept:'text/html','Accept-Encoding':'identity','User-Agent':'YouTubeBoard/avatar-cache'}};
   req=(options.request??httpsRequest)(requestOptions,res=>{
    response=res;
    if(res.statusCode!==200){rejectRequest(res.statusCode&&res.statusCode>=300&&res.statusCode<400?'CHANNEL_PAGE_REDIRECT_REJECTED':'CHANNEL_PAGE_STATUS',res.statusCode);return;}
    const type=String(res.headers['content-type']??'').split(';').map(v=>v.trim().toLowerCase()),length=res.headers['content-length'];
    if(type[0]!=='text/html'||type.some(v=>v.startsWith('charset=')&&!['charset=utf-8','charset="utf-8"'].includes(v))||res.headers['content-encoding']&&res.headers['content-encoding']!=='identity'){rejectRequest('CHANNEL_PAGE_TYPE_REJECTED');return;}
    if(length!==undefined&&(!/^\d+$/.test(length)||Number(length)>CHANNEL_PAGE_LIMITS.bytes)){rejectRequest('CHANNEL_PAGE_TOO_LARGE');return;}
    const chunks:Buffer[]=[];let size=0;
    res.on('data',(chunk:Buffer)=>{if(settled)return;size+=chunk.length;if(size>CHANNEL_PAGE_LIMITS.bytes){rejectRequest('CHANNEL_PAGE_TOO_LARGE');return;}try{options.consume?.(chunk.length);}catch{rejectRequest('RUN_BYTE_BUDGET');return;}chunks.push(Buffer.from(chunk));});
    res.on('error',()=>rejectRequest('CHANNEL_PAGE_FAILED'));res.on('aborted',()=>rejectRequest('CHANNEL_PAGE_FAILED'));
    res.on('end',()=>{if(settled)return;if(length!==undefined&&Number(length)!==size){rejectRequest('CHANNEL_PAGE_FAILED');return;}settled=true;signal.removeEventListener('abort',abort);resolve(Buffer.concat(chunks,size));});
   });
   req.on('error',()=>rejectRequest('CHANNEL_PAGE_FAILED'));if(settled)req.destroy();else req.end();if(signal.aborted)abort();
  }catch{rejectRequest('CHANNEL_PAGE_FAILED');}
 });
 signal.throwIfAborted();return channelAvatarFromHtml(channelId,body);
}
