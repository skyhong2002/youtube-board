import { randomUUID } from 'node:crypto';
import { selectPhotoTerms, photosCacheJob, predictionsCacheJob, cloudCacheJob, countsCacheJob, keywordsCacheJob, keywordRelationCacheJob, liveCacheCleanJob, liveCleanupJob, liveDisplayCacheJob, liveTagDateCacheJob, scheduleCacheJob, tagDateCacheJob, tagMonthCacheJob, taipeiSql, validateCacheInput, type CacheInput, type TagDictionary } from '@youtube-board/ingestion';
import { assertExecute, executionPolicy } from './policy.js';
import { connectDatabase, withWriterLock } from './database.js';
import { loadVocabularySnapshot } from './load-vocabulary.js';
import { matchVocabulary } from './match.js';
export const cacheCommands = {
 'reports:photos:build':'reports.photos.build','reports:channel-predictions:build':'reports.channel_predictions.build',
 'reports:counts:build':'reports.counts.build', 'reports:schedule:build':'reports.schedule.build', 'youtube:live:cleanup':'youtube.live.cleanup', 'reports:live:build':'reports.live.build', 'reports:live:clean':'reports.live.clean',
 'reports:tag-date:build':'reports.tag_date.build', 'reports:people:build':'reports.people.build', 'reports:channel-cloud:build':'reports.channel_cloud.build', 'reports:tag-cloud:build':'reports.tag_cloud.build', 'reports:keyword-cloud:build':'reports.keyword_cloud.build', 'reports:keyword-relations:build':'reports.keyword_relations.build', 'reports:tag-month:build':'reports.tag_month.build', 'reports:keywords:cache':'reports.keywords.cache', 'reports:live-tag-date:build':'reports.live_tag_date.build',
} as const;
const base=['tagid','or','not','channel-limit','video-limit','vocabulary-version'];
export const cacheFields: Record<string,{values:string[];flags:string[]}> = Object.fromEntries(Object.values(cacheCommands).map(job=>[job,{flags:job==='reports.photos.build'?['refresh']:[],values: job==='reports.photos.build'?['terms','limit','vocabulary-version']:job==='reports.channel_predictions.build'?['u_id','limit','after-id']:job==='reports.counts.build'?['u_id','limit']:job==='reports.schedule.build'?['videoId','limit']:job==='youtube.live.cleanup'||job==='reports.live.clean'?['limit']:job==='reports.live.build'?['hours','limit']:job==='reports.channel_cloud.build'?['u_id','days','channel-limit','video-limit','vocabulary-version']:job==='reports.keyword_relations.build'?['subject','from','to','days','channel-limit','video-limit','vocabulary-version']:job==='reports.tag_month.build'?[...base,'subject','month']:job==='reports.keyword_cloud.build'?[...base,'subject','days']:job==='reports.tag_cloud.build'||job==='reports.keywords.cache'?[...base,'days']:[...base,'from','to','days']} ]));
/** Validates queue and CLI inputs before connection, with the same bounds as the direct builders. */
export function validateCacheArguments(args:string[],now=new Date()) {
 if(!Array.isArray(args)||args.length>24||args.some(a=>typeof a!=='string'||a.length>512)||!args[0]||!Object.hasOwn(cacheCommands,args[0]))throw new Error('Unknown cache workflow');
 const command=args[0] as keyof typeof cacheCommands,job=cacheCommands[command],schema=cacheFields[job]!,options=new Map<string,string>();
 for(const arg of args.slice(1)){const m=/^--([a-zA-Z_-]+)(?:=(.*))?$/.exec(arg);if(!m||options.has(m[1]!)||!['execute','dry-run',...schema.values,...schema.flags].includes(m[1]!)||(['execute','dry-run',...schema.flags].includes(m[1]!)?m[2]!==undefined:!m[2]))throw new Error('Unknown, duplicate or malformed cache argument');options.set(m[1]!,m[2]??'');}
 if(options.has('execute')&&options.has('dry-run'))throw new Error('Conflicting cache modes');
 const maxima:Record<string,number>={'after-id':2147483647,limit:['reports.counts.build','reports.photos.build','reports.channel_predictions.build'].includes(job)?100:job==='reports.live.build'?500:200,u_id:2147483647,days:366,hours:720,'channel-limit':5000,'video-limit':100000};
 for(const [key,value]of options){if(key in maxima&&(!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value))||Number(value)<(key==='after-id'?0:1)||Number(value)>maxima[key]!))throw new Error('Invalid cache numeric bound');if(['tagid','or','not'].includes(key)&&(!/^\d+(,\d+)*$/.test(value)||value.split(',').length>20))throw new Error('Invalid taxonomy selection');if(key==='videoId'&&!/^[A-Za-z0-9_-]{1,32}$/.test(value))throw new Error('Invalid video identity');if(key==='vocabulary-version'&&!/^[A-Za-z0-9_-]{1,100}$/.test(value))throw new Error('Invalid vocabulary version');}
 const number=(key:string,otherwise:number)=>Number(options.get(key)??otherwise), list=(key:string)=>[...new Set(options.get(key)?.split(',').map(Number)??[])].sort((a,b)=>a-b);
 const to=options.get('to')??taipeiSql(now).slice(0,10),days=number('days',job==='reports.people.build'?37:job==='reports.keywords.cache'?7:1),from=options.get('from')??new Date(Date.parse(to)-(days-1)*86400000).toISOString().slice(0,10);
 const input:CacheInput={tagIds:list('tagid'),orTagIds:list('or'),notTagIds:list('not'),from,to,days,channelLimit:number('channel-limit',5000),videoLimit:number('video-limit',20000),...(options.has('u_id')?{uId:number('u_id',1)}:{}),...(options.has('subject')?{subject:options.get('subject')!}:{})};
 if(options.has('terms')&&(options.get('terms')!.split(',').some(t=>!t||[...t].length>32||/[\uD800-\uDFFF]/u.test(t))||options.get('terms')!.split(',').length>number('limit',20)))throw new Error('Invalid explicit photo terms');
 if(job==='reports.people.build'&&!options.has('tagid')&&!options.has('or'))input.tagIds=[13];
 if(job==='reports.keywords.cache'&&input.days!==7)throw new Error('tags_all uses a fixed seven-day window');
 if(job==='reports.keywords.cache'&&!options.has('or'))input.orTagIds=[1,2,13,14];
 if(job==='reports.tag_month.build'){
   const month=options.get('month');if(!month||!/^\d{4}-\d{2}$/.test(month)||Number(month.slice(-2))<1||Number(month.slice(-2))>12)throw new Error('Explicit YYYY-MM month required');
   input.from=month+'-01';input.to=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(-2)),0)).toISOString().slice(0,10);if(input.to>=to)throw new Error('Month cache requires a closed month');
 }
 validateCacheInput(input);if(input.to>taipeiSql(now).slice(0,10))throw new Error('Future cache dates are forbidden');
 if(['reports.keyword_cloud.build','reports.keyword_relations.build','reports.tag_month.build'].includes(job)&&!input.subject)throw new Error('Explicit subject required');
 if(job==='reports.keyword_relations.build'&&(input.tagIds.length||input.orTagIds!.length||input.notTagIds!.length))throw new Error('Relations cache has global coverage');
 return {command,job,options,input,execute:options.has('execute'),number};
}
export async function executeCacheWorkflow(args:string[],env:NodeJS.ProcessEnv,scheduled=false) {
 const now=new Date(),v=validateCacheArguments(args,now),{job,execute,input,options}=v;
 const policy=executionPolicy(env,execute?'execute':'dry-run',scheduled);if(execute)assertExecute(job,policy);
 const db=await connectDatabase(env);
 try {
  const work=async(assertOwnership:()=>Promise<void>)=>{
   const ctx={db,now,execute,assertOwnership};
   if(job==='reports.channel_predictions.build')return predictionsCacheJob(ctx,{...(input.uId?{uId:input.uId}:{}),limit:v.number('limit',20),...(options.has('after-id')?{afterId:v.number('after-id',0)}:{})});
   if(job==='reports.photos.build'){let terms=options.get('terms')?.split(',');if(!terms){const snapshot=await loadVocabularySnapshot(db,options.get('vocabulary-version'));terms=await selectPhotoTerms(ctx,snapshot.terms.map(t=>t.term),v.number('limit',20),options.has('refresh'));}return photosCacheJob(ctx,{terms,limit:v.number('limit',20),refresh:options.has('refresh')});}
   if(job==='reports.counts.build')return countsCacheJob(ctx,{...(input.uId?{uId:input.uId}:{}),limit:v.number('limit',20)});
   if(job==='reports.schedule.build')return scheduleCacheJob(ctx,{...(options.has('videoId')?{videoId:options.get('videoId')!}:{}),limit:v.number('limit',20)});
   if(job==='youtube.live.cleanup')return liveCleanupJob(ctx,v.number('limit',20));
   if(job==='reports.live.clean')return liveCacheCleanJob(ctx,v.number('limit',20));
   if(job==='reports.live.build')return liveDisplayCacheJob(ctx,{hours:v.number('hours',2),limit:v.number('limit',20)});
   const snapshot=await loadVocabularySnapshot(db,options.get('vocabulary-version'));
   const dictionary:TagDictionary={version:snapshot.id,coverage:snapshot.coverage,rule:'youtube-tag-exact-v1-title2-length',match:(title,description)=>matchVocabulary({title,description},snapshot)};
   if(job==='reports.tag_date.build'||job==='reports.people.build')return tagDateCacheJob(ctx,input,dictionary);
   if(job==='reports.live_tag_date.build')return liveTagDateCacheJob(ctx,input,dictionary);
   if(job==='reports.tag_month.build')return tagMonthCacheJob(ctx,input,dictionary);
   if(job==='reports.keyword_relations.build')return keywordRelationCacheJob(ctx,input,dictionary);
   if(job==='reports.keywords.cache')return keywordsCacheJob(ctx,input,dictionary);
   return cloudCacheJob(ctx,input,dictionary,job==='reports.channel_cloud.build'?'channel':job==='reports.keyword_cloud.build'?'keyword':'tag');
  };
  if(!execute)return await work(async()=>{});
  return await withWriterLock(db,job==='reports.photos.build'?'reports.photos.build':'youtube.source-and-caches',async assertOwnership=>{
   const executionKey=randomUUID();await db.execute('INSERT INTO ts_job_runs(job_key,execution_key,status) VALUES(?,?,?)',[job,executionKey,'running']);
   try {const result={...await work(assertOwnership),executionKey};await db.execute('UPDATE ts_job_runs SET status=?,result=? WHERE job_key=? AND execution_key=?',[result.skipped.length?'failed':(('truncated' in result&&result.truncated)||('unavailable' in result&&result.unavailable.length))?'incomplete':'completed',JSON.stringify(result),job,executionKey]);return result;}
   catch(error){const [pending]=await db.query<import('mysql2/promise').RowDataPacket[]>('SELECT cache_table,cache_key FROM ts_report_cache_lineage WHERE status=? AND generated_at=? LIMIT 100',['pending',taipeiSql(now)]).catch(()=>[[]]);await db.execute('UPDATE ts_job_runs SET status=?,result=? WHERE job_key=? AND execution_key=?',['failed',JSON.stringify({error:'cache-build-failed',publication:'inspect pending lineage; replay repairs MyISAM writes',pending,specificPending:await db.query<import('mysql2/promise').RowDataPacket[]>("SELECT 'ts_tag_cache_lineage' AS source,selection_key,the_date FROM ts_tag_cache_lineage WHERE status='pending' AND generated_at=? UNION ALL SELECT 'ts_live_tag_cache_lineage' AS source,selection_key,the_date FROM ts_live_tag_cache_lineage WHERE status='pending' AND generated_at=? LIMIT 100",[taipeiSql(now),taipeiSql(now)]).then(([r])=>r).catch(()=>[])}),job,executionKey]).catch(()=>undefined);throw error;}
  });
 } finally {await db.end();}
}
export async function handleCacheCli(args:string[],env:NodeJS.ProcessEnv) {if(!args[0]||!Object.hasOwn(cacheCommands,args[0]))return false;const result=await executeCacheWorkflow(args,env);console.log(JSON.stringify(result,null,2));if(result.skipped.length)process.exitCode=2;return true;}
/** No fake runnable jobs: these files/materializers are replaced by maintained data plus dynamic routes. */
export const retiredCacheWorkflows:Record<string,string>={
 'reports.keywords.build':'tags.vocabulary.import / tags.vocabulary.sync supplies maintained vocabulary; matcher no longer reads generated keyword.json news-weight files',
 'reports.group_view.build':'group_view API projects current published tag-date buckets dynamically; imported cache is labeled historical fallback only',
 'reports.static.html':'Next server-rendered group/keyword routes and compatibility redirects replace static HTML generation',
 'reports.mayor.static':'Next mayor city/person routes and static legacy URL redirects replace generated mayor HTML',
 'reports.live.static':'Next live report/wall routes and compatibility redirects replace generated live HTML',
 'reports.live.show':'Read-only live dashboard/API and ops health replace scheduled console printing; no derived write was owned by this job',
};
