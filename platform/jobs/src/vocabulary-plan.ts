import {createHash} from 'node:crypto';
import {validateWindow,type Window} from './vocabulary.js';
/** Offline plan only. Each page-capped run can be resumed with its exact ID/window.
 * Executors must finish/resume a batch before advancing; no queue fanout here. */
export function planVocabularyBackfill(id:string,window:Window,maxPages=20){
 if(!/^[A-Za-z0-9_-]{1,48}$/.test(id)||id.startsWith('tag-'))throw new Error('Invalid backfill plan id');
 const start=Date.parse(window.since),end=Date.parse(window.until),day=86400000;
 if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end-start>366*day)throw new Error('Backfill plan requires an ordered window of at most 366 days');
 validateWindow({since:window.since,until:new Date(start+1).toISOString()});validateWindow({since:new Date(end-1).toISOString(),until:window.until});
 if(!Number.isSafeInteger(maxPages)||maxPages<1||maxPages>20)throw new Error('Backfill batches allow 1–20 pages');
 const runs=[];
 for(let at=start;at<end;){const until=Math.min(end,(Math.floor((at+8*3600000)/day)+1)*day-8*3600000),window={since:new Date(at).toISOString(),until:new Date(until).toISOString()};
  runs.push({id:id+'-'+createHash('sha256').update(JSON.stringify(window)).digest('hex').slice(0,32),window,maxPages});at=until;
 }
 return {mode:'dry-run' as const,externalCalls:0,writes:0,betweenBatchesMs:60000,resumeIncompleteBeforeNextWindow:true,runs};
}
