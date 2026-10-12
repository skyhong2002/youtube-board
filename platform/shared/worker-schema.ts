import manifest from './worker-permissions.json' with {type:'json'};
import type {TableMapping} from './physical-tables.js';
export interface WorkerProfile {tables:Record<string,string[]>;dependencies:string[]}
const profiles:Record<string,WorkerProfile>=manifest.profiles;
export function workerProfile(name:string):WorkerProfile{
 const visit=(key:string,seen:Set<string>):WorkerProfile=>{if(seen.has(key)||!Object.hasOwn(profiles,key))throw new Error('Unknown or cyclic worker workflow');const next=new Set(seen).add(key),profile=profiles[key]!,tables:Record<string,string[]>={};
 for(const dependency of profile.dependencies)for(const[t,rights]of Object.entries(visit(dependency,next).tables))tables[t]=[...new Set([...(tables[t]??[]),...rights])].sort();
 for(const[t,rights]of Object.entries(profile.tables)){if(!/^(?:urt_|ts_|ingestion_youtube_|telegram_digest_|cache$|cache_locks$|tags$|tag_group$)/.test(t)||/^ts_(?:auth_|reader_)/.test(t)||rights.some(r=>!['SELECT','INSERT','UPDATE','DELETE'].includes(r)))throw new Error('Invalid worker permission manifest');tables[t]=[...new Set([...(tables[t]??[]),...rights])].sort();}
 return {tables,dependencies:profile.dependencies};};return visit(name,new Set());
}
export function workerSchema(env:NodeJS.ProcessEnv){
 if(!env.TS_WORKER_SCHEMA_MODE)return null;if(env.TS_WORKER_SCHEMA_MODE!=='facade')throw new Error('Unknown worker schema mode');
 const facade=env.DB_DATABASE??'',source=env.TS_SOURCE_SCHEMA??'youtube_board',state=env.TS_STATE_SCHEMA??'youtube_board_ts',workflow=env.TS_WORKER_WORKFLOW??'';
 if(!/^youtube_board_ts_worker(?:_[a-z0-9_]+)?$/.test(facade)||!/^youtube_board_ts(?:_[a-z0-9_]+)?$/.test(state)||!/^[a-z][a-z0-9_]{0,63}$/.test(source)||new Set([facade,source,state]).size!==3||['mysql','information_schema','performance_schema','sys'].includes(source))throw new Error('Invalid worker schema boundary');
 const profile=workerProfile(workflow),tables={...profile.tables};
 if(env.TS_LARAVEL_LOCK_STORE==='database')tables.cache_locks=['SELECT','INSERT','UPDATE','DELETE'];
 const mapping:TableMapping=Object.fromEntries(Object.keys(tables).map(t=>[t,{schema:t.startsWith('ts_')?state:source,table:t}]));
 return {facade,source,state,workflow,tables,mapping,dependencies:profile.dependencies};
}

export const workerTableNames=Object.freeze([...new Set(Object.values(profiles).flatMap(p=>Object.keys(p.tables)).concat('cache_locks'))]);

/** A production DB endpoint pin is distinct from the DB account's allowed origin. */
export function assertWorkerEndpoint(env:NodeJS.ProcessEnv,host:string){
 if(env.APP_ENV!=='production')return;
 const expected=env.TS_WORKER_DATABASE_HOST;
 if(!expected||!env.DB_HOST||!/^[A-Za-z0-9_.:-]{1,255}$/.test(expected)||host!==expected)throw new Error('Production worker requires an explicit matching database host pin');
}
