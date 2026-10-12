import {setPriority,constants} from 'node:os';
import {backfillAvatarDerivatives} from '../shared/media-cache/derivative-backfill.js';
import {MediaCacheError} from '../shared/media-cache/store.js';
// No dotenv, DB clients, source download or scheduler registration. Root is local.
async function main(){
 const args=process.argv.slice(2),values=new Map<string,string>();let execute=false;
 for(const arg of args){
  if(arg==='--execute'){if(execute)throw new MediaCacheError('INVALID_ARGUMENT');execute=true;continue;}
  const match=/^--(root|after-id|limit|delay-ms)=(.+)$/.exec(arg);
  if(!match||values.has(match[1]!))throw new MediaCacheError('INVALID_ARGUMENT');values.set(match[1]!,match[2]!);
 }
 const root=values.get('root')??process.env.MEDIA_CACHE_ROOT;if(!root)throw new MediaCacheError('CACHE_ROOT_REQUIRED');
 const number=(key:string,fallback:number)=>{const value=values.get(key);if(value===undefined)return fallback;if(!/^\d+$/.test(value))throw new MediaCacheError('INVALID_ARGUMENT');return Number(value);};
 setPriority(0,constants.priority.PRIORITY_LOW);
 const abort=new AbortController();process.once('SIGINT',()=>abort.abort());process.once('SIGTERM',()=>abort.abort());
 const result=await backfillAvatarDerivatives({root,execute,afterId:number('after-id',0),limit:number('limit',100),delayMs:number('delay-ms',200),signal:abort.signal});
 process.stdout.write(JSON.stringify(result)+'\n');if(result.failed||abort.signal.aborted)process.exitCode=1;
}
main().catch(error=>{process.stderr.write(JSON.stringify({error:error instanceof MediaCacheError?error.code:'AVATAR_DERIVATIVE_FAILED'})+'\n');process.exitCode=1;});
