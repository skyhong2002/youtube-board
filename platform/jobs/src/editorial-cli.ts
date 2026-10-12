import {YoutubeDataApiClient} from '../../ingestion/src/youtube.js';
import {MysqlQuotaLedger} from '../../ingestion/src/quota.js';
import {adoptCandidate} from '../../shared/editorial/adoption.js';
import {actorFrom,uuid} from '../../shared/editorial/contracts.js';
import {connectDatabase,withWriterLock} from './database.js';
import {assertExecute,executionPolicy} from './policy.js';
export const editorialCommands={'youtube:channels:adopt':'youtube.channels.adopt'} as const;
export const editorialFields=['candidate-id','expected-version','request-id'] as const;
export function validateEditorialArguments(args:string[]){
 if(args[0]!=='youtube:channels:adopt'||args.length>7)throw new Error('Invalid editorial command');const values=new Map<string,string>();
 for(const arg of args.slice(1)){const m=/^--([a-z-]+)(?:=(.+))?$/.exec(arg);if(!m||values.has(m[1]!)||!['execute','dry-run',...editorialFields].includes(m[1]!))throw new Error('Invalid editorial argument');if(['execute','dry-run'].includes(m[1]!)?m[2]!==undefined:m[2]===undefined)throw new Error('Invalid editorial argument');values.set(m[1]!,m[2]??'');}
 if(values.has('execute')&&values.has('dry-run'))throw new Error('Conflicting modes');if(!uuid(values.get('candidate-id'))||!uuid(values.get('request-id'))||!/^\d+$/.test(values.get('expected-version')??'')||!Number.isSafeInteger(Number(values.get('expected-version')))||Number(values.get('expected-version'))<1)throw new Error('Candidate, request UUID and expected version required');
 return {job:'youtube.channels.adopt',execute:values.has('execute'),input:{candidateId:values.get('candidate-id')!,expectedVersion:Number(values.get('expected-version')),requestId:values.get('request-id')!}};
}
export async function executeEditorialWorkflow(args:string[],env:NodeJS.ProcessEnv,scheduled=false){
 if(scheduled)throw new Error('Channel adoption is operator-only');const {job,execute,input}=validateEditorialArguments(args),actor=actorFrom(env);if(execute){assertExecute(job,executionPolicy(env,'execute'));if(env.APP_ENV==='production'&&env.TS_LARAVEL_LOCK_STORE!=='stopped')throw new Error('Channel adoption requires confirmed stopped Laravel channel writers');}
 const db=await connectDatabase(env);try{
  const youtube=new YoutubeDataApiClient({keys:[env.YOUTUBE_API_KEY??''],ledger:new MysqlQuotaLedger(db,Number(env.INGESTION_YOUTUBE_DAILY_QUOTA_BUDGET??9000)),maxAttempts:2});
  const work=(assertOwnership:()=>Promise<void>)=>adoptCandidate({db,execute,actor,now:new Date(),assertOwnership,profiles:ids=>youtube.channelProfiles(ids)},input);
  if(!execute)return await work(async()=>{});
  return await withWriterLock(db,'youtube.source-and-caches',async sourceAssert=>withWriterLock(db,'editorial.registry',async editorialAssert=>work(async()=>{await sourceAssert();await editorialAssert();})));
 }finally{await db.end();}
}
export async function handleEditorialCli(args:string[],env:NodeJS.ProcessEnv){if(args[0]!=='youtube:channels:adopt')return false;console.log(JSON.stringify(await executeEditorialWorkflow(args,env),null,2));return true;}
