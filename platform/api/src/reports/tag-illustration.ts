import {parseFragment,serialize} from 'parse5';
import {tagHttpOptions} from '../../../jobs/src/tag-http.js';
import {BadQuery} from './query.js';
import {TAG_PICTURE_SOURCE,validTagLabel,pictureRevision,tagPicturePath,tagPictureUpstream,type TagPicture} from '../../../shared/tag-illustration.js';
import type {KeywordRelationsOptions} from './keyword-relations.js';

const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const text=(v:unknown,max=1024):v is string=>typeof v==='string'&&v.length<=max&&!/[\p{Cc}\p{Cs}]/u.test(v);
function httpsLink(v:unknown):string|null {if(!text(v,2048))return null;try{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password?v:null;}catch{return null;}}
function attribution(v:unknown):TagPicture['attribution'] {
 if(v===null)return null;if(!object(v))throw Error();
 const pageUrl=httpsLink(v.pageUrl);if(!pageUrl)throw Error();
 for(const k of ['license','artist'])if(v[k]!==null&&!text(v[k]))throw Error();
 const licenseUrl=v.licenseUrl===null?null:httpsLink(v.licenseUrl);if(v.licenseUrl!==null&&!licenseUrl)throw Error();
 return {pageUrl,license:v.license as string|null,licenseUrl,artist:v.artist as string|null};
}
/** Drop all unknown/private fields; pictures must match this byte-exact source tag. */
export function parseTagPicture(body:unknown,tag:string,kind:'person'|'visual'):TagPicture|null {
 if(!object(body)||body.tag!==tag)throw Error();
 const v=body[kind];if(v===null)return null;if(!object(v))throw Error();
 const label=v.label===null?tag:v.label;if(!text(label,256))throw Error();
 if(kind==='person'){
  if(v.avatar===null)return null;if(!object(v.avatar))throw Error();
  const revision=pictureRevision(v.avatar.url,tag,'avatar');if(!revision)throw Error();
  return {kind:'avatar',label,image:tagPicturePath(tag,'avatar',revision),emoji:null,attribution:attribution(v.avatar)};
 }
 if(!['place','flag','logo','emoji'].includes(String(v.kind)))throw Error();
 if(v.kind==='emoji'){
  if(!text(v.emoji,32)||!v.emoji)throw Error();return {kind:'emoji',label,image:null,emoji:v.emoji,attribution:attribution(v.source)};
 }
 const revision=pictureRevision(v.image,tag,'visual');if(!revision)throw Error();
 return {kind:v.kind as 'place'|'flag'|'logo',label,image:tagPicturePath(tag,'visual',revision),emoji:null,attribution:attribution(v.source)};
}
/** Rebuild only inert vector shapes. Reject scripts, entities, links and CSS; never
 * return upstream SVG markup or permit the browser to request its resources. */
export function inertTagSvg(bytes:Buffer):Buffer {
 const input=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
 if(/<!|<\?|&/i.test(input))throw Error();
 const tree=parseFragment(input);if(tree.childNodes.length!==1)throw Error();
 const allowed=new Set(['svg','g','path','circle','ellipse','rect','line','polyline','polygon']);
 const attrs=new Set(['xmlns','viewBox','width','height','d','x','y','x1','x2','y1','y2','cx','cy','r','rx','ry','points','fill','stroke','stroke-width','stroke-linecap','stroke-linejoin','fill-rule','clip-rule','opacity','fill-opacity','stroke-opacity','transform']);
 const visit=(node:any)=>{
  if(node.nodeName==='#text'){if(node.value.trim())throw Error();return;}
  if(!allowed.has(node.tagName)||node.namespaceURI!=='http://www.w3.org/2000/svg')throw Error();
  for(const a of node.attrs){if(!attrs.has(a.name)||a.prefix||(a.namespace&&!(a.name==='xmlns'&&a.value==='http://www.w3.org/2000/svg'))||/[\p{Cc}\p{Cs}]/u.test(a.value)||a.value.length>65536||/url|[&<>\\]/i.test(a.value))throw Error();}
  for(const child of node.childNodes??[])visit(child);
 };
 const root:any=tree.childNodes[0];if(root.tagName!=='svg')throw Error();visit(root);
 return Buffer.from(serialize(tree));
}

