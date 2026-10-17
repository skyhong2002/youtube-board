import {planAi} from './planner.js';
import {workflowShutdownSignal} from '../../shared/shutdown.js';
import type { Connection,RowDataPacket } from 'mysql2/promise';
import { CHANNEL_IDS,normalizeInput,type Input } from './contracts.js';
import { runAi,existingAi,type RunOptions } from './runner.js';
import { dailyTopicCacheStep } from './topic-cache.js';
export interface DailyOptions extends Omit<RunOptions,'assertAuthorized'> { assertAuthorized:(workflow:string)=>void; callLimit:number; channelVideoLimit?:number }
/** Channel stage must finish before daily synthesis; one budget covers actual completions. */
export async function runDailyPipeline(db:Connection,raw:Input,options:DailyOptions){
  const input=normalizeInput({...raw,kind:'daily'});
  const channelVideoLimit=options.channelVideoLimit===0?500:options.channelVideoLimit??120;if(!Number.isSafeInteger(channelVideoLimit)||channelVideoLimit<1||channelVideoLimit>500)throw new Error('Channel video limit must be 0–500');
  if(!Number.isSafeInteger(options.callLimit)||options.callLimit<0||options.callLimit>100)throw new Error('AI call limit must be 0–100');
  if(options.execute){options.assertAuthorized('ai.daily');options.assertAuthorized('ai.channel');}
  const conditions=input.condition?[input.condition]:['all','green','blue','neutral','finance','world'] as const;
  const date=input.from.slice(0,10),cacheStep=(missingOnly:boolean)=>conditions.includes('all')?dailyTopicCacheStep(db,date,input.userToken,{execute:options.execute,missingOnly,assertAuthorized:()=>options.assertAuthorized('reports.ai_topic.build')}):Promise.resolve(null);
  if(options.missingOnly){let complete=true;for(const condition of conditions)if(!await existingAi(db,await planAi(db,{...input,condition})))complete=false;if(complete){const topicCache=await cacheStep(true);return {status:options.execute?'success':'dry-run',calls:0,callLimit:options.callLimit,rows:topicCache?[topicCache]:[],reason:'all_daily_rows_complete',...(topicCache?.status==='failed'?{warnings:['topic_cache_failed']}:{})};}}
  const [eligible]=await db.query<RowDataPacket[]>(`SELECT u_id,COUNT(*) n FROM urt_video WHERE publishedAt>=? AND publishedAt<=? AND u_id IN (${CHANNEL_IDS.map(()=>'?').join(',')}) GROUP BY u_id HAVING COUNT(*)>=10 ORDER BY u_id`,[input.from,input.to,...CHANNEL_IDS]);
  let calls=0;const completedPks:string[]=[];const rows:unknown[]=[];const failures:string[]=[];
  const provider=options.provider;const reserveCall=()=>{if(calls>=options.callLimit)throw new Error('AI call budget exhausted');options.reserveCall?.();calls++;};
  class AuthorizationError extends Error{}
  const authorize=(workflow:string)=>{try{options.assertAuthorized(workflow);}catch{throw new AuthorizationError('AI authorization denied');}};
  const failure=(error:unknown)=>{workflowShutdownSignal().throwIfAborted();if(error instanceof AuthorizationError)throw error;const message=error instanceof Error?error.message:'';if(message.includes('budget exhausted'))return 'call_budget_exhausted';if(message.includes('retryFailed'))return 'explicit_retry_required';if(message.includes('source changed'))return 'source_changed';if(message.includes('locked'))return 'business_key_locked';return 'generation_or_projection_failed';};
  for(const channel of eligible){
    workflowShutdownSignal().throwIfAborted();
    const channelInput:Input={kind:'channel',channelId:Number(channel.u_id),from:input.from,to:input.to,dataType:input.dataType,userToken:input.userToken,limit:channelVideoLimit};
    try{const result=await runAi(db,channelInput,{...options,missingOnly:false,provider,reserveCall,assertAuthorized:()=>authorize('ai.channel')});rows.push({workflow:'ai.channel',channelId:Number(channel.u_id),...result});if('targetPk'in result&&result.targetPk)completedPks.push(String(result.targetPk));if('status'in result&&result.status==='blocked')failures.push('channel_blocked');}catch(error){const reason=failure(error);failures.push(reason);rows.push({workflow:'ai.channel',channelId:Number(channel.u_id),status:'failed',reason});}
  }
  for(const condition of conditions){workflowShutdownSignal().throwIfAborted();try{const result=await runAi(db,{...input,condition,...(options.execute?{sourceChannelAiPks:completedPks}:{})},{...options,provider,reserveCall,assertAuthorized:()=>authorize('ai.daily')});const insufficient='status'in result&&result.status==='blocked'&&['insufficient_source_for_contract','no_source_events','no_source_videos'].includes(String(result.reason));rows.push({workflow:'ai.daily',condition,...result,...(insufficient?{status:'skipped_insufficient_evidence'}:{})});if('status'in result&&result.status==='blocked'&&!insufficient)failures.push('daily_blocked');}catch(error){const reason=failure(error);failures.push(reason);rows.push({workflow:'ai.daily',condition,status:'failed',reason});}}
  const allRow=rows.find(r=>(r as Record<string,unknown>).workflow==='ai.daily'&&(r as Record<string,unknown>).condition==='all') as Record<string,unknown>|undefined;
  // The cache derives from the all-condition daily row; skip it when that row did not come out.
  const topicCache=conditions.includes('all')?(['published','unchanged'].includes(String(allRow?.status))||!options.execute?await cacheStep(!!options.missingOnly):{workflow:'reports.ai_topic.build',date,condition:'all',status:'skipped',reason:'daily_all_not_published'}):null;
  if(topicCache)rows.push(topicCache);
  return {status:options.execute?(failures.length?'partial_failure':'success'):'dry-run',...(topicCache?.status==='failed'?{warnings:['topic_cache_failed']}:{}),calls,callLimit:options.callLimit,rows,dailyPreviewUsesExistingChannelRows:!options.execute,previewScope:options.execute?'pinned':'unpinned'};
}
