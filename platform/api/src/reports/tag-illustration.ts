import {parseFragment,serialize} from 'parse5';
import {tagHttpOptions} from '../../../jobs/src/tag-http.js';
import {BadQuery} from './query.js';
import {TAG_PICTURE_SOURCE,validTagLabel,pictureRevision,tagPicturePath,tagPictureUpstream,type TagPicture,type TagPictureSummary} from '../../../shared/tag-illustration.js';
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
/** Bulk maps: a malformed envelope throws, a malformed entry is skipped. A valid
 * avatar wins over a visual for the same byte-exact tag. Keys such as __proto__
 * are own properties of a null-prototype record, never prototype writes. */
export function parseTagPictures(avatars:unknown,visuals:unknown):Record<string,TagPictureSummary> {
 if(!object(avatars)||!object(avatars.avatars)||!object(visuals)||!object(visuals.visuals))throw Error();
 const pictures:Record<string,TagPictureSummary>=Object.create(null);
 const put=(tag:string,value:TagPictureSummary)=>{Object.defineProperty(pictures,tag,{value,enumerable:true,writable:true,configurable:true});};
 for(const [tag,url] of Object.entries(avatars.avatars)){
  const revision=validTagLabel(tag)?pictureRevision(url,tag,'avatar'):null;
  if(revision)put(tag,{kind:'avatar',image:tagPicturePath(tag,'avatar',revision),emoji:null,aspect:null});
 }
 for(const [tag,v] of Object.entries(visuals.visuals)){
  if(!validTagLabel(tag)||Object.hasOwn(pictures,tag)||!object(v)||!['place','flag','logo','emoji'].includes(String(v.kind)))continue;
  if(v.kind==='emoji'){if(text(v.emoji,32)&&v.emoji)put(tag,{kind:'emoji',image:null,emoji:v.emoji,aspect:null});continue;}
  const revision=pictureRevision(v.image,tag,'visual');if(!revision)continue;
  const aspect=typeof v.aspect==='number'&&Number.isFinite(v.aspect)&&v.aspect>0?Math.min(8,Math.max(0.25,v.aspect)):null;
  put(tag,{kind:v.kind as 'place'|'flag'|'logo',image:tagPicturePath(tag,'visual',revision),emoji:null,aspect});
 }
 return pictures;
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
 let auth:Promise<Record<string,string>>|undefined,active=0,holdUntil=0,cachedBytes=0;
 // Insertion-ordered memory cache: at most 64 entries and 24 MiB of raw bytes.
 const cache=new Map<string,{bytes:Buffer;mime:string;until:number}>(),waiters:Array<()=>void>=[];
 const forget=(url:string)=>{const saved=cache.get(url);if(saved){cachedBytes-=saved.bytes.length;cache.delete(url);}};
 const hit=(url:string)=>{const saved=cache.get(url);if(saved&&saved.until>+clock())return {bytes:Buffer.from(saved.bytes),mime:saved.mime};forget(url);return null;};
 // A released slot passes straight to the oldest waiter, so a free slot never
 // coexists with queued image reads and JSON fail-fast stays unchanged.
 const release=()=>{const next=waiters.shift();if(next)next();else active--;};
 const slot=(image:boolean)=>{
  if(active<2){active++;return Promise.resolve();}
  if(!image||waiters.length>=24)return Promise.reject(Error('Tag picture slots busy'));
  return new Promise<void>((resolve,reject)=>{
   const waiter=()=>{clearTimeout(timer);resolve();};
   const timer=setTimeout(()=>{const at=waiters.indexOf(waiter);if(at>=0)waiters.splice(at,1);reject(Error('Tag picture queue deadline'));},4000);
   waiters.push(waiter);
  });
 };
 const headers=()=>auth??= (async()=>{
  const h:Record<string,string>={DNT:'1','Sec-GPC':'1'};
  if(env.TS_TAG_RELATIONS_AUTH_MODE==='anonymous')return h;
  if(env.TS_TAG_RELATIONS_AUTH_MODE&&env.TS_TAG_RELATIONS_AUTH_MODE!=='service')throw Error();
  const credentials=await (options.credentials??(()=>tagHttpOptions(env)))();if(!credentials.serviceToken)throw Error();
  h['X-Service-Token']=credentials.serviceToken;return h;
 })();
 async function read(url:string,image=false,jsonCap=131072):Promise<{bytes:Buffer;mime:string}>{
  const early=hit(url);if(early)return early;
  if(+clock()<holdUntil)throw Error();
  await slot(image);
  // Waiters re-check cooldown and a cache entry filled while they queued.
  if(+clock()<holdUntil){release();throw Error();}
  const queued=hit(url);if(queued){release();return queued;}
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
   while(true){const part=await reader.read();controller.signal.throwIfAborted();if(part.done)break;size+=part.value.byteLength;if(size>(image?524288:jsonCap))throw Error();chunks.push(part.value);}
   const bytes=Buffer.concat(chunks,size),control=response.headers.get('cache-control')??'',age=/(?:^|,)\s*max-age=(\d+)/i.exec(control);
   // Revisioned image URLs are immutable: reuse them up to a day in either auth
   // mode. JSON stays anonymous-only and at most 60 seconds.
   const ttl=age?Math.min(image?86400:60,Number(age[1])):0;
   if((image||env.TS_TAG_RELATIONS_AUTH_MODE==='anonymous')&&!response.headers.has('set-cookie')&&/(?:^|,)\s*public(?:,|$)/i.test(control)&&!/(?:private|no-store|no-cache)/i.test(control)&&ttl>0){
    forget(url);
    while(cache.size>=64||(cache.size&&cachedBytes+size>25165824))forget(cache.keys().next().value!);
    cache.set(url,{bytes:Buffer.from(bytes),mime,until:+clock()+ttl*1000});cachedBytes+=size;
   }
   return {bytes,mime};
  }finally{cancel();release();}})();
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
 const pictures=async()=>{
  const base={source:TAG_PICTURE_SOURCE,pictures:Object.create(null) as Record<string,TagPictureSummary>};
  if(env.TS_TAG_RELATIONS_ENABLED!=='true')return {...base,status:'disabled' as const};
  try{
   const json=(r:{bytes:Buffer})=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(r.bytes));
   const [avatars,visuals]=await Promise.all(['tag-avatars','tag-visuals'].map(name=>read(TAG_PICTURE_SOURCE+'/api/v1/'+name,false,524288).then(json)));
   return {...base,status:'available' as const,pictures:parseTagPictures(avatars,visuals)};
  }catch{return {...base,status:'unavailable' as const};}
 };
 const image=async(keyword:string,kind:'avatar'|'visual',revision:string)=>{
  if(env.TS_TAG_RELATIONS_ENABLED!=='true')throw Error();
  const result=await read(tagPictureUpstream(keyword,kind,revision),true);
  if(result.mime==='image/svg+xml')return {...result,bytes:inertTagSvg(result.bytes)};
  if(result.bytes.length<12||result.bytes.toString('ascii',0,4)!=='RIFF'||result.bytes.toString('ascii',8,12)!=='WEBP'||result.bytes.readUInt32LE(4)!==result.bytes.length-8)throw Error();
  return result;
 };
 return {report,pictures,image};
}
