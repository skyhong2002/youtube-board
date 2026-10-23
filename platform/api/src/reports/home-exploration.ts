import {PoolUnavailable,rankingPoolWindows,type RankedPoolClient,type RankedPool} from './tag-ranked-pool.js';
import type {HomeDiagnosticCallback,HomeDiagnostic} from './home-diagnostics.js';
import {latestKeywordVideo} from './keyword-candidates.js';
import {canonicalVideoThumbnail} from '../../../shared/media-assets.js';
import {sql} from 'drizzle-orm';
import {DataSourceUnavailable,type Reader,type Row} from '../db/client.js';
import type {ReaderOperation} from '../db/observation.js';
import type {HomeExploration,HomeKeywordSummary,TagRow} from '../contracts.js';
import {integer,tagIds,text,object,taipeiDate,taipeiSql,timestamp,timestampWindow,latest} from './normalize.js';
import {vocabularySourceQuality} from './vocabulary-quality.js';
import {videoTextDigest} from './video-digest.js';
import {rankingDisplayExclusions} from './keyword-overlay.js';
import {MATCH_RULE,matchingRuleForSnapshot} from '../../../shared/youtube-match-policy.js';
import {HomeSectionUnavailable,measuredCount,keywordDisplayMap,rankKeywordWindows,KEYWORD_RANKING_METHOD,KEYWORD_RISE_METHOD,KEYWORD_COMPARISON_MIN_COVERAGE,coverageSufficient} from './home-keyword-ranking.js';
/** Seven-day evidence scans run in a background keyword refresh (see keywordWindowCache),
 * so they get the reader's 15-second ceiling instead of the 5-second request default. */
const KEYWORD_QUERY=(operation:ReaderOperation)=>({statementMs:15000,operation});
/** Laravel homepage's top-eight category scope. Membership sums deliberately overlap.
 * updatedAt describes the complete category source scan used to determine the top eight. */
