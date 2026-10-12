import {NotificationProvider,TelegramClient,config,runNotification,notificationReadiness,resolveNotification,validateResolution,type Resolution,type Period} from '@youtube-board/notifications';
import {workflowShutdownSignal} from '../../shared/shutdown.js';
import {assertExecute,executionPolicy} from './policy.js';
import {connectDatabase,withWriterLock} from './database.js';
export const notificationCommands={'notify:telegram:daily':'notify.telegram.daily','notify:telegram:hourly':'notify.telegram.hourly'} as const;
export const notificationFields:Record<string,{values:string[];flags:string[]}>={'notify.telegram.daily':{values:[],flags:['force','no-ai']},'notify.telegram.hourly':{values:[],flags:['force','no-ai']}};
export function validateNotificationArguments(args:string[]){
 if(!Array.isArray(args)||args.length>8||args.some(v=>typeof v!=='string'||v.length>128))throw new Error('Invalid notification arguments');
 const command=args[0],alias=command&&Object.hasOwn(notificationCommands,command)?command as keyof typeof notificationCommands:null;
 if(command!=='notify:telegram:digest'&&!alias)throw new Error('Unknown notification workflow');
 const values=new Map<string,string>();
 for(const arg of args.slice(1)){
  const m=/^--(execute|dry-run|force|no-ai|period)(?:=(.*))?$/.exec(arg);
  if(!m||values.has(m[1]!))throw new Error('Malformed or duplicate notification option');
  if(m[1]==='period' ? !m[2]||!!alias : m[2]!==undefined)throw new Error('Malformed notification option');
  values.set(m[1]!,m[2]??'');
 }
 if(values.has('execute')&&values.has('dry-run'))throw new Error('Conflicting notification modes');
 const period=alias?alias.endsWith(':daily')?'daily':'hourly':values.get('period')??'daily';if(period!=='daily'&&period!=='hourly')throw new Error('Invalid notification period');
 return {period:period as Period,job:'notify.telegram.'+period,execute:values.has('execute'),force:values.has('force'),noAi:values.has('no-ai')};
}
export function assertNotificationEnabled(env:NodeJS.ProcessEnv,force=false,scheduled=false){
 if(env.TS_NOTIFICATION_ENABLED!=='true'||env.TELEGRAM_DIGEST_ENABLED!=='true')throw new Error('Notifications are disabled');
 if(force&&(scheduled||env.TS_NOTIFICATION_FORCE_ENABLED!=='true'))throw new Error('Notification force requires a separate manual gate');
 if(env.APP_ENV==='production'&&(env.TS_NOTIFICATION_LARAVEL_STOPPED!=='true'||env.TS_NOTIFICATION_HISTORY_VERIFIED!=='true'||env.TS_NOTIFICATION_LEGACY_DEDUP_STORE!=='database'||env.TS_LARAVEL_CACHE_PREFIX===undefined))throw new Error('Notification handoff requires stopped Laravel notifications, verified history and explicit cache prefix');
}
export function validateNotificationMaintenance(args:string[]){
 if(args[0]==='notify:telegram:readiness'){if(args.length!==1)throw new Error('Readiness accepts no options');return {kind:'readiness' as const,execute:false};}
 if(args[0]!=='notify:telegram:resolve'||args.length>9)throw new Error('Unknown notification maintenance command');
 const allowed=new Set(['dispatch-key','outcome','operator','evidence','sent-at','execute','dry-run']),values=new Map<string,string>();
 for(const arg of args.slice(1)){const m=/^--([a-z-]+)(?:=(.*))?$/.exec(arg);if(!m||!allowed.has(m[1]!)||values.has(m[1]!)||(['execute','dry-run'].includes(m[1]!)?m[2]!==undefined:!m[2]))throw new Error('Invalid notification maintenance options');values.set(m[1]!,m[2]??'');}
 if(values.has('execute')&&values.has('dry-run'))throw new Error('Conflicting notification modes');
 const input=validateResolution({dispatchKey:values.get('dispatch-key')??'',outcome:values.get('outcome') as Resolution['outcome'],operator:values.get('operator')??'',evidence:values.get('evidence')??'',...(values.has('sent-at')?{sentAt:values.get('sent-at')}:{})});
 return {kind:'resolve' as const,input,execute:values.has('execute')};
}
async function executeMaintenance(args:string[],env:NodeJS.ProcessEnv,scheduled:boolean){
 const v=validateNotificationMaintenance(args);if(scheduled)throw new Error('Notification maintenance is manual-only');
 const authorize=()=>{assertExecute('notify.telegram.reconcile',executionPolicy(env,'execute'));if(env.TS_NOTIFICATION_RECONCILE_ENABLED!=='true')throw new Error('Notification reconciliation gate is disabled');if(env.APP_ENV==='production'&&(env.TS_NOTIFICATION_LARAVEL_STOPPED!=='true'||env.TS_NOTIFICATION_HISTORY_VERIFIED!=='true'||env.TS_NOTIFICATION_LEGACY_DEDUP_STORE!=='database'||env.TS_LARAVEL_CACHE_PREFIX===undefined))throw new Error('Reconciliation requires verified stopped Laravel notification handoff and explicit database cache prefix');workflowShutdownSignal().throwIfAborted();};if(v.execute)authorize();
 const db=await connectDatabase(env);try{await db.query("SET time_zone = '+00:00'");if(v.kind==='readiness')return await notificationReadiness(db);const work=(assert:()=>Promise<void>)=>resolveNotification(db,v.input,{config:config(env),execute:v.execute,assertAuthorized:authorize,assertOwnership:assert});return v.execute?await withWriterLock(db,'telegram.notifications',work):await work(async()=>{});}finally{await db.end();}
}
export async function executeNotificationWorkflow(args:string[],env:NodeJS.ProcessEnv,scheduled=false){
 if(['notify:telegram:readiness','notify:telegram:resolve'].includes(args[0]??''))return executeMaintenance(args,env,scheduled);
 const input=validateNotificationArguments(args),cfg=config(env),authorize=()=>{assertExecute(input.job,executionPolicy(env,'execute',scheduled));assertNotificationEnabled(env,input.force,scheduled);workflowShutdownSignal().throwIfAborted();};if(input.execute)authorize();
 const sender=input.execute?new TelegramClient(env):undefined;
 const provider=input.execute&&!input.noAi&&(env.TELEGRAM_OPENAI_API_KEY??env.OPENAI_API_KEY)?new NotificationProvider(env):undefined;
 const db=await connectDatabase(env);try{await db.query("SET time_zone = '+00:00'");const work=async(lock:()=>Promise<void>)=>runNotification(db,input.period,{execute:input.execute,scheduled,force:input.force,config:cfg,provider,sender,assertAuthorized:authorize,assertOwnership:lock});return input.execute?await withWriterLock(db,'telegram.notifications',work):await work(async()=>{});}finally{await db.end();}
}
export async function handleNotificationCli(args:string[],env:NodeJS.ProcessEnv){if(!['notify:telegram:digest','notify:telegram:readiness','notify:telegram:resolve'].includes(args[0]??'')&&!Object.hasOwn(notificationCommands,args[0]??''))return false;const result=await executeNotificationWorkflow(args,env);console.log(JSON.stringify(result));if(['failed','uncertain','incomplete','blocked'].includes(result.status))process.exitCode=2;return true;}
