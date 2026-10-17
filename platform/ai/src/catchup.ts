import {CHANNEL_IDS,normalizeInput,type Condition} from './contracts.js';
import type {Connection,RowDataPacket} from 'mysql2/promise';
import {workflowShutdownSignal} from '../../shared/shutdown.js';
import {day,token} from './daily-source.js';
import {existingAi} from './runner.js';
import {planAi} from './planner.js';
import {runDailyPipeline,type DailyOptions} from './pipeline.js';
import {dailyTopicCacheStep} from './topic-cache.js';
export interface CatchupInput {date:string;userToken?:string;condition?:Condition;limit?:number}
export function normalizeCatchup(input:CatchupInput,now=new Date()){const resolved=['today','yesterday'].includes(input.date)?new Date(now.getTime()+8*3600000-(input.date==='yesterday'?86400000:0)).toISOString().slice(0,10):day(input.date);const daily=normalizeInput({kind:'daily',from:resolved+' 00:00:00',to:resolved+' 23:59:59',condition:input.condition,userToken:token(input.userToken),limit:input.limit});return {date:resolved,userToken:daily.userToken,condition:daily.condition,limit:daily.limit};}
export async function runCatchup(db:Connection,raw:CatchupInput,options:DailyOptions&{workflow?:'ai.daily'|'ai.daily.catchup';refreshSource:(execute:boolean)=>Promise<{complete:boolean;completedChannelIds?:number[];details:unknown}>}){
 const input=normalizeCatchup(raw),workflow=options.workflow??'ai.daily.catchup',missingOnly=workflow==='ai.daily.catchup'||options.missingOnly===true;if(options.execute)options.assertAuthorized(workflow);workflowShutdownSignal().throwIfAborted();
 const daily={kind:'daily' as const,from:input.date+' 00:00:00',to:input.date+' 23:59:59',userToken:input.userToken,condition:input.condition,limit:input.limit};
 if(options.execute&&options.scheduledRecovery&&Date.parse(daily.to.replace(' ','T')+'+08:00')>=Date.now())return {status:'blocked',reason:'window_not_closed',calls:0,sourceSkipped:true};
 let complete=missingOnly;for(const condition of input.condition?[input.condition]:['all','green','blue','neutral','finance','world'] as const)if(!await existingAi(db,await planAi(db,{...daily,condition})))complete=false;
 // Complete daily rows can still lack the derived topic cache; fill only a missing one.
 if(complete){const topicCache=input.condition&&input.condition!=='all'?null:await dailyTopicCacheStep(db,input.date,input.userToken,{execute:options.execute,missingOnly:true,assertAuthorized:()=>{options.assertAuthorized(workflow);options.assertAuthorized('reports.ai_topic.build');}});return {status:'success',reason:'all_daily_rows_complete',calls:0,sourceSkipped:true,...(topicCache?{rows:[topicCache],...(topicCache.status==='failed'?{warnings:['topic_cache_failed']}:{})}:{})};}
 if(options.execute)for(const job of ['youtube.tag_videos.backfill','ai.daily','ai.channel'])options.assertAuthorized(job);
 const [scope]=await db.query<RowDataPacket[]>(`SELECT c.u_id,n.tags FROM urt_channel c JOIN urt_count n ON n.u_id=c.u_id WHERE (c.flag_del IS NULL OR c.flag_del<1) AND c.u_id IN (${CHANNEL_IDS.map(()=>'?').join(',')})`,CHANNEL_IDS);
 const missingScope=CHANNEL_IDS.filter(id=>{const rows=scope.filter(r=>Number(r.u_id)===id);return rows.length!==1||!String(rows[0]?.tags??'').includes('[102]');});
 if(missingScope.length)return {status:'blocked',reason:'required_channel_not_in_crawl_scope',missingRequiredChannelIds:missingScope,calls:0,sourceSkipped:true};
 const source=await options.refreshSource(options.execute);workflowShutdownSignal().throwIfAborted();
 const completed=new Set(source.completedChannelIds??[]),missing=CHANNEL_IDS.filter(id=>!completed.has(id));
 if(options.execute&&(!source.complete||missing.length))return {status:'blocked',reason:'source_refresh_incomplete',source:source.details,missingRequiredChannelIds:missing,calls:0};
 const authorize=(job:string)=>{options.assertAuthorized(workflow);options.assertAuthorized(job);};
 const result=await runDailyPipeline(db,daily,{...options,sourceCapture:source.details,missingOnly,assertAuthorized:authorize});
 return {...result,source:source.details,sourceComplete:source.complete};
}
