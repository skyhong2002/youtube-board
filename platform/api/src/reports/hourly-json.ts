import type {Row} from '../db/client.js';

export const HOURLY_JSON_LIMITS={bytes:131072,depth:64,candidates:16,work:524288} as const;
type DecodeState='decoded'|'empty'|'malformed'|'unsupported'|'oversized'|'bounded';
export interface HourlyDecode {state:DecodeState;topics:Row[];extracted:boolean;invalidItems:number}
const wrappers=['events','事件','事件列表','主要事件','topics','議題','議題列表','result','results','data','items','hourly_events'];
const titles=['事件','議題','標題','event','topic','title'];
const record=(v:unknown):v is Row=>!!v&&typeof v==='object'&&!Array.isArray(v);

/** Historical display only. Never use this decoder to validate new model output. */
export function decodeHourlyTopics(value:unknown,legacy=false):HourlyDecode{
 const result=(state:DecodeState,topics:Row[]=[],extracted=false,invalidItems=0):HourlyDecode=>({state,topics,extracted,invalidItems});
 if(typeof value!=='string')return result('unsupported');
 if(value.length>HOURLY_JSON_LIMITS.bytes||Buffer.byteLength(value)>HOURLY_JSON_LIMITS.bytes)return result('oversized');
 const input=value.trim();if(!input)return result('malformed');
 let work=0,attempts=0,bounded=false;
 const spend=()=>{if(++work>HOURLY_JSON_LIMITS.work){bounded=true;return false;}return true;};
 // The depth cap also bounds subsequent recursive source-field traversal.
 const parse=(candidate:string):{value:unknown}|null=>{
  if(++attempts>HOURLY_JSON_LIMITS.candidates){bounded=true;return null;}
  let depth=0,string=false,escape=false;
  for(const c of candidate){if(!spend())return null;if(string){if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')string=false;continue;}if(c==='"')string=true;else if(c==='['||c==='{'){if(++depth>HOURLY_JSON_LIMITS.depth){bounded=true;return null;}}else if(c===']'||c==='}')depth--;}
  try{return {value:JSON.parse(candidate)};}catch{return null;}
 };
 const shape=(decoded:unknown,extracted:boolean):HourlyDecode=>{
  let list:unknown[];
  if(Array.isArray(decoded))list=decoded;
  else if(record(decoded)){
   const key=wrappers.find(key=>Array.isArray(decoded[key])||record(decoded[key]));
   if(key){const payload=decoded[key];list=Array.isArray(payload)?payload:Object.values(payload as Row);}
   else{list=Object.values(decoded);if(!list.length)return result('unsupported',[],extracted);}
  }else return result('unsupported',[],extracted);
  if(!list.length)return result('empty',[],extracted);
  const valid=list.filter((item):item is Row=>record(item)&&titles.some(key=>typeof item[key]==='string'&&(item[key] as string).trim()));
  // Preserve original indices, including rejected slots, for exact source citations.
  return result(valid.length?'decoded':'unsupported',valid.length?list.map(item=>record(item)?item:{}):[],extracted,list.length-valid.length);
 };
 const whole=parse(input);if(whole)return shape(whole.value,false);
 if(bounded)return result('bounded');
 if(!legacy)return result('malformed');

 // Prefer an explicitly fenced payload even when surrounding prose contains braces.
 let fenceAt=0;
 while((fenceAt=input.indexOf('```',fenceAt))!==-1){
  const start=fenceAt+3,end=input.indexOf('```',start);if(end===-1)break;
  const candidate=input.slice(start,end).replace(/^json\s*/i,'').trim(),parsed=parse(candidate);
  if(parsed)return shape(parsed.value,true);if(bounded)return result('bounded');fenceAt=end+3;
 }
 // Search balanced candidates with a total scan budget: malformed openings cannot
 // cause quadratic unbounded rescans. Brackets inside escaped strings are ignored.
 for(let start=0;start<input.length;start++){
  if(!spend())return result('bounded');const opening=input[start];if(opening!=='['&&opening!=='{')continue;
  const stack:string[]=[];let string=false,escape=false;
  for(let at=start;at<input.length;at++){
   if(!spend())return result('bounded');const c=input[at]!;
   if(string){if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')string=false;continue;}
   if(c==='"'){string=true;continue;}
   if(c==='['||c==='{'){stack.push(c);if(stack.length>HOURLY_JSON_LIMITS.depth)return result('bounded');continue;}
   if(c!==']'&&c!=='}')continue;
   if(stack.pop()!==(c===']'?'[':'{'))break;
   if(!stack.length){const parsed=parse(input.slice(start,at+1));if(parsed)return shape(parsed.value,true);if(bounded)return result('bounded');break;}
  }
 }
 return result('malformed');
}
