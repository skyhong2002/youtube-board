import { derivedCommands,validateDerivedArguments,executeDerivedWorkflow } from './ai-derived-cli.js';
import { GatewayProvider,runAi,runDailyPipeline,normalizeInput,type Input } from '@youtube-board/ai';
import { connectDatabase } from './database.js';
import { assertExecute,executionPolicy } from './policy.js';
export async function executeAi(input:Input,env:NodeJS.ProcessEnv,execute=false,retryFailed=false,callLimit=45,scheduled=false,missingOnly=false,channelVideoLimit=120){
  input=normalizeInput(input);
  if(scheduled&&['hourly','daily'].includes(input.kind))throw new Error('Scheduled daily/hourly AI requires a source-first pipeline; direct execution is manual-only');
  const authorize=()=>assertExecute(`ai.${input.kind}`,executionPolicy(env,'execute',scheduled));
  if(execute)authorize();
  const provider=execute?{complete:(plan:Parameters<GatewayProvider['complete']>[0])=>new GatewayProvider(env).complete(plan)}:{complete:async()=>{throw new Error('Preview must not invoke provider');}};
  const db=await connectDatabase(env);
  try{const options={execute,retryFailed,scheduledRecovery:scheduled,missingOnly,channelVideoLimit,provider,modelAlias:env.OPENAI_MODEL??'sky-quality'};return input.kind==='daily'?await runDailyPipeline(db,input,{...options,callLimit,assertAuthorized:(workflow)=>assertExecute(workflow,executionPolicy(env,'execute',scheduled))}):await runAi(db,input,{...options,assertAuthorized:authorize});}finally{await db.end();}
}
export function validateAiArguments(args:string[]){
  if(Object.hasOwn(derivedCommands,args[0]??''))return validateDerivedArguments(args).input;
  if(!['ai:channel','ai:daily','ai:hourly'].includes(args[0]??''))throw new Error('Unregistered AI workflow');
  const allowed=new Set(['from','to','condition','channel-id','limit','user-token','type','call-limit','channel-video-limit']),seen=new Set<string>();
  for(const arg of args.slice(1)){const match=/^--([a-z-]+)(?:=(.*))?$/s.exec(arg);if(!match)throw new Error('Invalid AI argument');const key=match[1]!;if(seen.has(key))throw new Error('Duplicate AI argument');seen.add(key);if(['execute','retry-failed','missing-only'].includes(key)){if(match[2]!==undefined)throw new Error('AI flags do not accept values');}else{if(!allowed.has(key)||match[2]===undefined||match[2]==='')throw new Error('Unsupported or empty AI option');if(['channel-id','limit','call-limit','channel-video-limit'].includes(key)&&!/^\d+$/.test(match[2]))throw new Error('AI numeric options require decimal integers');}}
  const value=(key:string)=>args.find(v=>v.startsWith(`--${key}=`))?.slice(key.length+3);
  const channelVideoLimit=Number(value('channel-video-limit')??120);if(!Number.isSafeInteger(channelVideoLimit)||channelVideoLimit<0||channelVideoLimit>500)throw new Error('Channel video limit must be 0–500');
  if(args[0]!=='ai:daily'&&value('channel-video-limit')!==undefined)throw new Error('--channel-video-limit only applies to ai:daily');
  if(args[0]!=='ai:daily'&&value('call-limit')!==undefined)throw new Error('--call-limit only applies to ai:daily');
  const input:Input={kind:args[0]!.slice(3) as Input['kind'],from:value('from')??'',to:value('to')??'',...(value('condition')?{condition:value('condition') as Input['condition']}:{}),...(value('channel-id')?{channelId:Number(value('channel-id'))}:{}),...(value('limit')?{limit:Number(value('limit'))}:{}),...(value('user-token')?{userToken:value('user-token')}:{}),...(value('type')?{dataType:value('type') as Input['dataType']}: {})};
  const callLimit=Number(value('call-limit')??45);if(!Number.isSafeInteger(callLimit)||callLimit<0||callLimit>100)throw new Error('AI call limit must be 0–100');
  if(input.kind!=='channel'&&input.channelId!==undefined)throw new Error('--channel-id only applies to ai:channel');
  return normalizeInput(input);
}

export async function executeAiWorkflow(args:string[],env:NodeJS.ProcessEnv,scheduled=false){
  if(Object.hasOwn(derivedCommands,args[0]??''))return executeDerivedWorkflow(args,env,scheduled);
  const input=validateAiArguments(args) as Input,callLimit=Number(args.find(v=>v.startsWith('--call-limit='))?.slice(13)??45);
  return executeAi(input,env,args.includes('--execute'),args.includes('--retry-failed'),callLimit,scheduled,args.includes('--missing-only'),Number(args.find(v=>v.startsWith('--channel-video-limit='))?.slice(22)??120));
}

export async function handleAiCli(args:string[],env:NodeJS.ProcessEnv){
  if(!['ai:channel','ai:daily','ai:hourly',...Object.keys(derivedCommands)].includes(args[0]??''))return false;
  const result=await executeAiWorkflow(args,env);console.log(JSON.stringify(result));if(args.includes('--execute')&&'status'in result&&['blocked','partial_failure'].includes(String(result.status)))process.exitCode=1;return true;
}
