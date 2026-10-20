import { randomUUID } from 'node:crypto';
import { mayorCandidateDictionary, selectPhotoTerms, photosCacheJob, predictionsCacheJob, cloudCacheJob, countsCacheJob, keywordsCacheJob, peopleCacheJob, tagCloudCacheJob, STREAM_VIDEO_LIMIT, keywordRelationCacheJob, liveCacheCleanJob, liveCleanupJob, liveDisplayCacheJob, liveTagDateCacheJob, scheduleCacheJob, tagDateCacheJob, tagMonthCacheJob, taipeiSql, validateCacheInput, type CacheInput, type TagDictionary } from '@youtube-board/ingestion';
import { assertExecute, executionPolicy } from './policy.js';
import { connectDatabase, withWriterLock } from './database.js';
import { loadVocabularySnapshot } from './load-vocabulary.js';
import { matchVocabulary } from './match.js';
import { tagDisplayExclusion } from '../../shared/youtube-match-policy.js';
export const cacheCommands = {
 'reports:photos:build':'reports.photos.build','reports:channel-predictions:build':'reports.channel_predictions.build',
 'reports:counts:build':'reports.counts.build', 'reports:schedule:build':'reports.schedule.build', 'youtube:live:cleanup':'youtube.live.cleanup', 'reports:live:build':'reports.live.build', 'reports:live:clean':'reports.live.clean',
 'reports:tag-date:build':'reports.tag_date.build', 'reports:people:build':'reports.people.build', 'reports:channel-cloud:build':'reports.channel_cloud.build', 'reports:tag-cloud:build':'reports.tag_cloud.build', 'reports:keyword-cloud:build':'reports.keyword_cloud.build', 'reports:keyword-relations:build':'reports.keyword_relations.build', 'reports:tag-month:build':'reports.tag_month.build', 'reports:keywords:cache':'reports.keywords.cache', 'reports:live-tag-date:build':'reports.live_tag_date.build',
} as const;
const base=['tagid','or','not','channel-limit','video-limit','vocabulary-version'];
export const cacheFields: Record<string,{values:string[];flags:string[]}> = Object.fromEntries(Object.values(cacheCommands).map(job=>[job,{flags:job==='reports.photos.build'?['refresh']:[],values: job==='reports.photos.build'?['terms','limit','vocabulary-version']:job==='reports.channel_predictions.build'?['u_id','limit','after-id']:job==='reports.counts.build'?['u_id','limit']:job==='reports.schedule.build'?['videoId','limit','hours']:job==='youtube.live.cleanup'||job==='reports.live.clean'?['limit']:job==='reports.live.build'?['hours','limit']:job==='reports.channel_cloud.build'?['u_id','days','channel-limit','video-limit','vocabulary-version']:job==='reports.keyword_relations.build'?['subject','top-subjects','from','to','days','channel-limit','video-limit','vocabulary-version']:job==='reports.tag_month.build'?[...base,'subject','month']:job==='reports.keyword_cloud.build'?[...base,'subject','top-subjects','days']:job==='reports.tag_cloud.build'?[...base,'days','each-tagid','exclude-tagid']:job==='reports.keywords.cache'?[...base,'days','recent-days']:job==='reports.people.build'?['tagid','days','limit','offset','group','keyword-limit','channel-limit','video-limit']:job==='reports.tag_date.build'?[...base,'from','to','days','date-limit','keyword-set','each-tagid','exclude-tagid']:[...base,'from','to','days']} ]));
/** Laravel clamps these limits instead of rejecting them (e.g. scheduled `reports:counts:build --limit=500` runs 100). */
const laravelLimitClamp:Record<string,number>={'reports.counts.build':100,'reports.live.build':100,'reports.live.clean':200,'reports.schedule.build':200,'reports.people.build':200};
/** Builders that stream one day of rows at a time may scan the long tag-cloud/tags_all windows. */
const streamedVideoJobs=['reports.tag_cloud.build','reports.keywords.cache','reports.keyword_cloud.build'];
/** Validates queue and CLI inputs before connection, with the same bounds as the direct builders. */
export function validateCacheArguments(args:string[],now=new Date()) {
 if(!Array.isArray(args)||args.length>24||args.some(a=>typeof a!=='string'||a.length>512)||!args[0]||!Object.hasOwn(cacheCommands,args[0]))throw new Error('Unknown cache workflow');
 const command=args[0] as keyof typeof cacheCommands,job=cacheCommands[command],schema=cacheFields[job]!,options=new Map<string,string>();
 for(const arg of args.slice(1)){const m=/^--([a-zA-Z_-]+)(?:=(.*))?$/.exec(arg);if(!m||options.has(m[1]!)||!['execute','dry-run',...schema.values,...schema.flags].includes(m[1]!)||(['execute','dry-run',...schema.flags].includes(m[1]!)?m[2]!==undefined:!m[2]))throw new Error('Unknown, duplicate or malformed cache argument');options.set(m[1]!,m[2]??'');}
 if(options.has('execute')&&options.has('dry-run'))throw new Error('Conflicting cache modes');
 const maxima:Record<string,number>={'after-id':2147483647,limit:Object.hasOwn(laravelLimitClamp,job)?2147483647:['reports.photos.build','reports.channel_predictions.build'].includes(job)?100:200,u_id:2147483647,...(job==='reports.tag_cloud.build'?{}:{days:job==='reports.keywords.cache'?90:job==='reports.people.build'?365:366}),'recent-days':2147483647,hours:job==='reports.schedule.build'?2147483647:720,'channel-limit':5000,'video-limit':streamedVideoJobs.includes(job)?STREAM_VIDEO_LIMIT:100000,'keyword-limit':20000,'date-limit':400,'top-subjects':100};
 for(const [key,value]of options){if(key in maxima&&(!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value))||Number(value)<(key==='after-id'?0:1)||Number(value)>maxima[key]!))throw new Error('Invalid cache numeric bound');if(['tagid','or','not','exclude-tagid'].includes(key)&&(!/^\d+(,\d+)*$/.test(value)||value.split(',').length>20))throw new Error('Invalid taxonomy selection');if(key==='videoId'&&!/^[A-Za-z0-9_-]{1,32}$/.test(value))throw new Error('Invalid video identity');if(key==='vocabulary-version'&&!/^[A-Za-z0-9_-]{1,100}$/.test(value))throw new Error('Invalid vocabulary version');if(key==='offset'&&value!=='auto'&&(!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value))||Number(value)>2147483647))throw new Error('Invalid people offset');if(key==='group'&&(!value.trim()||[...value].length>64||/[\u0000-\u001f\u007f]/.test(value)))throw new Error('Invalid people group');}
 // Laravel tag cloud takes a comma list of periods (default 1,3,7,30,90), each 1..365, at most 10, in one run.
 const daysList=job==='reports.tag_cloud.build'?[...new Set((options.get('days')??'1,3,7,30,90').split(',').map(d=>{if(!/^\d+$/.test(d)||Number(d)<1||Number(d)>365)throw new Error('Invalid tag cloud period');return Number(d);}))]:[];
 if(daysList.length>10)throw new Error('Invalid tag cloud period');
 const number=(key:string,otherwise:number)=>Number(options.get(key)??otherwise), list=(key:string)=>[...new Set(options.get(key)?.split(',').map(Number)??[])].sort((a,b)=>a-b);
 const to=options.get('to')??taipeiSql(now).slice(0,10),days=job==='reports.tag_cloud.build'?Math.max(...daysList):number('days',job==='reports.people.build'?37:job==='reports.keywords.cache'?31:1),from=options.get('from')??new Date(Date.parse(to)-(days-1)*86400000).toISOString().slice(0,10);
 const input:CacheInput={tagIds:list('tagid'),orTagIds:list('or'),notTagIds:list('not'),from,to,days,channelLimit:number('channel-limit',['reports.tag_cloud.build','reports.tag_date.build','reports.people.build'].includes(job)?1000:5000),videoLimit:number('video-limit',job==='reports.tag_cloud.build'||job==='reports.keywords.cache'?50000:job==='reports.tag_date.build'||job==='reports.people.build'?10000:20000),...(options.has('u_id')?{uId:number('u_id',1)}:{}),...(options.has('subject')?{subject:options.get('subject')!}:{})};
 if(options.has('terms')&&(options.get('terms')!.split(',').some(t=>!t||[...t].length>32||/[\uD800-\uDFFF]/u.test(t))||options.get('terms')!.split(',').length>number('limit',20)))throw new Error('Invalid explicit photo terms');
 if(job==='reports.people.build'&&!options.has('tagid'))input.tagIds=[13];
 if(job==='reports.people.build'&&input.tagIds.length!==1)throw new Error('People cache takes one tagid');
 // Laravel reports:mayor:static rebuilt tagids 3-6 one at a time with only the candidate names.
 if(options.has('keyword-set')&&(options.get('keyword-set')!=='mayor-candidates'||input.tagIds.length!==1||input.orTagIds!.length||input.notTagIds!.length||options.has('vocabulary-version')))throw new Error('Mayor candidate cache takes keyword-set=mayor-candidates and one tagid');
 if(job==='reports.keywords.cache'&&!options.has('or'))input.orTagIds=[1,2,13,14];
 // A scheduled run can cover every category (each published under its own single-tagid key) or the ranked keywords.
 if(options.has('each-tagid')&&(options.get('each-tagid')!=='all'||options.has('tagid')||options.has('or')||options.has('not')||options.has('keyword-set')))throw new Error('each-tagid=all replaces the taxonomy selection');
 if(options.has('exclude-tagid')&&!options.has('each-tagid'))throw new Error('exclude-tagid needs each-tagid');
 if(options.has('top-subjects')&&options.has('subject'))throw new Error('Use either subject or top-subjects');
 if(job==='reports.tag_month.build'){
   const month=options.get('month');if(!month||!/^\d{4}-\d{2}$/.test(month)||Number(month.slice(-2))<1||Number(month.slice(-2))>12)throw new Error('Explicit YYYY-MM month required');
   input.from=month+'-01';input.to=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(-2)),0)).toISOString().slice(0,10);if(input.to>=to)throw new Error('Month cache requires a closed month');
 }
 validateCacheInput(input);if(input.to>taipeiSql(now).slice(0,10))throw new Error('Future cache dates are forbidden');
 if(['reports.keyword_cloud.build','reports.keyword_relations.build','reports.tag_month.build'].includes(job)&&!input.subject&&!options.has('top-subjects'))throw new Error('Explicit subject required');
 if(job==='reports.keyword_relations.build'&&(input.tagIds.length||input.orTagIds!.length||input.notTagIds!.length))throw new Error('Relations cache has global coverage');
 const limit=Math.min(number('limit',job==='reports.people.build'?5:20),laravelLimitClamp[job]??Number.MAX_SAFE_INTEGER);
 const recentDays=Math.min(number('recent-days',7),input.days),hours=job==='reports.schedule.build'?Math.min(number('hours',1),168):number('hours',2);
 // The Laravel scheduler passes --limit=5 --offset=auto for people; those are the defaults here so the schedule entry needs no extra options.
 const offset:number|'auto'=job==='reports.people.build'&&(options.get('offset')??'auto')==='auto'?'auto':number('offset',0);
 return {command,job,options,input,execute:options.has('execute'),number,limit,daysList,recentDays,hours,offset};
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
   if(job==='reports.counts.build')return countsCacheJob(ctx,{...(input.uId?{uId:input.uId}:{}),limit:v.limit});
   if(job==='reports.schedule.build')return scheduleCacheJob(ctx,{...(options.has('videoId')?{videoId:options.get('videoId')!}:{}),limit:v.limit,hours:v.hours});
   if(job==='youtube.live.cleanup')return liveCleanupJob(ctx,v.number('limit',20));
   if(job==='reports.live.clean')return liveCacheCleanJob(ctx,v.limit);
   if(job==='reports.live.build')return liveDisplayCacheJob(ctx,{hours:v.hours,limit:v.limit});
   if(job==='reports.people.build')return peopleCacheJob(ctx,{group:options.get('group')?.trim()||'政治人物',tagId:input.tagIds[0]!,days:input.days,limit:v.limit,offset:v.offset,keywordLimit:v.number('keyword-limit',5000),channelLimit:input.channelLimit,videoLimit:input.videoLimit});
   if(job==='reports.tag_date.build'&&options.has('keyword-set'))return tagDateCacheJob(ctx,{...input,...(options.has('date-limit')?{dateLimit:v.number('date-limit',400)}:{})},await mayorCandidateDictionary(db));
   const snapshot=await loadVocabularySnapshot(db,options.get('vocabulary-version'));
   const dictionary:TagDictionary={version:snapshot.id,coverage:snapshot.coverage,rule:'youtube-tag-exact-v1-title2-length',match:(title,description)=>matchVocabulary({title,description},snapshot)};
   if(options.has('each-tagid')){
    const results=[];for(const tagId of await categoryTagIds(db,options.get('exclude-tagid'))){const one={...input,tagIds:[tagId]};results.push({tagId,...(job==='reports.tag_cloud.build'?await tagCloudCacheJob(ctx,one,v.daysList,dictionary):await tagDateCacheJob(ctx,{...one,...(options.has('date-limit')?{dateLimit:v.number('date-limit',400)}:{})},dictionary))});}
    return {mode:execute?'execute':'dry-run',selected:results.length,applied:results.filter(r=>r.applied.length).map(r=>r.tagId),skipped:results.flatMap(r=>r.skipped.map(s=>({tagId:r.tagId,...s}))),channels:results.reduce((n,r)=>n+r.channels,0)};
   }
   if(options.has('top-subjects'))input.subjects=await rankedSubjects(db,v.number('top-subjects',20),snapshot);
   if(job==='reports.tag_date.build')return tagDateCacheJob(ctx,{...input,...(options.has('date-limit')?{dateLimit:v.number('date-limit',400)}:{})},dictionary);
   if(job==='reports.tag_cloud.build')return tagCloudCacheJob(ctx,input,v.daysList,dictionary);
   if(job==='reports.live_tag_date.build')return liveTagDateCacheJob(ctx,input,dictionary);
   if(job==='reports.tag_month.build')return tagMonthCacheJob(ctx,input,dictionary);
   if(job==='reports.keyword_relations.build')return keywordRelationCacheJob(ctx,input,dictionary);
   if(job==='reports.keywords.cache')return keywordsCacheJob(ctx,{...input,recentDays:v.recentDays},dictionary);
   return cloudCacheJob(ctx,input,dictionary,job==='reports.channel_cloud.build'?'channel':'keyword');
  };
  if(!execute)return await work(async()=>{});
  // One lock per workflow like Laravel's per-job ingestion lock; a batch worker's serial queue orders same-batch jobs.
  return await withWriterLock(db,job,async assertOwnership=>{
   const executionKey=randomUUID();await db.execute('INSERT INTO ts_job_runs(job_key,execution_key,status) VALUES(?,?,?)',[job,executionKey,'running']);
   try {const result={...await work(assertOwnership),executionKey};await db.execute('UPDATE ts_job_runs SET status=?,result=? WHERE job_key=? AND execution_key=?',[result.skipped.length?'failed':(('truncated' in result&&result.truncated)||('unavailable' in result&&Array.isArray(result.unavailable)&&result.unavailable.length>0))?'incomplete':'completed',JSON.stringify(result),job,executionKey]);return result;}
   catch(error){const [pending]=await db.query<import('mysql2/promise').RowDataPacket[]>('SELECT cache_table,cache_key FROM ts_report_cache_lineage WHERE status=? AND generated_at=? LIMIT 100',['pending',taipeiSql(now)]).catch(()=>[[]]);await db.execute('UPDATE ts_job_runs SET status=?,result=? WHERE job_key=? AND execution_key=?',['failed',JSON.stringify({error:'cache-build-failed',publication:'inspect pending lineage; replay repairs MyISAM writes',pending,specificPending:await db.query<import('mysql2/promise').RowDataPacket[]>("SELECT 'ts_tag_cache_lineage' AS source,selection_key,the_date FROM ts_tag_cache_lineage WHERE status='pending' AND generated_at=? UNION ALL SELECT 'ts_live_tag_cache_lineage' AS source,selection_key,the_date FROM ts_live_tag_cache_lineage WHERE status='pending' AND generated_at=? LIMIT 100",[taipeiSql(now),taipeiSql(now)]).then(([r])=>r).catch(()=>[])}),job,executionKey]).catch(()=>undefined);throw error;}
  });
 } finally {await db.end();}
}
/** Every category that tags at least one channel in urt_count (the markers Laravel's tag builders select by), minus exclusions. */
export async function categoryTagIds(db:import('mysql2/promise').Connection,exclude='') {
 const skip=new Set(exclude.split(',').filter(Boolean).map(Number)),ids=new Set<number>();
 const [rows]=await db.query<import('mysql2/promise').RowDataPacket[]>("SELECT tags FROM urt_count WHERE tags LIKE '%[%'");
 for(const row of rows)for(const m of String(row.tags).matchAll(/\[(\d+)\]/g)){const id=Number(m[1]);if(Number.isSafeInteger(id)&&id>=1&&id<=2147483647&&!skip.has(id))ids.add(id);}
 return [...ids].sort((a,b)=>a-b);
}
/** The first N terms of the /keywords ranking: the serving vocabulary by article count (the order the page reads),
 * minus the terms the ranking never shows (the YouTube display policy and the operator exclusions in tags.no_tag).
 * View-ranked tags_all is not used: description boilerplate (copyright, community rules) dominates it. */
export async function rankedSubjects(db:import('mysql2/promise').Connection,count:number,snapshot:{terms:{key:string;term:string;articleCount:number}[]}) {
 const [hidden]=await db.query<import('mysql2/promise').RowDataPacket[]>('SELECT tag FROM tags WHERE no_tag>=1 LIMIT 10001');if(hidden.length>10000)throw new Error('Keyword exclusions exceed read budget');
 const excluded=new Set(hidden.map(r=>String(r.tag).trim()));
 const subjects=[...snapshot.terms].filter(t=>Number.isSafeInteger(t.articleCount)&&t.articleCount>0&&t.term&&[...t.term].length<=32&&!/[\uD800-\uDFFF]/u.test(t.term)&&!excluded.has(t.term.trim())&&!tagDisplayExclusion(t.term))
  .sort((a,b)=>b.articleCount-a.articleCount||(a.key<b.key?-1:a.key>b.key?1:0)).slice(0,count).map(t=>t.term);
 if(!subjects.length)throw new Error('No vocabulary terms for top-subjects');
 return subjects;
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
