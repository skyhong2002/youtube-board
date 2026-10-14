import {isSupportedKeyword,fetchKeywordRelations,type RelationsResult} from './keyword-relations';
import {parseKeywordIllustration,type IllustrationView} from './keyword-illustration';
export interface KeywordMetadata {relations:RelationsResult;illustration:IllustrationView}
const unavailable=():Extract<RelationsResult,{kind:"unavailable"}>=>({kind:'unavailable',reason:'network',retryAfterSeconds:null,retryable:true});
/** Anonymous, per-render reads of the configured internal gateway. No shared cache or visitor
 * headers. Both optional reads run concurrently, with a 3.5s deadline and bounded bodies. */
export async function fetchKeywordMetadata(keyword:string,base:string,transport:typeof fetch=globalThis.fetch):Promise<KeywordMetadata>{
 if(!isSupportedKeyword(keyword))return {relations:{...unavailable(),reason:'invalid-keyword',retryable:false},illustration:{kind:'unavailable'}};
 const controller=new AbortController();
 let timer:ReturnType<typeof setTimeout>;
 const deadline=new Promise<KeywordMetadata>(resolve=>{timer=setTimeout(()=>{controller.abort();resolve({relations:{...unavailable(),reason:'timeout'},illustration:{kind:'unavailable'}});},3500);});
 const endpoint=(kind:string)=>base.replace(/\/$/,'')+'/keywords/'+encodeURIComponent(keyword)+'/'+kind;
 const internal:typeof fetch=(input,init)=>transport(endpoint('relations'),{...init,mode:undefined,headers:{Accept:'application/json',DNT:'1','Sec-GPC':'1'},signal:controller.signal});
 const illustration=async():Promise<IllustrationView>=>{
  let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  try{
   const response=await transport(endpoint('illustration'),{cache:'no-store',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',headers:{Accept:'application/json',DNT:'1','Sec-GPC':'1'},signal:controller.signal});
   if(response.status!==200||response.redirected||!response.body||!/^application\/json(?:;|$)/i.test(response.headers.get('content-type')??''))return {kind:'unavailable'};
   const length=response.headers.get('content-length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>131072))return {kind:'unavailable'};
   reader=response.body.getReader();let size=0;const chunks:Uint8Array[]=[];
   while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>131072)return {kind:'unavailable'};chunks.push(part.value);}
   const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
   return parseKeywordIllustration(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),keyword);
  }catch{return {kind:'unavailable'};}finally{void reader?.cancel().catch(()=>{});}
 };
 try{
  return await Promise.race([deadline,Promise.all([fetchKeywordRelations(keyword,{fetch:internal,signal:controller.signal,timeoutMs:3500}),illustration()])
   .then(([relations,picture])=>({relations:relations??unavailable(),illustration:picture}))]);
 }finally{clearTimeout(timer!);controller.abort();}
}
