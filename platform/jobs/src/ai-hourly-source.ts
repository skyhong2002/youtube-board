import {CHANNEL_IDS} from '@youtube-board/ai';
import {workflowShutdownSignal} from '../../shared/shutdown.js';
import {executeYoutubeWorkflow} from './youtube-cli.js';
export interface HourlySourceOptions {maxResults:number;maxPages:number;maxApiAttempts:number}
/** The scheduled youtube.channels.videos.general run (every 5 minutes, youtube-source batch) holds the same writer lock
 * when ai.hourly starts at :10 (2026-10-18: every scheduled hour blocked on it). GET_LOCK fails before any API call or
 * write, so waiting and retrying cannot spend quota or write twice. */
const WRITER_BUSY='Another TypeScript writer holds this workflow',LOCK_RETRIES=12,LOCK_PAUSE_MS=10_000;
/** Legacy window proof: exhausted playlist, or oldest returned publication reaches window start.
 * This is bounded uploads-window coverage, not a complete archive export.
 */
export async function refreshHourlySource(from:string,execute:boolean,env:NodeJS.ProcessEnv,scheduled:boolean,caps:HourlySourceOptions,dispatch:(args:string[],env:NodeJS.ProcessEnv,scheduled:boolean)=>Promise<unknown>=executeYoutubeWorkflow,pause:(ms:number)=>Promise<void>=ms=>new Promise(resolve=>setTimeout(resolve,ms))){
 const rows:Record<string,unknown>[]=[];let attempts=0;
 for(const uId of CHANNEL_IDS){
  workflowShutdownSignal().throwIfAborted();const remaining=caps.maxApiAttempts-attempts;
  if(execute&&remaining<1){rows.push({uId,complete:false,reason:'source_request_budget_exhausted'});continue;}
  try{
   let result:unknown;
   for(let wait=0;;wait++){
    try{result=await dispatch(['youtube:channels:videos',`--u_id=${uId}`,'--limit=1',`--until=${from.replace(' ','T')}+08:00`,`--max-results=${caps.maxResults}`,`--max-pages=${caps.maxPages}`,`--max-api-attempts=${Math.max(1,remaining)}`,...(execute?['--execute']:[])],env,scheduled);break;}
    catch(error){if(!execute||!(error instanceof Error)||error.message!==WRITER_BUSY||wait>=LOCK_RETRIES)throw error;workflowShutdownSignal().throwIfAborted();await pause(LOCK_PAUSE_MS);}
   }
   const record=result as Record<string,unknown>;attempts+=Number(record.apiAttempts??0);const applied=Array.isArray(record.applied)?record.applied as Record<string,unknown>[]:[];const row=applied.find(r=>Number(r.uId)===uId);const oldest=typeof row?.oldestPublishedAt==='string'?Date.parse(row.oldestPublishedAt):NaN;
   const complete=execute&&Array.isArray(record.skipped)&&record.skipped.length===0&&!record.stoppedReason&&Number(record.selected)===1&&!!row&&(row.pageExhausted===true||Number.isFinite(oldest)&&oldest<=Date.parse(from.replace(' ','T')+'+08:00'));
   rows.push({uId,complete,executionKey:typeof record.executionKey==='string'?record.executionKey:null,apiItems:row?.apiItems??0,pages:row?.pages??0,oldestPublishedAt:row?.oldestPublishedAt??null,reason:complete?null:execute?'source_window_incomplete':'preview'});
  }catch{workflowShutdownSignal().throwIfAborted();if(execute)attempts=caps.maxApiAttempts;rows.push({uId,complete:false,reason:'source_refresh_failed'});}
 }
 return {complete:execute&&rows.every(r=>r.complete===true),details:{configuredChannels:CHANNEL_IDS.length,completedChannels:rows.filter(r=>r.complete).length,apiAttempts:attempts,from,coverage:'bounded-uploads-window',rows}};
}
