/** Shared bounded decoder for historical scalar maps, weighted records and envelopes. */
export class ReportReadBound extends Error {readonly statusCode=422;constructor(message:string){super(message);}}
export const CACHE_PAYLOAD_BYTES=8*1024*1024;
const cloudWrappers=['result','keywords','keywords_json','tags_result','data'];
const dayWrappers=['tags_result','tags_video','tags_views','tags_json','tags','result','data'];
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const numeric=(v:unknown)=>typeof v==='number'?Number.isFinite(v):typeof v==='string'&&/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(v.trim())&&Number.isFinite(Number(v));
export function cacheWeights(value:unknown,options:{positiveOnly?:boolean;countFirst?:boolean}={}){
 let decoded=value;if(typeof value==='string'){if(Buffer.byteLength(value)>CACHE_PAYLOAD_BYTES)throw new ReportReadBound('Cache payload exceeds read budget');if(!value.trim()||value.trim()==='null')return {words:new Map<string,number>(),status:'empty' as const};try{decoded=JSON.parse(value);}catch{return {words:new Map<string,number>(),status:'malformed' as const};}}
 const wrappers=options.countFirst?dayWrappers:[...cloudWrappers,'tags_video','tags_views','tags_json','tags'];
 const fields=options.countFirst?['count','weight','score','value']:['weight','count','score','value'];
 const measurement=(v:Record<string,unknown>)=>fields.some(k=>numeric(v[k]));
 for(let depth=0;depth<4&&object(decoded);depth++){
  const envelope=decoded;const name=wrappers.find(k=>Array.isArray(envelope[k])||object(envelope[k])&&!measurement(envelope[k]));
  if(!name)break;decoded=decoded[name];
 }
 if(!Array.isArray(decoded)&&!object(decoded))return {words:new Map<string,number>(),status:decoded===null||decoded===undefined?'empty' as const:'malformed' as const};
 const entries=Object.entries(decoded);if(entries.length>20000)throw new ReportReadBound('Cache term count exceeds read budget');
 let validValues=0;const words=new Map<string,number>();for(const [key,value]of entries){const record=object(value)?value:null,name=record?((options.countFirst?record.tag??record.keyword??record.word:record.word??record.keyword??record.tag)??(Array.isArray(decoded)?'':key)):Array.isArray(decoded)?'':key,raw=record?fields.map(k=>record[k]).find(v=>v!==null&&v!==undefined):value;
  if(typeof name!=='string'||!name.trim()||!numeric(raw))continue;if(name.length>1000)throw new ReportReadBound('Cache term exceeds read budget');const n=Number(raw);if(Math.abs(n)>Number.MAX_SAFE_INTEGER)throw new ReportReadBound('Cache weight exceeds numeric precision');validValues++;if(options.positiveOnly!==false&&n<=0)continue;words.set(name.trim(),n);
 }
 return {words,status:entries.length&&!validValues?'malformed' as const:words.size?'valid' as const:'empty' as const};
}
