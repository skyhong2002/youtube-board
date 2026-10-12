import {open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {workflowShutdownSignal} from '../../shared/shutdown.js';
import {SOURCE} from './vocabulary.js';

export interface TagHttpOptions { apiKey?: string; intervalMs?: number; maxRetries?: number }
const validKey=(key:string)=>key.length>=1&&key.length<=4096&&/^[\x21-\x7e]+$/.test(key);
/** Keys never enter queue payloads, URLs, diagnostics or upstream error bodies. */
export async function tagHttpOptions(env:NodeJS.ProcessEnv):Promise<TagHttpOptions>{
 const direct=env.TAG_SOURCE_API_KEY,file=env.TAG_SOURCE_API_KEY_FILE;
 if(direct&&file)throw new Error('Configure only one tag API key source');
 let apiKey=direct||undefined;
 if(file){
  try{const handle=await open(file,constants.O_RDONLY|constants.O_NONBLOCK);try{const stat=await handle.stat();if(!stat.isFile()||stat.size>4098)throw Error();const buffer=Buffer.alloc(4099),{bytesRead}=await handle.read(buffer,0,buffer.length,0);if(bytesRead>4098)throw Error();apiKey=buffer.subarray(0,bytesRead).toString('utf8').replace(/\r?\n$/,'');}finally{await handle.close();}}
  catch{throw new Error('Cannot read protected tag API key file');}
 }
 if(apiKey!==undefined&&!validKey(apiKey))throw new Error('Invalid tag API key configuration');
 let intervalMs:number|undefined;
 if(env.TAG_SOURCE_INTERVAL_MS!==undefined&&env.TAG_SOURCE_INTERVAL_MS!==''){
  if(!/^\d+$/.test(env.TAG_SOURCE_INTERVAL_MS))throw new Error('Invalid tag source interval');
  intervalMs=Number(env.TAG_SOURCE_INTERVAL_MS);
 }
 const result={...(apiKey?{apiKey}:{}),...(intervalMs===undefined?{}:{intervalMs})};validateOptions(result);return result;
}
function validateOptions(options:TagHttpOptions){
 if(options.apiKey!==undefined&&!validKey(options.apiKey))throw new Error('Invalid tag API key configuration');
 const floor=options.apiKey?100:1100,interval=options.intervalMs??floor;
 if(!Number.isSafeInteger(interval)||interval<floor||interval>60000)throw new Error(`Tag source interval must be ${floor}–60000ms`);
 if(options.maxRetries!==undefined&&(!Number.isSafeInteger(options.maxRetries)||options.maxRetries<0||options.maxRetries>2))throw new Error('Tag source retries must be 0–2');
 return interval;
}
/** Retry-After is a minimum, never truncated to retry earlier than requested. */
export function retryAfterMs(value:string|null,now:number,fallback:number):number{
 let wait=fallback;
 if(value!==null){const raw=value.trim();if(/^\d+$/.test(raw))wait=Number(raw)*1000;else if(/^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(raw)&&Number.isFinite(Date.parse(raw)))wait=Math.max(0,Date.parse(raw)-now);}
 if(!Number.isFinite(wait)||wait>60000)throw new Error('Tag source HTTP 429 cooldown exceeds retry budget; checkpoint retained');
 return wait;
}
function pause(ms:number,signal:AbortSignal):Promise<void>{
 signal.throwIfAborted();
 return new Promise((resolve,reject)=>{
  const aborted=()=>{clearTimeout(timer);signal.removeEventListener('abort',aborted);reject(new Error('Tag source wait interrupted; checkpoint retained'));};
  const timer=setTimeout(()=>{signal.removeEventListener('abort',aborted);resolve();},ms);
  signal.addEventListener('abort',aborted,{once:true});
 });
}
/** One serialized client per vocabulary writer lock. The first request is paced
 * too, so consecutive jobs cannot bypass the floor by constructing new clients. */
export class TagHttpClient{
 private readonly interval:number;private nextAt:number;private tail:Promise<unknown>=Promise.resolve();
 constructor(private readonly request:typeof fetch=fetch,private readonly options:TagHttpOptions={},private readonly signal:AbortSignal=workflowShutdownSignal()){
  this.interval=validateOptions(options);this.nextAt=Date.now()+this.interval;
 }
 get(url:URL|string,timeoutMs=30000):Promise<Response>{
  const target=new URL(url);if(target.origin!==SOURCE||target.username||target.password||!target.pathname.startsWith('/api/v1/'))return Promise.reject(new Error('Invalid tag source URL'));
  const run=this.tail.then(()=>this.perform(target,timeoutMs));this.tail=run.catch(()=>{});return run;
 }
 private async perform(url:URL,timeoutMs:number):Promise<Response>{
  for(let attempt=0;attempt<=(this.options.maxRetries??2);attempt++){
   this.signal.throwIfAborted();const wait=Math.max(0,this.nextAt-Date.now());if(wait)await pause(wait,this.signal);this.signal.throwIfAborted();
   this.nextAt=Date.now()+this.interval;
   let response:Response;
   try{response=await this.request(url.toString(),{redirect:'error',signal:AbortSignal.any([AbortSignal.timeout(timeoutMs),this.signal]),headers:{Accept:'application/json','User-Agent':'YouTubeBoard/TypeScript-vocabulary-sync',...(this.options.apiKey?{'x-api-key':this.options.apiKey}:{})}});}
   catch{throw new Error('Tag source transport failed; checkpoint retained');}
   if(response.status!==429)return response;
   const retry=response.headers.get('retry-after');await response.body?.cancel().catch(()=>{});
   if(attempt===(this.options.maxRetries??2))throw new Error('Tag source HTTP 429 retry budget exhausted; checkpoint retained');
   const cooldown=retryAfterMs(retry,Date.now(),Math.max(this.interval,1000*2**attempt));
   this.nextAt=Math.max(this.nextAt,Date.now()+cooldown);
  }
  throw new Error('Tag source retry budget exhausted');
 }
}