export function homeCategories(records:Row[],names:Map<number,string>){
 const stats=new Map<number,{views:number[];ids:Set<number>}>();
 for(const r of records){const views=integer(r.view_week),id=integer(r.u_id);if(views===null&&r.view_week!==null&&r.view_week!==undefined)throw new HomeSectionUnavailable('precision');if(views===null||views<10||id===null)continue;for(const tag of tagIds(r.tags)){const row=stats.get(tag)??{views:[],ids:new Set<number>()};if(!row.ids.has(id)){row.views.push(views);row.ids.add(id);}stats.set(tag,row);}}
 const all:TagRow[]=[...stats].map(([id,r])=>{const values=r.views.sort((a,b)=>a-b),middle=Math.floor(values.length/2),total=values.reduce((a,b)=>a+b,0);if(!Number.isSafeInteger(total))throw new HomeSectionUnavailable('precision');return {id,name:names.get(id)??String(id),kind:'channel',channels:values.length,weeklyViews:total,average:total/values.length,median:values.length%2?values[middle]!:((values[middle-1]??0)+(values[middle]??0))/2};});
 all.sort((a,b)=>b.weeklyViews-a.weeklyViews||a.id-b.id);const rows=all.slice(0,8),selected=new Set(rows.map(r=>r.id)),unique=new Set<number>();for(const [id,row] of stats)if(selected.has(id))for(const channel of row.ids)unique.add(channel);
 const weeklyViews=rows.reduce((n,r)=>n+r.weeklyViews,0);if(!Number.isSafeInteger(weeklyViews))throw new HomeSectionUnavailable('precision');
 return {status:'available' as const,reason:null,rows,summary:{visibleCategories:rows.length,channelMemberships:rows.reduce((n,r)=>n+r.channels,0),uniqueChannels:unique.size,weeklyViews,overlapping:true as const},updatedAt:latest(...records.map(r=>r.mtime)),minimumWeeklyViews:10 as const};
}
export type KeywordWindows=Pick<HomeExploration,'keywords'|'keywordToday'>;
/** keywordCache (the service's keywordWindowCache) may answer the keyword windows from a recent result. */
export async function homeExploration(reader:Reader,now:Date,diagnostic?:HomeDiagnosticCallback,poolClient?:RankedPoolClient,keywordCache?:(load:()=>Promise<KeywordWindows>)=>Promise<KeywordWindows>):Promise<HomeExploration>{
 const poolWindows=rankingPoolWindows(now);const effectiveNow=poolClient?new Date(Date.parse(poolWindows.week.until)-1000):now;
 const to=taipeiSql(effectiveNow),date=taipeiDate(now),today=poolClient?taipeiSql(new Date(poolWindows.today.since)):date+' 00:00:00',from=new Date(Date.parse(date+'T00:00:00Z')-6*86400000).toISOString().slice(0,10)+' 00:00:00';
 const emit=(section:HomeDiagnostic['section'],stage:HomeDiagnostic['stage'],reason:HomeDiagnostic['reason'])=>{try{diagnostic?.({section,stage,reason,UTC:now.toISOString()});}catch{/* Optional diagnostics cannot fail the report. */}};
 let keywordStage:HomeDiagnostic['stage']='vocabulary',keywordDiagnosticReason:HomeDiagnostic['reason']|undefined;
 let activeRule:'exact-text-v1'|typeof MATCH_RULE='exact-text-v1';
 const keywordBase={vocabularyCoverage:'unavailable' as const,vocabularyWindow:null,source:'https://tag.observe.tw' as const,version:null,from:timestamp(from)!,to:timestamp(to)!,updatedAt:null,rows:[],sourceVideos:null,freshVideos:null,staleVideos:null,unprocessedVideos:null,metric:'current-cumulative-views-of-window-published-videos' as const,rankingMethod:KEYWORD_RANKING_METHOD,riseMethod:KEYWORD_RISE_METHOD,ruleVersion:activeRule,comparison:null,exclusions:null};
 const todayBase={...keywordBase,from:timestamp(today)!};
 let poolFailure:HomeExploration['keywords']['rankingPool'];
 const unavailable=(error:unknown)=>{if(error instanceof PoolUnavailable)return 'data-source-unavailable' as const;if(error instanceof HomeSectionUnavailable)return error.reason;if(error instanceof DataSourceUnavailable)return 'data-source-unavailable';throw error;};
 const categoryTask=async()=>{
  const[counts,names]=await Promise.all([reader.rows(sql`SELECT u_id,tags,view_week,mtime FROM urt_count WHERE view_week>=10 ORDER BY u_id LIMIT 100001`,{operation:'home-category-counts'}),reader.rows(sql`SELECT tag_id,tag_name FROM urt_tag ORDER BY tag_id`,{operation:'home-category-names'})]);
  if(counts.length>100000)throw new HomeSectionUnavailable('source-cap');return homeCategories(counts,new Map(names.map(n=>[integer(n.tag_id)??0,text(n.tag_name)])));
 };
 const keywordTask=async():Promise<Pick<HomeExploration,'keywords'|'keywordToday'>>=>{
  const versions=await reader.rows(sql`SELECT r.id,JSON_OBJECT('coverage',JSON_EXTRACT(r.snapshot,'$.coverage'),'window',JSON_EXTRACT(r.snapshot,'$.window'),'sourceQuality',JSON_EXTRACT(r.snapshot,'$.sourceQuality'),'matchingRule',JSON_EXTRACT(r.snapshot,'$.matchingRule')) AS source_meta FROM ts_vocabulary_current c JOIN ts_vocabulary_runs r ON r.id=c.run_id AND r.status='published' WHERE c.source='https://tag.observe.tw' LIMIT 1`,{operation:'home-vocabulary'}),version=versions[0]?text(versions[0].id):null;
  const snapshot=object(versions[0]?.source_meta),window=object(snapshot.window),vocabularyCoverage=version?(snapshot.coverage==='all-current-indexed-article-tags'?'all-current-indexed-article-tags' as const:'observed-article-window' as const):'unavailable' as const;
  const quality=vocabularySourceQuality(snapshot.sourceQuality),rule=matchingRuleForSnapshot({matchingRule:snapshot.matchingRule??undefined});activeRule=rule;
  const base={...keywordBase,...(quality?{sourceQuality:quality}:{}),ruleVersion:rule,vocabularyCoverage,vocabularyWindow:timestampWindow(window),version,reason:null};
  if(!version){emit('keywords','vocabulary','not-synchronized');return {keywords:{...base,status:'not-synchronized'},keywordToday:{...base,from:todayBase.from,status:'not-synchronized'}};}
  let pools:{week:RankedPool;today:RankedPool}|undefined;
  if(poolClient){keywordStage='ranking-pool';try{const todayPool=await poolClient.load(poolWindows.today),weekPool=await poolClient.load(poolWindows.week);pools={today:todayPool,week:weekPool};}catch(error){poolFailure={status:'unavailable',reason:error instanceof PoolUnavailable?error.reason:'unavailable',windows:poolWindows};throw error instanceof PoolUnavailable?error:new PoolUnavailable('unavailable');}}
  const cohorts=pools?{week:new Set(pools.week.entries.map(e=>e.tag)),today:new Set(pools.today.entries.map(e=>e.tag))}:undefined;
  const at=(value:string)=>Date.parse(value.replace(' ','T')+'+08:00'),shift=(value:string,ms:number)=>taipeiSql(new Date(at(value)+ms));
  const windows=[{key:'week',from,to},{key:'today',from:today,to},
   {key:'prior-week',from:shift(from,-(at(to)-at(from)+1000)),to:shift(from,-1000)},
   {key:'prior-today',from:shift(today,-(at(to)-at(today)+1000)),to:shift(today,-1000)},
   ...Array.from({length:7},(_,i)=>{const lo=shift(from,i*86400000);return {key:lo.slice(0,10),from:lo,to:i===6?to:shift(lo,86400000-1000)};})];
  // MariaDB rewrites an IN list of 1000+ constants into a joined derived table, which
  // costs more than the evidence read itself at seven-day scale; stay under that size.
  const termKeyIn=(keys:string[])=>sql`(${sql.join(Array.from({length:Math.ceil(keys.length/900)},(_,i)=>sql`e.term_key IN (${sql.join(keys.slice(i*900,i*900+900).map(k=>sql`${k}`),sql`,`)})`),sql` OR `)})`;
  const windowSql=(items:typeof windows)=>sql.join(items.map(w=>sql`SELECT ${w.key} AS window_key,${w.from} AS window_from,${w.to} AS window_to`),sql` UNION ALL `);
  const fresh=sql`m.source_pk=v.pk AND BINARY m.rule_version=BINARY ${rule} AND BINARY m.source_text_sha256=BINARY ${videoTextDigest()}`;
  // Hash the bounded source window once. Only identifiers, timestamps and
  // numeric metrics cross the boundary; title/description never leave SQL.
  keywordStage='video-source';
  const sources=await reader.rows(sql`SELECT v.pk,v.u_id,v.publishedAt,m.video_id,m.vocabulary_version,
   CASE WHEN v.viewCount>=0 THEN v.viewCount ELSE NULL END AS viewCount,
   1 AS source_videos,(m.video_id IS NULL) AS unprocessed,CASE WHEN ${fresh} THEN 1 ELSE 0 END AS fresh,UNIX_TIMESTAMP(m.matched_at)*1000 AS matched_epoch
   FROM urt_video v LEFT JOIN ts_video_tag_matches m ON m.video_id=CONVERT(v.videoId USING ascii) AND BINARY m.video_id=BINARY v.videoId AND m.vocabulary_version=${version}
   WHERE v.publishedAt>=${windows[2]!.from} AND v.publishedAt<=${to} AND ${latestKeywordVideo()} LIMIT 100001`,KEYWORD_QUERY('home-video-source'));
  if(sources.length>100000||Buffer.byteLength(JSON.stringify(sources))>16*1024*1024)throw new HomeSectionUnavailable('source-cap');
  for(const r of sources){if(measuredCount(r.pk)<1||measuredCount(r.u_id)<1||measuredCount(r.fresh)>1||measuredCount(r.unprocessed)>1||measuredCount(r.fresh)+measuredCount(r.unprocessed)>1||!/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(?:\.\d+)?$/.test(text(r.publishedAt)))throw new HomeSectionUnavailable('precision');}
  const coverage=windows.map(w=>{const rows=sources.filter(r=>text(r.publishedAt)>=w.from&&text(r.publishedAt)<=w.to),freshRows=rows.filter(r=>Number(r.fresh)===1),unprocessed=rows.filter(r=>Number(r.unprocessed)===1).length;return {window_key:w.key,source_videos:rows.length,unprocessed,fresh:freshRows.length,stale:rows.length-unprocessed-freshRows.length,latest_match:freshRows.reduce<number|null>((latest,r)=>r.matched_epoch===null?latest:Math.max(latest??0,Number(r.matched_epoch)),null)};});
  const counts=new Map(coverage.map(c=>[text(c.window_key),c]));
  const coverageFor=(key:string)=>{const c=counts.get(key);if(!c)return {sourceVideos:0,freshVideos:0,staleVideos:0,unprocessedVideos:0};const result={sourceVideos:measuredCount(c.source_videos),freshVideos:measuredCount(c.fresh),staleVideos:measuredCount(c.stale),unprocessedVideos:measuredCount(c.unprocessed)};if(result.sourceVideos>100000)throw new HomeSectionUnavailable('source-cap');if(result.sourceVideos!==result.freshVideos+result.staleVideos+result.unprocessedVideos)throw new HomeSectionUnavailable('precision');return result;};
  for(const w of windows)coverageFor(w.key);
  const complete=(key:string)=>{const c=coverageFor(key);return coverageSufficient(c.freshVideos,c.sourceVideos);};
  const comparable={week:complete('week')&&complete('prior-week'),today:complete('today')&&complete('prior-today')};
  // Insufficient comparison coverage is unknown, never a synthetic zero baseline.
  // Avoid spending evidence work on a comparison that cannot be displayed.
  const activeWindows=windows.filter(w=>w.key!=='prior-week'&&w.key!=='prior-today'||w.key==='prior-week'&&comparable.week||w.key==='prior-today'&&comparable.today);
  const evidenceFrom=activeWindows.reduce((lo,w)=>w.from<lo?w.from:lo,from);
  const freshSourceRows=(since:string,until=to)=>{
   const selected=sources.filter(r=>Number(r.fresh)===1&&text(r.publishedAt)>=since&&text(r.publishedAt)<=until).map(r=>[r.pk,r.u_id,r.publishedAt,r.video_id,r.vocabulary_version,r.viewCount]);
   return sql`SELECT j.* FROM JSON_TABLE(${JSON.stringify(selected)},'$[*]' COLUMNS(pk BIGINT UNSIGNED PATH '$[0]',u_id BIGINT UNSIGNED PATH '$[1]',publishedAt DATETIME PATH '$[2]',video_id VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin PATH '$[3]',vocabulary_version VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin PATH '$[4]',viewCount BIGINT PATH '$[5]')) j`;
  };
  const freshSources=freshSourceRows(evidenceFrom);
  // This bounded labels-only scan applies the exact case-sensitive upstream
  // exclusions BEFORE LOWER display merging, and preserves all source keys.
  keywordStage='term-labels';
  const adminExcluded=await rankingDisplayExclusions(reader);
  const terms=await reader.rows(sql`SELECT DISTINCT e.term_key,e.term
   FROM (${freshSources}) fv STRAIGHT_JOIN ts_video_tag_evidence e FORCE INDEX(PRIMARY) ON e.video_id=CONVERT(fv.video_id USING ascii) AND e.vocabulary_version=${version} AND BINARY e.video_id=BINARY fv.video_id
   WHERE BINARY e.rule_version=BINARY ${rule} LIMIT 25001`,KEYWORD_QUERY('home-term-labels'));
  if(terms.length>25000||Buffer.byteLength(JSON.stringify(terms))>8*1024*1024)throw new HomeSectionUnavailable('source-cap');
  const allEligible=cohorts?new Set([...cohorts.week,...cohorts.today]):undefined,display=keywordDisplayMap(terms,allEligible,adminExcluded),exclude=!cohorts&&display.excluded.length?sql`AND e.term_key NOT IN (${sql.join(display.excluded.map(k=>sql`${k}`),sql`,`)})`:sql``;
  const eligibleKeys=cohorts?Object.fromEntries((['week','today'] as const).map(period=>[period,[...display.groups.values()].flatMap(g=>g.sourceTerms.filter(t=>cohorts[period].has(t.term)).map(t=>t.key))])) as Record<'week'|'today',string[]>:undefined;
  const priorWeek=windows[2]!,priorToday=windows[3]!;
  // Group on narrow ASCII identity; only genuine display aliases need mapping.
  // Sorting variable-width Unicode labels at evidence scale spills temp tables.
  const groupKey=display.aliases.length?sql`CONVERT(CASE e.term_key ${sql.join(display.aliases.map(a=>sql`WHEN ${a.key} THEN ${a.canonical}`),sql` `)} ELSE e.term_key END USING ascii) COLLATE ascii_bin`:sql`e.term_key`;
  const deduplicated=(sources:ReturnType<typeof freshSourceRows>,extra:ReturnType<typeof freshSourceRows>,dailyHistory=false)=>{
   const part=(windowKey:string|null,keys?:string[])=>sql`SELECT fv.pk,MAX(fv.u_id) AS u_id,MAX(fv.publishedAt) AS publishedAt,MAX(fv.viewCount) AS viewCount,${windowKey?sql`${windowKey} AS window_key,`:sql``}${groupKey} AS group_key,MAX(e.field_name='title') AS has_title
    FROM (${windowKey&&!dailyHistory?freshSourceRows(windows.find(w=>w.key===windowKey)!.from,windows.find(w=>w.key===windowKey)!.to):sources}) fv STRAIGHT_JOIN ts_video_tag_evidence e FORCE INDEX(PRIMARY) ON e.video_id=CONVERT(fv.video_id USING ascii) AND e.vocabulary_version=${version} AND BINARY e.video_id=BINARY fv.video_id
    WHERE BINARY e.rule_version=BINARY ${rule} ${extra} ${keys?keys.length?sql`AND ${termKeyIn(keys)}`:sql`AND FALSE`:sql``}
    ${windowKey&&!dailyHistory?sql`AND fv.publishedAt>=${windows.find(w=>w.key===windowKey)!.from} AND fv.publishedAt<=${windows.find(w=>w.key===windowKey)!.to}`:sql``}
    GROUP BY fv.pk,group_key`;
   if(!cohorts)return part(null);
   // A JSON_TABLE eligibility join multiplies the source-video rows by every
   // eligible term before the indexed evidence lookup in MariaDB. Constant IN
   // sets keep each exact cohort filter before aggregation without that fanout.
   const keys=dailyHistory?['week','today']:activeWindows.filter(w=>['week','today','prior-week','prior-today'].includes(w.key)).map(w=>w.key);
   return sql.join(keys.map(key=>part(key,eligibleKeys![key.endsWith('today')?'today':'week'])),sql` UNION ALL `);
  };
  // Rank channel totals first. Daily bins for every candidate multiply row counts
  // without improving selection, so fetch history only for the two selected top40s.
  // Four-bit memberships split exact partial-day prior boundaries without fanout.
  const rankingWindows=activeWindows.filter(w=>['week','today','prior-week','prior-today'].includes(w.key));
  keywordStage='ranking';
  // Cohort parts already carry their window key and exact bounds; re-joining the
  // window list would only re-read the materialized matches once per window.
  const windowKey=cohorts?sql`matched.window_key`:sql`w.window_key`;
  const records=display.groups.size?await reader.rows(sql`SELECT counted.window_key,counted.g,SUM(counted.n) AS n,SUM(counted.t) AS t,SUM(counted.m) AS m,SUM(counted.v) AS v,COUNT(*) AS channel_count,
    SUM(6*(1-POW(0.5,counted.t))+2*POW(0.5,counted.t)*(1-POW(0.5,counted.n-counted.t))) AS heat_score,CAST(RIGHT(MAX(counted.representative),20) AS UNSIGNED) AS representative_pk
   FROM (SELECT ${windowKey},matched.group_key AS g,matched.u_id AS c,COUNT(*) AS n,SUM(matched.has_title) AS t,COUNT(matched.viewCount) AS m,COALESCE(SUM(matched.viewCount),0) AS v,MAX(CONCAT(matched.has_title,DATE_FORMAT(matched.publishedAt,'%Y%m%d%H%i%s'),LPAD(matched.pk,20,'0'))) AS representative
    FROM (${deduplicated(freshSources,exclude)}) matched
    ${cohorts?sql``:sql`JOIN (${windowSql(rankingWindows)}) w ON matched.publishedAt>=w.window_from AND matched.publishedAt<=w.window_to`}
    GROUP BY ${windowKey},g,c) counted GROUP BY counted.window_key,counted.g LIMIT 20001`,KEYWORD_QUERY('home-ranking')):[];
  if(records.length>20000)throw new HomeSectionUnavailable('source-cap');
  const days=windows.slice(4).map(w=>({date:w.key,complete:complete(w.key)})),selected=rankKeywordWindows(records,display,[],comparable,cohorts);
  const selectedKeys=[...new Set([...selected.week,...selected.today].flatMap(row=>row.sourceTerms.map(t=>t.key)))];
  const completeDays=days.filter(d=>d.complete&&coverageFor(d.date).freshVideos>0).map(d=>d.date);
  keywordStage='daily-history';
  const daily=selectedKeys.length&&completeDays.length?await reader.rows(sql`SELECT ${cohorts?sql`CONCAT(matched.window_key,':',DATE(matched.publishedAt))`:sql`DATE(matched.publishedAt)`} AS window_key,matched.group_key AS g,matched.u_id AS c,COUNT(*) AS n,SUM(matched.has_title) AS t,COUNT(matched.viewCount) AS m,COALESCE(SUM(matched.viewCount),0) AS v
    FROM (${deduplicated(freshSourceRows(from),sql`AND ${termKeyIn(selectedKeys)} AND DATE(fv.publishedAt) IN (${sql.join(completeDays.map(d=>sql`${d}`),sql`,`)})`,true)}) matched
    ${cohorts?sql`WHERE matched.window_key IN ('week','today')`:sql``} GROUP BY ${cohorts?sql`CONCAT(matched.window_key,':',DATE(matched.publishedAt))`:sql`window_key`},g,c LIMIT 100001`,KEYWORD_QUERY('home-daily-history')):[];
  // Per-day channel rows for the selected terms; the 14-day comparison window outgrew 20k rows / 4 MiB on 2026-10-18.
  if(daily.length>100000||Buffer.byteLength(JSON.stringify(daily))>16*1024*1024)throw new HomeSectionUnavailable('source-cap');
  const ranking=rankKeywordWindows([...records,...daily],display,days,comparable,cohorts);
  // At most one title-leading representative per displayed term/window. Raw
  // provider image URLs never leave this query; the shared media hook supplies
  // channel branding from our cache and video thumbnails use the fixed CDN.
  if(selectedKeys.length){
   keywordStage='representatives';
   try{
    const chosen=records.filter(r=>(r.window_key==='week'||r.window_key==='today')&&ranking[r.window_key].some(row=>row.key===r.g));
    const pks=[...new Set(chosen.map(r=>measuredCount(r.representative_pk)))];
    const sourceRows=pks.length?await reader.rows(sql`SELECT v.pk,v.videoId,v.u_id,LEFT(v.channelId,128) AS channelId,LEFT(v.channelTitle,256) AS channelTitle FROM urt_video v WHERE v.pk IN (${sql.join(pks.map(pk=>sql`${pk}`),sql`,`)}) LIMIT 81`,{operation:'home-representatives'}):[];
    const byPk=new Map(sourceRows.map(r=>[measuredCount(r.pk),r]));
    const representatives:Row[]=chosen.flatMap(r=>{const source=byPk.get(measuredCount(r.representative_pk));return source?[{...source,window_key:r.window_key,group_key:r.g}]:[];});
    if(representatives.length>80)throw new HomeSectionUnavailable('source-cap');
    for(const r of representatives){
     const window=r.window_key;if(window!=='week'&&window!=='today')continue;
     const row=ranking[window].find(item=>item.key===text(r.group_key)),id=text(r.videoId),channelId=integer(r.u_id);
     if(!row||!canonicalVideoThumbnail(id))continue;
     row.representativeVideoId=id;row.thumbnail=canonicalVideoThumbnail(id);
     if(channelId!==null&&channelId>0){const name=text(r.channelTitle)||'頻道名稱待補',youtubeId=text(r.channelId);row.channel={id:channelId,name,title:name,youtubeId,youtubeUrl:`https://www.youtube.com/channel/${encodeURIComponent(youtubeId)}`,thumbnail:null,avatar:null};}
    }
   }catch(error){if(!(error instanceof DataSourceUnavailable))throw error;emit('keywords','representatives','data-source-unavailable');}
  }

  keywordStage='version-check';
  const [stillCurrent]=await reader.rows(sql`SELECT c.run_id FROM ts_vocabulary_current c JOIN ts_vocabulary_runs r ON r.id=c.run_id AND r.status='published' WHERE c.source='https://tag.observe.tw' LIMIT 1`,{operation:'home-version-check'});
  if(text(stillCurrent?.run_id)!==version){keywordDiagnosticReason='version-changed';throw new HomeSectionUnavailable('source-cap');}
  const summary=(window:'week'|'today'):HomeKeywordSummary=>{
   const matchedAt=counts.get(window)?.latest_match,prior=windows.find(w=>w.key==='prior-'+window)!;
   return {...base,from:window==='today'?todayBase.from:base.from,status:'synchronized',rows:ranking[window],exclusions:cohorts?keywordDisplayMap(terms,cohorts[window],adminExcluded).exclusions:display.exclusions,...(pools?{rankingPool:{status:'available' as const,provenance:pools[window].provenance,comparisonBasis:'current-eligible-terms' as const}}:{}),
    comparison:{from:timestamp(prior.from)!,to:timestamp(prior.to)!,complete:comparable[window],minCoverage:KEYWORD_COMPARISON_MIN_COVERAGE,...coverageFor(prior.key)},
    updatedAt:matchedAt!==null&&matchedAt!==undefined&&Number.isFinite(Number(matchedAt))?new Date(Number(matchedAt)).toISOString():null,...coverageFor(window)};
  };
  return {keywords:summary('week'),keywordToday:summary('today')};
 };
 const[categories,keywordWindows]=await Promise.all([
  categoryTask().catch(error=>{const reason=unavailable(error);emit('categories','category-source',reason);return {status:'unavailable' as const,reason,rows:[],summary:{visibleCategories:null,channelMemberships:null,uniqueChannels:null,weeklyViews:null,overlapping:true as const},updatedAt:null,minimumWeeklyViews:10 as const};}),
  (keywordCache?keywordCache(keywordTask):keywordTask()).catch(error=>{const reason=unavailable(error);
   // A caller coalesced onto another caller's keyword load never ran its own pool block, so
   // derive the pool failure from the error (only that block throws PoolUnavailable).
   const pool=poolFailure??(error instanceof PoolUnavailable?{status:'unavailable' as const,reason:error.reason,windows:poolWindows}:undefined);
   emit('keywords',error instanceof PoolUnavailable?'ranking-pool':keywordStage,keywordDiagnosticReason??reason);return {keywords:{...keywordBase,ruleVersion:activeRule,status:'unavailable' as const,reason,...(pool?{rankingPool:pool}:{})},keywordToday:{...todayBase,ruleVersion:activeRule,status:'unavailable' as const,reason,...(pool?{rankingPool:pool}:{})}};}),
 ]);return {categories,...keywordWindows};
}
