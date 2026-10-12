import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {open,realpath} from 'node:fs/promises';
import {basename,dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const limits=Object.freeze({cases:40,bodyBytes:2*1024*1024,totalBytes:32*1024*1024,manifestBytes:256*1024,depth:64,nodes:100000,totalNodes:500000,differences:100,pathChars:256});
// Reviewed public compatibility GET routes: api/src/legacy/index.ts. The test
// compares this literal set to that source without loading the API/server.
export const legacyPaths=Object.freeze([
 'api_live_day','api_live_date','api_live_hour','api_live_tag_date','live_date','live_tvbs','video_live','csv_live_line',
 'tags_list','tags_index','tags_all','video_tags','video_tags_title','channels_list','channel_videos','channels_videos','api_tag','api_tag_log','tags_day','tags_video','tags_relation_date','tag_month','tag_period','tag_tags_days',
 'cloud','cloud_tag_date','cloud_tag_date_noapi','group_view','api_channel_log','channel_pred','ai_day','api_topic','api_event','api_comment','api_duration','api_get_photo',
].map(name=>'/api/'+name+'.php'));
const routeSet=new Set(legacyPaths),shaPattern=/^[a-f0-9]{64}$/,idPattern=/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const hashString=value=>typeof value==='string'&&shaPattern.test(value);
const sha=value=>createHash('sha256').update(value).digest('hex');
export class ParityInvalid extends Error {constructor(code){super(code);this.code=code;}}
function invalid(code){throw new ParityInvalid(code);}

/** Bounded JSON parser: numbers retain their exact source token, duplicate
 * decoded keys are refused, and no object prototype or numeric coercion is used. */
export function parseLosslessJson(input,budget={nodes:0}){
 if(typeof input!=='string'||Buffer.byteLength(input)>limits.bodyBytes)invalid('JSON_SIZE');
 let at=0,nodes=0;
 const whitespace=()=>{while(at<input.length&&/[\x20\t\r\n]/.test(input[at]))at++;};
 const string=()=>{
  const start=at++;let closed=false;
  while(at<input.length){const c=input[at++];if(c==='"'){closed=true;break;}if(c==='\\')at++;}
  if(!closed)invalid('JSON_SYNTAX');
  let value;try{value=JSON.parse(input.slice(start,at));}catch{invalid('JSON_SYNTAX');}
  if(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value))invalid('JSON_UNICODE');
  return value;
 };
 const value=depth=>{
  if(depth>limits.depth)invalid('JSON_DEPTH');
  if(++nodes>limits.nodes||++budget.nodes>limits.totalNodes)invalid('JSON_NODES');
  whitespace();const c=input[at];
  if(c==='"')return {type:'string',value:string()};
  if(c==='{'||c==='['){
   const object=c==='{',end=object?'}':']',items=object?new Map():[];at++;whitespace();
   if(input[at]===end){at++;return {type:object?'object':'array',value:items};}
   for(;;){
    let key;if(object){if(input[at]!=='"')invalid('JSON_SYNTAX');key=string();if(items.has(key))invalid('JSON_DUPLICATE_KEY');whitespace();if(input[at++]!==':')invalid('JSON_SYNTAX');}
    const item=value(depth+1);if(object)items.set(key,item);else items.push(item);
    whitespace();if(input[at]===end){at++;break;}if(input[at++]!==',')invalid('JSON_SYNTAX');whitespace();
   }
   return {type:object?'object':'array',value:items};
  }
  for(const [token,type,v]of [['true','boolean',true],['false','boolean',false],['null','null',null]])if(input.startsWith(token,at)){at+=token.length;return {type,value:v};}
  const match=/-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;match.lastIndex=at;
  const number=match.exec(input);if(!number)invalid('JSON_SYNTAX');at=match.lastIndex;
  return {type:'number',value:number[0]};
 };
 const tree=value(0);whitespace();if(at!==input.length)invalid('JSON_SYNTAX');return tree;
}
function manifestValue(node){
 if(node.type==='object')return Object.fromEntries([...node.value].map(([k,v])=>[k,manifestValue(v)]));
 if(node.type==='array')return node.value.map(manifestValue);
 // Status is the manifest schema's only numeric field. Validate its original
 // token before conversion so rounded fractions/exponents cannot become valid.
 if(node.type==='number'){
  if(!/^[2-5][0-9]{2}$/.test(node.value))invalid('STATUS');
  return Number(node.value);
 }
 return node.value;
}
function keys(value,expected){return value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===expected.length&&expected.every(key=>Object.hasOwn(value,key));}
function utf8(buffer){try{return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(buffer);}catch{invalid('UTF8_INVALID');}}

/** Media type and parameter names are case-insensitive; charset values too.
 * Parameter order/quotes are immaterial. Other values and missing parameters
 * remain significant (including absent charset versus explicit UTF-8). */
