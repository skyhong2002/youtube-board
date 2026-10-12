import {workflowShutdownSignal} from '../../shared/shutdown.js';
import type {Connection} from 'mysql2/promise';
import {day,condition,token,loadDailySource} from './daily-source.js';
import {runDailyPipeline,type DailyOptions} from './pipeline.js';
import {runEvent} from './event.js';
import {runPeriod} from './period.js';
import {buildTopicCache} from './topic-cache.js';
export interface RefreshInput {from:string;to:string;condition?:string;userToken?:string;skipDaily?:boolean;skipEvents?:boolean;skipPeriod?:boolean;skipCache?:boolean;topicLimit?:number}
export function normalizeRefresh(raw:RefreshInput){day(raw.from);day(raw.to);const span=(Date.parse(raw.to)-Date.parse(raw.from))/86400000;if(span<0||span>6)throw new Error('Refresh range must be 1–7 ordered days');const topicLimit=raw.topicLimit??100;if(!Number.isSafeInteger(topicLimit)||topicLimit<1||topicLimit>200)throw new Error('Invalid topic cap');for(const flag of ['skipDaily','skipEvents','skipPeriod','skipCache'] as const)if(raw[flag]!==undefined&&typeof raw[flag]!=='boolean')throw new Error('Invalid skip flag');return {...raw,condition:condition(raw.condition),userToken:token(raw.userToken),topicLimit};}
/** Explicit finite range, shared actual-call budget, journal-backed restart; never hides a failed prerequisite. */
export async function refreshDays(db:Connection,raw:RefreshInput,options:DailyOptions){
 const input=normalizeRefresh(raw);if(!Number.isSafeInteger(options.callLimit)||options.callLimit<0||options.callLimit>100)throw new Error('AI call limit must be 0–100');
 const dependencies=['ai.days_refresh',...(!input.skipDaily?['ai.daily','ai.channel']:[]),...(!input.skipEvents?['ai.event']:[]),...(!input.skipPeriod?['ai.period']:[]),...(!input.skipCache?['reports.ai_topic.build']:[])];
 const authorize=(job:string)=>{options.assertAuthorized('ai.days_refresh');options.assertAuthorized(job);};
 if(options.execute)dependencies.forEach(authorize);
 const dates:string[]=[];for(let n=Date.parse(input.from);n<=Date.parse(input.to);n+=86400000)dates.push(new Date(n).toISOString().slice(0,10));
 let calls=0;const rows:Record<string,unknown>[]=[],reserveCall=()=>{if(calls>=options.callLimit)throw new Error('AI call budget exhausted');options.reserveCall?.();calls++;};
 const runOptions=(job:string)=>({...options,reserveCall,assertAuthorized:()=>authorize(job)});
 const source={condition:input.condition,userToken:input.userToken};
 const fail=(workflow:string,date:string,error:unknown)=>{workflowShutdownSignal().throwIfAborted();if(options.execute)dependencies.forEach(authorize);const message=error instanceof Error?error.message:'';rows.push({workflow,date,status:'failed',reason:message==='AI call budget exhausted'?'call_budget_exhausted':message.includes('locked')?'business_key_locked':message.includes('retryFailed')?'explicit_retry_required':'source_generation_or_projection_failed'});};
 const ready=new Set<string>();
 for(const date of dates){
  try{
   if(!input.skipDaily){const result=await runDailyPipeline(db,{kind:'daily',from:date+' 00:00:00',to:date+' 23:59:59',...source},{...options,callLimit:options.callLimit-calls,reserveCall,assertAuthorized:authorize});rows.push({workflow:'ai.daily',date,...result});const dayReady=result.rows.some((r)=>{const row=r as Record<string,unknown>;return row.workflow==='ai.daily'&&row.condition===input.condition&&['published','unchanged'].includes(String(row.status));});if(options.execute&&!dayReady&&result.reason!=='all_daily_rows_complete')continue;}
   // Dry run reports current-state availability; it cannot promise outputs from future completions.
   const daily=await loadDailySource(db,date,input.condition,input.userToken);if(daily.topics.length>input.topicLimit)throw new Error('topic_source_cap_exceeded');ready.add(date);
   if(!input.skipCache){try{rows.push({workflow:'reports.ai_topic.build',date,...await buildTopicCache(db,{date,...source},runOptions('reports.ai_topic.build'))});}catch(error){fail('reports.ai_topic.build',date,error);}}
   if(!input.skipEvents)for(const topic of daily.topics)for(const promptType of ['summary','people','media'] as const){try{rows.push({workflow:'ai.event',date,event:topic.title,promptType,...await runEvent(db,{date,...source,event:topic.title,promptType},runOptions('ai.event'))});}catch(error){fail('ai.event',date,error);}}
  }catch(error){fail('day',date,error);}
 }
 if(!input.skipPeriod)for(let i=1;i<dates.length;i++){const from=dates[i-1]!,to=dates[i]!;if(!ready.has(from)||!ready.has(to)){rows.push({workflow:'ai.period',date:to,status:'blocked',reason:'daily_prerequisite_failed'});continue;}try{rows.push({workflow:'ai.period',date:to,...await runPeriod(db,{from,to,...source,limit:input.topicLimit},runOptions('ai.period'))});}catch(error){fail('ai.period',to,error);}}
 const failed=rows.some(r=>['failed','blocked','partial_failure'].includes(String(r.status)));
 return {status:failed?'partial_failure':options.execute?'success':'dry-run',calls,callLimit:options.callLimit,dates,rows,previewScope:options.execute?'pinned':'existing-sources-only',resume:'Rerun the same range; successful immutable inputs reuse their journal. Uncertain calls require explicit retry-failed.'};
}
