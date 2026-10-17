import type {HomeKeywordSummary} from '../contracts.js';
import type {Row} from '../db/client.js';
import {asciiCaseFold} from '../../../shared/ascii-case.js';
import {integer,text} from './normalize.js';
import {ADMIN_RANKING_EXCLUSION} from './keyword-overlay.js';
import {MATCH_FIELD_WEIGHTS,tagDisplayExclusion,TAG_POLICY_SOURCE,YOUTUBE_DISPLAY_POLICY_VERSION} from '../../../shared/youtube-match-policy.js';
export class HomeSectionUnavailable extends Error {constructor(public reason:'source-cap'|'precision'){super(reason);}}
export function measuredCount(value:unknown){const n=integer(value);if(n===null||n<0)throw new HomeSectionUnavailable('precision');return n;}
export const KEYWORD_RANKING_METHOD='youtube-channel-weighted-decay-v1' as const;
export const KEYWORD_RISE_METHOD='equal-duration-heat-delta' as const;
/** Rise and daily trend need this matched share of every window involved. New uploads
 * and edited titles keep a live source just short of 100%, so exact completeness would
 * withhold them permanently; the share is published with each comparison. */
export const KEYWORD_COMPARISON_MIN_COVERAGE=0.95 as const;
export const coverageSufficient=(fresh:number,source:number)=>fresh>=source*KEYWORD_COMPARISON_MIN_COVERAGE;
/** Titles lead each channel's geometric sequence. Distinct source videos only. */
export function channelHeat(titles:number,descriptions:number){return MATCH_FIELD_WEIGHTS.title*2*(1-0.5**titles)+MATCH_FIELD_WEIGHTS.description*0.5**titles*2*(1-0.5**descriptions);}
/** adminExcluded: term keys from approved administrator ranking-display decisions. */
export function keywordDisplayMap(terms:Row[],eligible?:Set<string>,adminExcluded?:Set<string>){
 const groups=new Map<string,{key:string;term:string;sourceTerms:{key:string;term:string}[]}>(),excluded:string[]=[],reasons:Record<string,number>={};
 for(const r of terms){const key=text(r.term_key),term=text(r.term),reason=tagDisplayExclusion(term)??(adminExcluded?.has(key)?ADMIN_RANKING_EXCLUSION:null)??(eligible&&!eligible.has(term)?'upstream-window-not-qualified':null);if(reason){excluded.push(key);reasons[reason]=(reasons[reason]??0)+1;continue;}
  // Group ASCII case only; preserve all exact upstream labels and identities.
  const groupName=asciiCaseFold(term),group=groups.get(groupName)??{key,term,sourceTerms:[]};group.sourceTerms.push({key,term});if(key<group.key){group.key=key;group.term=term;}groups.set(groupName,group);
 }
 for(const g of groups.values())g.sourceTerms.sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);
 const byKey=new Map([...groups.values()].map(g=>[g.key,g])),aliases=[...groups.values()].flatMap(g=>g.sourceTerms.filter(t=>t.key!==g.key).map(t=>({key:t.key,canonical:g.key})));
 return {groups,byKey,aliases,excluded,exclusions:{scope:'fresh-window-matched-terms' as const,terms:excluded.length,reasons,policyCommit:TAG_POLICY_SOURCE.commit,youtubePolicyVersion:YOUTUBE_DISPLAY_POLICY_VERSION}};
}
type RankingRow=HomeKeywordSummary['rows'][number];
export function rankKeywordWindows(records:Row[],display:ReturnType<typeof keywordDisplayMap>,days:{date:string;complete:boolean}[],comparable:{week:boolean;today:boolean},cohorts?:{week:Set<string>;today:Set<string>}){
 if(records.length>100000||Buffer.byteLength(JSON.stringify(records))>16*1024*1024)throw new HomeSectionUnavailable('source-cap');
 // Accumulate each channel's counts across date bins before applying decay.
 // Otherwise summing daily heat would incorrectly reset a channel's saturation.
 const aggregated=new Map<string,Map<string,RankingRow>>();
 const channelBuckets=new Map<string,Map<string,Map<string,{n:number;titles:number;measured:number;views:number}>>>();
 for(const r of records){
  const key=r.g??r.group_key,label=typeof key==='string'?display.byKey.get(key):display.groups.get(text(r.group_name)),groupName=label?.key;if(!groupName)throw new HomeSectionUnavailable('precision');
  const n=measuredCount(r.n??r.videos),titles=measuredCount(r.t??r.title_videos),measured=measuredCount(r.m??r.measured_videos),views=measuredCount(r.v??r.known_views);
  if(titles>n||measured>n)throw new HomeSectionUnavailable('precision');
  if(r.heat_score!==undefined){
   const window=text(r.window_key),channels=measuredCount(r.channel_count),heat=Number(r.heat_score);
   if(!['week','today','prior-week','prior-today'].includes(window)||channels>n||!Number.isFinite(heat)||heat<0||heat>channels*6+1e-8)throw new HomeSectionUnavailable('precision');
   const bucket=aggregated.get(window)??new Map<string,RankingRow>();if(bucket.has(groupName))throw new HomeSectionUnavailable('precision');
   bucket.set(groupName,{...label!,videoCount:n,titleVideos:titles,descriptionOnlyVideos:n-titles,measuredViewVideos:measured,unknownViewVideos:n-measured,knownViews:views,views:measured===n?views:null,channelCount:channels,heatScore:heat,rise:null,trend:[],representativeVideoId:null,thumbnail:null,channel:null});aggregated.set(window,bucket);continue;
  }
  const mask=r.w===undefined?null:measuredCount(r.w);if(mask!==null&&mask>15)throw new HomeSectionUnavailable('precision');
  const membership=(field:string,bit:number)=>{if(mask!==null)return (mask&bit)!==0;const value=measuredCount(r[field]);if(value>1)throw new HomeSectionUnavailable('precision');return value===1;};
  const windows=typeof r.window_key==='string'?[r.window_key]:[
   ...(membership('in_week',1)?['week',...(r.d!==undefined||r.bucket_date!==undefined?[text(r.d??r.bucket_date)]:[])]:[]),...(membership('in_today',2)?['today']:[]),
   ...(membership('in_prior_week',4)?['prior-week']:[]),...(membership('in_prior_today',8)?['prior-today']:[])];
  for(const window of windows){
   const groups=channelBuckets.get(window)??new Map(),channels=groups.get(groupName)??new Map(),channel=String(measuredCount(r.c??r.u_id)),totals=channels.get(channel)??{n:0,titles:0,measured:0,views:0};
   totals.n+=n;totals.titles+=titles;totals.measured+=measured;totals.views+=views;
   if(!Object.values(totals).every(Number.isSafeInteger))throw new HomeSectionUnavailable('precision');
   channels.set(channel,totals);groups.set(groupName,channels);channelBuckets.set(window,groups);
  }
 }
 const buckets=new Map<string,Map<string,RankingRow>>();
 for(const [window,groups] of channelBuckets){const bucket=new Map<string,RankingRow>();for(const [groupName,channels] of groups){
  const row:RankingRow={...display.byKey.get(groupName)!,videoCount:0,views:0,unknownViewVideos:0,knownViews:0,measuredViewVideos:0,channelCount:channels.size,titleVideos:0,descriptionOnlyVideos:0,heatScore:0,rise:null,trend:[],representativeVideoId:null,thumbnail:null,channel:null};
  for(const {n,titles,measured,views} of channels.values()){row.videoCount+=n;row.titleVideos+=titles;row.descriptionOnlyVideos+=n-titles;row.measuredViewVideos+=measured;row.unknownViewVideos+=n-measured;row.knownViews+=views;row.heatScore+=channelHeat(titles,n-titles);}
  if(![row.videoCount,row.titleVideos,row.descriptionOnlyVideos,row.measuredViewVideos,row.unknownViewVideos,row.knownViews,row.channelCount].every(Number.isSafeInteger))throw new HomeSectionUnavailable('precision');
  row.views=row.unknownViewVideos?null:row.knownViews;bucket.set(groupName,row);
 }buckets.set(window,bucket);}

 for(const [window,rows] of aggregated){if(buckets.has(window))throw new HomeSectionUnavailable('precision');buckets.set(window,rows);}
 const rank=(window:'week'|'today')=>[...(buckets.get(window)?.entries()??[])].map(([key,row])=>{const sourceTerms=cohorts?row.sourceTerms.filter(t=>cohorts[window].has(t.term)):row.sourceTerms;if(!sourceTerms.length)throw new HomeSectionUnavailable('precision');return {...row,sourceTerms,term:sourceTerms[0]!.term,rise:comparable[window]?row.heatScore-(buckets.get('prior-'+window)?.get(key)?.heatScore??0):null,trend:days.map(d=>({date:d.date,heat:d.complete?(buckets.get(cohorts?window+':'+d.date:d.date)?.get(key)?.heatScore??0):null}))};}).sort((a,b)=>b.heatScore-a.heatScore||b.videoCount-a.videoCount||(a.key<b.key?-1:a.key>b.key?1:0)).slice(0,40);
 return {week:rank('week'),today:rank('today')};
}