export function normalizeContentType(value){
 if(typeof value!=='string'||value.length>256||/[\x00-\x08\x0a-\x1f\x7f]/.test(value))invalid('CONTENT_TYPE');
 const token="[!#$%&'*+.^_`|~A-Za-z0-9-]+",head=new RegExp('^\\s*('+token+'/'+token+')').exec(value);
 if(!head)invalid('CONTENT_TYPE');let at=head[0].length;const parameters=new Map();
 const pattern=new RegExp('\\s*;\\s*('+token+')\\s*=\\s*(?:('+token+')|"((?:[^"\\\\\\r\\n]|\\\\[^\\r\\n])*)")','y');
 while(at<value.length){if(!value.slice(at).trim())break;pattern.lastIndex=at;const match=pattern.exec(value);if(!match)invalid('CONTENT_TYPE');at=pattern.lastIndex;const key=match[1].toLowerCase();if(parameters.has(key))invalid('CONTENT_TYPE');let v=match[2]??match[3].replace(/\\(.)/g,'$1');if(key==='charset')v=v.toLowerCase();parameters.set(key,v);}
 return {media:head[1].toLowerCase(),parameters:[...parameters].sort(([a],[b])=>a<b?-1:a>b?1:0)};
}
export function validateManifest(manifest,side){
 if(!keys(manifest,['format','source','reader','clock','origin','cases'])||manifest.format!=='youtube-board-parity-v1')invalid('MANIFEST_SCHEMA');
 if(!keys(manifest.source,['artifacts','rowFingerprint'])||!hashString(manifest.source.rowFingerprint)||!Array.isArray(manifest.source.artifacts)||manifest.source.artifacts.length<1||manifest.source.artifacts.length>8)invalid('SOURCE_SCHEMA');
 const artifacts=manifest.source.artifacts.map(item=>{if(!keys(item,['sha256'])||!hashString(item.sha256))invalid('ARTIFACT_SCHEMA');return item.sha256;});
 if(new Set(artifacts).size!==artifacts.length)invalid('ARTIFACT_DUPLICATE');
 if(!keys(manifest.reader,['name','fingerprint'])||manifest.reader.name!==(side==='left'?'laravel':'typescript')||!hashString(manifest.reader.fingerprint))invalid('READER_SCHEMA');
 if(typeof manifest.clock!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(manifest.clock)||!Number.isFinite(Date.parse(manifest.clock))||new Date(manifest.clock).toISOString()!==manifest.clock.replace(/(?<!\.\d{3})Z$/,'.000Z'))invalid('CLOCK');
 if(manifest.origin!=='http://parity.local')invalid('ORIGIN');
 if(!Array.isArray(manifest.cases)||manifest.cases.length<1||manifest.cases.length>limits.cases)invalid('CASE_COUNT');
 const ids=new Set();
 for(const c of manifest.cases){
  if(!keys(c,['id','request','status','contentType','bodyFile','bodySha256'])||typeof c.id!=='string'||!idPattern.test(c.id)||ids.has(c.id))invalid('CASE_SCHEMA');ids.add(c.id);
  if(typeof c.request!=='string'||c.request.length>4096||/[\x00-\x20\x7f#\\]/.test(c.request))invalid('REQUEST');
  const path=c.request.split('?')[0];if(!routeSet.has(path))invalid('REQUEST_ROUTE');
  // Raw path matching prevents URL parser normalization from accepting ../,
  // encoded paths, authority forms, fragments or an unreviewed endpoint.
  if(!Number.isInteger(c.status)||c.status<200||c.status>599)invalid('STATUS');
  if(c.status>=300&&c.status<400)invalid('REDIRECT');
  normalizeContentType(c.contentType);
  if(c.bodyFile!==c.id+'.body'||!hashString(c.bodySha256))invalid('BODY_REFERENCE');
 }
 return manifest;
}
async function readBounded(path,maximum){
 let handle;try{
  handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  const stat=await handle.stat();if(!stat.isFile()||stat.nlink!==1)invalid('FILE_KIND');if(stat.size>maximum)invalid('FILE_SIZE');
  const chunks=[];let size=0;for(;;){const buffer=Buffer.alloc(Math.min(65536,maximum+1-size)),{bytesRead}=await handle.read(buffer,0,buffer.length,null);if(!bytesRead)break;size+=bytesRead;if(size>maximum)invalid('FILE_SIZE');chunks.push(buffer.subarray(0,bytesRead));}
  return Buffer.concat(chunks,size);
 }catch(error){if(error instanceof ParityInvalid)throw error;invalid('FILE_UNAVAILABLE');}finally{await handle?.close();}
}
async function readManifest(path,side,budget){
 const resolved=resolve(path),directory=await realpath(dirname(resolved)).catch(()=>invalid('FILE_UNAVAILABLE'));
 const bytes=await readBounded(join(directory,basename(resolved)),limits.manifestBytes);
 const manifest=validateManifest(manifestValue(parseLosslessJson(utf8(bytes),budget)),side);
 return {manifest,directory};
}
function pointerSegment(key){return /^[A-Za-z_][A-Za-z0-9_-]{0,47}$/.test(key)?key:'@key-'+sha(key).slice(0,16);}
function safePath(path){return path.length<=limits.pathChars?path:path.slice(0,limits.pathChars-22)+'/@path-'+sha(path).slice(0,15);}
export function compareTrees(left,right,add,path='/body'){
 if(left.type!==right.type){add(path,'type');return;}
 if(left.type==='object'){
  const keys=[...new Set([...left.value.keys(),...right.value.keys()])].sort();
  for(const key of keys){const p=path+'/'+pointerSegment(key);if(!left.value.has(key)||!right.value.has(key))add(p,'missing-key');else compareTrees(left.value.get(key),right.value.get(key),add,p);}
 }else if(left.type==='array'){
  if(left.value.length!==right.value.length)add(path,'array-length');
  for(let i=0;i<Math.min(left.value.length,right.value.length);i++)compareTrees(left.value[i],right.value[i],add,path+'/'+i);
 }else if(left.value!==right.value)add(path,left.type==='number'?'number-token':'value');
}

export async function compareBundles(leftPath,rightPath){
 const budget={nodes:0};
 const left=await readManifest(leftPath,'left',budget),right=await readManifest(rightPath,'right',budget),a=left.manifest,b=right.manifest;
 if(JSON.stringify(a.source.artifacts)!==JSON.stringify(b.source.artifacts)||a.source.rowFingerprint!==b.source.rowFingerprint)invalid('SOURCE_MISMATCH');
 if(a.clock!==b.clock)invalid('CLOCK_MISMATCH');if(a.origin!==b.origin)invalid('ORIGIN_MISMATCH');
 const byId=new Map(b.cases.map(c=>[c.id,c]));
 if(a.cases.length!==b.cases.length||a.cases.some(c=>byId.get(c.id)?.request!==c.request))invalid('CASES_MISMATCH');
 const output={format:'youtube-board-parity-result-v1',result:'equal',caseCount:a.cases.length,equalCases:0,differentCases:0,errorResponseCases:0,bodyBytes:0,differenceCount:0,differences:[],differencesTruncated:false,externalCalls:0};
 for(const ca of [...a.cases].sort((x,y)=>x.id<y.id?-1:x.id>y.id?1:0)){
  const cb=byId.get(ca.id),before=output.differenceCount;
  const add=(path,kind)=>{output.differenceCount++;if(output.differences.length<limits.differences)output.differences.push({caseId:ca.id,path:safePath(path),kind});else output.differencesTruncated=true;};
  if(ca.status>=400||cb.status>=400)output.errorResponseCases++;
  if(ca.status!==cb.status)add('/status','status');
  const ta=normalizeContentType(ca.contentType),tb=normalizeContentType(cb.contentType);
  if(JSON.stringify(ta)!==JSON.stringify(tb))add('/contentType','content-type');
  const bodies=[];
  for(const [bundle,c]of [[left,ca],[right,cb]]){
   const bytes=await readBounded(join(bundle.directory,c.bodyFile),Math.min(limits.bodyBytes,limits.totalBytes-output.bodyBytes));
   output.bodyBytes+=bytes.length;if(output.bodyBytes>limits.totalBytes)invalid('TOTAL_SIZE');
   if(sha(bytes)!==c.bodySha256)invalid('BODY_HASH');bodies.push(bytes);
  }
  const jsonA=ta.media==='application/json'||ta.media.endsWith('+json'),jsonB=tb.media==='application/json'||tb.media.endsWith('+json');
  // Even identical malformed or duplicate-key JSON is not accepted. Preserve
  // evidence validity independently of whether there happens to be a diff.
  const treeA=jsonA?parseLosslessJson(utf8(bodies[0]),budget):null,treeB=jsonB?parseLosslessJson(utf8(bodies[1]),budget):null;
  if(jsonA&&jsonB)compareTrees(treeA,treeB,add);
  else if(!bodies[0].equals(bodies[1]))add('/body','bytes');
  if(before===output.differenceCount)output.equalCases++;else output.differentCases++;
 }
 if(output.differenceCount)output.result='different';
 return output;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{if(process.argv.length!==4||process.argv.slice(2).some(arg=>arg.startsWith('--')))invalid('ARGUMENTS');const result=await compareBundles(process.argv[2],process.argv[3]);console.log(JSON.stringify(result));process.exitCode=result.result==='equal'?0:1;}
 catch(error){console.log(JSON.stringify({format:'youtube-board-parity-result-v1',result:'invalid',error:{code:error instanceof ParityInvalid?error.code:'BUNDLE_UNAVAILABLE'},externalCalls:0}));process.exitCode=2;}
}
