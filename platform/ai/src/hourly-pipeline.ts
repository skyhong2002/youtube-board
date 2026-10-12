import type {Connection} from 'mysql2/promise';
import {workflowShutdownSignal} from '../../shared/shutdown.js';
import {normalizeInput,type Input} from './contracts.js';
import {planAi} from './planner.js';
import {runAi,existingAi,type RunOptions} from './runner.js';
export interface HourlyPipelineInput {from?:string;to?:string;hour?:number;period?:number;condition?:Input['condition'];userToken?:string;promptVideoLimit?:number}
export function normalizeHourlyPipeline(raw:HourlyPipelineInput,now=new Date()):Input{
 const hour=raw.hour??1,period=raw.period??1;if(!Number.isInteger(hour)||hour<0||hour>168||!Number.isInteger(period)||period<1||period>48)throw new Error('Hourly offset must be 0–168; period must be 1–48');
 if((raw.from===undefined)!==(raw.to===undefined)||raw.from!==undefined&&(raw.hour!==undefined||raw.period!==undefined))throw new Error('Choose absolute or relative hourly window');
 const base=Math.floor(now.getTime()/3600000)*3600000-hour*3600000;
 const sql=(at:number)=>new Date(at+8*3600000).toISOString().slice(0,19).replace('T',' ');
 return normalizeInput({kind:'hourly',from:raw.from??sql(base-(period-1)*3600000),to:raw.to??sql(base+3599000),...(raw.condition===undefined?{}:{condition:raw.condition}),userToken:raw.userToken,limit:raw.promptVideoLimit===0?5000:raw.promptVideoLimit});
}
export async function runHourlyPipeline(db:Connection,input:Input,options:Omit<RunOptions,'assertAuthorized'>&{assertAuthorized:(job:string)=>void;refreshSource:(execute:boolean,from:string)=>Promise<{complete:boolean;details:unknown}>}){
 input=normalizeInput({...input,kind:'hourly'});if(options.execute)options.assertAuthorized('ai.hourly');
 if(options.execute&&options.scheduledRecovery&&Date.parse(input.to.replace(' ','T')+'+08:00')>=Date.now())return {status:'blocked',reason:'window_not_closed',calls:0,sourceSkipped:true};
 if(options.missingOnly){const existing=await existingAi(db,await planAi(db,input));if(existing)return {status:'unchanged',reason:existing.legacyUnvalidated?'legacy_present_unvalidated':'existing_valid',calls:0,sourceSkipped:true,scopeUnverified:!!existing.legacyUnvalidated};}
 if(options.execute)options.assertAuthorized('youtube.channels.videos.general');
 workflowShutdownSignal().throwIfAborted();const source=await options.refreshSource(options.execute,input.from);workflowShutdownSignal().throwIfAborted();
 if(options.execute&&!source.complete)return {status:'blocked',reason:'hourly_source_window_incomplete',source:source.details,calls:0};
 const result=await runAi(db,input,{...options,sourceCapture:source.details,assertAuthorized:()=>options.assertAuthorized('ai.hourly')});
 return {...result,source:source.details,sourceComplete:source.complete,window:{from:input.from,to:input.to}};
}