export function createTagIllustration(options:KeywordRelationsOptions={}){
 const env=options.env??process.env,transport=options.fetcher??fetch,clock=options.clock??(()=>new Date());
 let auth:Promise<Record<string,string>>|undefined,active=0,holdUntil=0;
 const cache=new Map<string,{bytes:Buffer;mime:string;until:number}>();
 const headers=()=>auth??= (async()=>{
  const h:Record<string,string>={DNT:'1','Sec-GPC':'1'};
  if(env.TS_TAG_RELATIONS_AUTH_MODE==='anonymous')return h;
  if(env.TS_TAG_RELATIONS_AUTH_MODE&&env.TS_TAG_RELATIONS_AUTH_MODE!=='service')throw Error();
  const credentials=await (options.credentials??(()=>tagHttpOptions(env)))();if(!credentials.serviceToken)throw Error();
  h['X-Service-Token']=credentials.serviceToken;return h;
 })();
 async function read(url:string,image=false):Promise<{bytes:Buffer;mime:string}>{
  const saved=cache.get(url);if(saved&&saved.until>+clock())return {bytes:Buffer.from(saved.bytes),mime:saved.mime};
  if(saved)cache.delete(url);
  if(active>=2||+clock()<holdUntil)throw Error();active++;
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
  let response:Response|undefined,reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  const cancel=()=>{controller.abort();if(reader)void reader.cancel().catch(()=>{});else if(response?.body)void response.body.cancel().catch(()=>{});};
  const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{cancel();reject(Error('Tag picture deadline'));},3000);});
  const work=(async()=>{try{
   const configured=await headers();controller.signal.throwIfAborted();
   response=await transport(url,{headers:{...configured,Accept:image?'image/webp,image/svg+xml':'application/json'},credentials:'omit',redirect:'error',cache:'no-store',signal:controller.signal});
   controller.signal.throwIfAborted();
   if(response.status===429){const value=response.headers.get('retry-after');const wait=value&&/^\d+$/.test(value)?Number(value):value?Math.ceil((Date.parse(value)-+clock())/1000):60;holdUntil=Number.isFinite(wait)?Math.max(holdUntil,+clock()+Math.max(60,wait)*1000):Infinity;throw Error();}
   if(response.status!==200||!response.body)throw Error();
   const mime=(response.headers.get('content-type')??'').split(';')[0]!.trim().toLowerCase();
   if(!(image?['image/webp','image/svg+xml']:['application/json']).includes(mime))throw Error();
   reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
   while(true){const part=await reader.read();controller.signal.throwIfAborted();if(part.done)break;size+=part.value.byteLength;if(size>(image?524288:131072))throw Error();chunks.push(part.value);}
   const bytes=Buffer.concat(chunks,size),control=response.headers.get('cache-control')??'',age=/(?:^|,)\s*max-age=(\d+)/i.exec(control);
   if(env.TS_TAG_RELATIONS_AUTH_MODE==='anonymous'&&!response.headers.has('set-cookie')&&/(?:^|,)\s*public(?:,|$)/i.test(control)&&!/(?:private|no-store|no-cache)/i.test(control)&&age){
    if(cache.size>=32)cache.delete(cache.keys().next().value!);
    cache.set(url,{bytes:Buffer.from(bytes),mime,until:+clock()+Math.min(60,Number(age[1]))*1000});
   }
   return {bytes,mime};
  }finally{cancel();active--;}})();
  // A timed-out operation that ignores abort still occupies its slot until its
  // underlying work settles; it cannot start an unbounded sequence of tasks.
  try{return await Promise.race([work,deadline]);}finally{clearTimeout(timer!);cancel();}
 }
 const report=async(keyword:string)=>{
  if(!validTagLabel(keyword))throw new BadQuery('Invalid keyword');
  const base={keyword,source:TAG_PICTURE_SOURCE,illustration:null};
  if(env.TS_TAG_RELATIONS_ENABLED!=='true')return {...base,status:'disabled' as const};
  try{
   const endpoint=TAG_PICTURE_SOURCE+'/api/v1/tags/'+encodeURIComponent(keyword);
   const person=await read(endpoint+'/person?accent=ff0000');
   let illustration=parseTagPicture(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(person.bytes)),keyword,'person');
   if(!illustration){const visual=await read(endpoint+'/visual?accent=ff0000');illustration=parseTagPicture(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(visual.bytes)),keyword,'visual');}
   return {...base,status:'available' as const,illustration};
  }catch{return {...base,status:'unavailable' as const};}
 };
 const image=async(keyword:string,kind:'avatar'|'visual',revision:string)=>{
  if(env.TS_TAG_RELATIONS_ENABLED!=='true')throw Error();
  const result=await read(tagPictureUpstream(keyword,kind,revision),true);
  if(result.mime==='image/svg+xml')return {...result,bytes:inertTagSvg(result.bytes)};
  if(result.bytes.length<12||result.bytes.toString('ascii',0,4)!=='RIFF'||result.bytes.toString('ascii',8,12)!=='WEBP'||result.bytes.readUInt32LE(4)!==result.bytes.length-8)throw Error();
  return result;
 };
 return {report,image};
}
