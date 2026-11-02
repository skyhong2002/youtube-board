import {createHash} from 'node:crypto';
import {sql} from 'drizzle-orm';
import type {Reader} from '../db/client.js';
import type {RelatedVideo,TopicCoverage,TopicRow} from '../contracts.js';
import {isTagNoise} from '../../../shared/tag-noise.js';
import {channelNetwork} from '../../../shared/channel-networks.js';
import {channelTagIds} from './daily-summary.js';
import {integer,text} from './normalize.js';

/** Rule-based "other channels' videos" for each daily topic. The AI picks topics from a fixed
 * channel list; this matches every channel's videos of the same Taipei day against each topic's
 * people and event keywords. It is a reading, never an AI judgement: every video keeps the terms
 * it matched, and the AI-cited videos stay separate. Bump the version whenever the rule changes. */
export const TOPIC_RELATED_RULE='topic-related-v1';
/** Most videos read for one day; a larger day reports `unavailable` instead of a partial count. */
export const TOPIC_RELATED_DAY_LIMIT=20000;
/** A keyword found in more of the day's videos than this is too general to tie a video to a topic. */
const GENERIC_SHARE=0.03;
/** Description text counts, but less than the title. */
const DESCRIPTION_WEIGHT=0.4;
/** The best topic must beat the runner-up by this factor to claim a video; otherwise it is only "possibly related". */
const PRIMARY_MARGIN=1.25;
/** A title qualifying for this many topics is keyword stacking: possible for each, primary for none. */
const STACKED_TOPICS=4;
const DESCRIPTION_CHARS=300;
/** A topic without named people needs this score (two specific event words), so 國道 + 連環車禍 alone cannot claim another crash. */
const UNNAMED_MIN_SCORE=10;
/** An event word in most of one channel's titles that day is its show name (頭家來開講), not news. */
const SHOW_NAME_SHARE=0.8,SHOW_NAME_MIN_VIDEOS=5;
const TOP_VIDEOS=6;
const VIDEO_ID=/^[A-Za-z0-9_-]{11}$/;
/** People fields that name nobody in particular (鄭姓男子, 網友) cannot anchor a topic. */
const ANONYMOUS=/(?:^.{1,2}姓|男子|女子|民眾|網友|記者|主播|嫌犯|男童|女童|官員|發言人)$/;

export interface CandidateVideo {videoId:string;channelId:number;channelTitle:string;title:string;description:string;publishedAt:string;views:number|null;tags:number[]}
export type TopicInput=Pick<TopicRow,'id'|'title'|'people'|'keywords'|'evidence'>;
export interface TopicMatch {primary:RelatedVideo[];possible:RelatedVideo[];seedTotal:number;seedMatched:number;terms:{people:string[];events:string[]}}

export function normalizeText(value:string){return value.normalize('NFKC').toLowerCase().replace(/臺/g,'台').replace(/\s+/g,' ');}
const ascii=(term:string)=>/^[a-z0-9 .+&'-]+$/.test(term);
function finder(term:string):(text:string)=>boolean{
 if(!ascii(term))return text=>text.includes(term);
 // Latin terms match whole words only: LINE must not hit ONLINE or deadline.
 const pattern=new RegExp(`(?<![a-z0-9])${term.replace(/[.+&'-]/g,c=>'\\'+c)}(?![a-z0-9])`);
 return text=>pattern.test(text);
}
function usable(term:string){
 const t=normalizeText(term).trim();
 if(t.length<2||isTagNoise(t)||/^\d+$/.test(t))return null;
 if(ascii(t)&&t.replace(/[^a-z]/g,'').length<2)return null;
 return t;
}
interface Prepared {video:CandidateVideo;title:string;description:string}
interface TopicTerms {id:string;people:string[];events:string[];seeds:Set<string>}

/** Pure: assign the day's videos to topics. Exported for tests and calibration. */
export function matchTopics(topics:readonly TopicInput[],videos:readonly CandidateVideo[]):Map<string,TopicMatch>{
 const prepared:Prepared[]=videos.filter(v=>VIDEO_ID.test(v.videoId)).map(video=>({video,title:normalizeText(video.title),description:normalizeText(video.description.slice(0,DESCRIPTION_CHARS))}));
 const n=prepared.length,df=new Map<string,number>(),finders=new Map<string,(t:string)=>boolean>(),shows=new Map<string,Set<number>>();
 const perChannel=new Map<number,number>();for(const p of prepared)perChannel.set(p.video.channelId,(perChannel.get(p.video.channelId)??0)+1);
 const frequency=(term:string)=>{let value=df.get(term);if(value===undefined){const find=finder(term),inTitles=new Map<number,number>();finders.set(term,find);value=0;
  for(const p of prepared){const t=find(p.title);if(t)inTitles.set(p.video.channelId,(inTitles.get(p.video.channelId)??0)+1);if(t||find(p.description))value++;}
  shows.set(term,new Set([...inTitles].filter(([id,c])=>{const total=perChannel.get(id)!;return total>=SHOW_NAME_MIN_VIDEOS&&c/total>=SHOW_NAME_SHARE;}).map(([id])=>id)));
  df.set(term,value);}return value;};
 const idf=(term:string)=>Math.log((n+1)/(frequency(term)+1));
 const terms:TopicTerms[]=topics.map(topic=>{
  const people=[...new Set(topic.people.filter(p=>!ANONYMOUS.test(p.trim())).map(usable).filter((t):t is string=>!!t))];
  const events=[...new Set(topic.keywords.map(usable).filter((t):t is string=>!!t&&!people.includes(t)))].filter(t=>frequency(t)<=Math.max(3,n*GENERIC_SHARE));
  for(const p of people)frequency(p);
  return {id:topic.id,people,events,seeds:new Set(topic.evidence.flatMap(e=>e.videoIds).filter(id=>VIDEO_ID.test(id)))};
 });
 const qualifies=(t:TopicTerms,p:Prepared):{score:number;matched:string[]}|null=>{
  const hit=(term:string)=>{const find=finders.get(term)!;return find(p.title)?1:find(p.description)?DESCRIPTION_WEIGHT:0;};
  let score=0;const matched:string[]=[];let personInTitle=false,eventsHit=0,eventInTitle=false;
  for(const term of t.people){const w=hit(term);if(w){score+=w*idf(term);matched.push(term);if(w===1)personInTitle=true;}}
  for(const term of t.events){if(shows.get(term)!.has(p.video.channelId))continue;const w=hit(term);if(w){score+=w*idf(term);matched.push(term);eventsHit++;if(w===1)eventInTitle=true;}}
  // The title must carry the topic: a named person and an event word there (the description only adds weight).
  // A topic without named people needs two event words, one in the title, and a minimum score.
  const ok=t.people.length?personInTitle&&eventInTitle:eventsHit>=2&&eventInTitle&&score>=UNNAMED_MIN_SCORE;
  return ok?{score:Math.round(score*100)/100,matched}:null;
 };
 const result=new Map<string,TopicMatch>(terms.map(t=>[t.id,{primary:[],possible:[],seedTotal:0,seedMatched:0,terms:{people:t.people,events:t.events}}]));
 const allSeeds=new Set(terms.flatMap(t=>[...t.seeds]));
 for(const p of prepared){
  const hits=terms.map(t=>({t,q:qualifies(t,p)})).filter((h):h is {t:TopicTerms;q:{score:number;matched:string[]}}=>!!h.q).sort((a,b)=>b.q.score-a.q.score);
  for(const t of terms)if(t.seeds.has(p.video.videoId)){const m=result.get(t.id)!;m.seedTotal++;if(hits.some(h=>h.t===t))m.seedMatched++;}
  // The AI already placed its cited videos; they are counted as AI citations, never as extra related videos.
  if(allSeeds.has(p.video.videoId)||!hits.length)continue;
  const row=(h:typeof hits[number]):RelatedVideo=>({videoId:p.video.videoId,channelId:p.video.channelId,channelTitle:p.video.channelTitle,title:p.video.title,publishedAt:p.video.publishedAt,views:p.video.views,score:h.q.score,matchedTerms:h.q.matched});
  const clear=hits.length<STACKED_TOPICS&&(hits.length===1||hits[0]!.q.score>=hits[1]!.q.score*PRIMARY_MARGIN);
  if(clear)result.get(hits[0]!.t.id)!.primary.push(row(hits[0]!));
  else for(const h of hits)result.get(h.t.id)!.possible.push(row(h));
 }
 const order=(a:RelatedVideo,b:RelatedVideo)=>(b.views??-1)-(a.views??-1)||b.score-a.score||a.videoId.localeCompare(b.videoId);
 for(const m of result.values()){m.primary.sort(order);m.possible.sort(order);}
 return result;
}

export function topicCoverage(topic:TopicInput,match:TopicMatch|undefined,tags:Map<number,number[]>,window:{from:string;to:string}):TopicCoverage{
 if(!match)return {status:'unavailable',ruleVersion:TOPIC_RELATED_RULE,window,aiChannels:0,videos:0,channels:0,networks:null,possibleVideos:0,seedRecall:null,top:[]};
 const titles=new Map<number,string>();for(const e of topic.evidence)titles.set(e.channelId,e.channelTitle);for(const v of match.primary)titles.set(v.channelId,v.channelTitle);
 const networks=new Set([...titles].map(([id,title])=>channelNetwork(id,tags.get(id)??[],title).key));
 return {status:'ready',ruleVersion:TOPIC_RELATED_RULE,window,aiChannels:new Set(topic.evidence.map(e=>e.channelId)).size,videos:match.primary.length,channels:titles.size,networks:networks.size,possibleVideos:match.possible.length,seedRecall:match.seedTotal?Math.round(match.seedMatched/match.seedTotal*100)/100:null,top:match.primary.slice(0,TOP_VIDEOS)};
}

export interface DayMatches {window:{from:string;to:string};status:'ready'|'unavailable';matches:Map<string,TopicMatch>;tags:Map<number,number[]>}
async function loadDay(reader:Reader,topics:readonly TopicInput[],date:string):Promise<DayMatches>{
 const window={from:date+' 00:00:00',to:date+' 23:59:59'};
 const rows=await reader.rows(sql`SELECT v.videoId,v.u_id,v.title,LEFT(v.description,${DESCRIPTION_CHARS}) AS description,v.publishedAt,v.viewCount,c.title AS channelTitle,n.tags
  FROM urt_video v JOIN urt_channel c ON c.u_id=v.u_id LEFT JOIN urt_count n ON n.u_id=v.u_id
  WHERE v.publishedAt>=${window.from} AND v.publishedAt<=${window.to} AND (c.flag_del IS NULL OR c.flag_del<1) LIMIT ${TOPIC_RELATED_DAY_LIMIT+1}`,{operation:'video-read',statementMs:15000});
 if(rows.length>TOPIC_RELATED_DAY_LIMIT)return {window,status:'unavailable',matches:new Map(),tags:new Map()};
 const tags=new Map<number,number[]>(),videos:CandidateVideo[]=[];
 for(const r of rows){const channelId=integer(r.u_id);if(!channelId)continue;const t=channelTagIds(r.tags);tags.set(channelId,t);
  videos.push({videoId:text(r.videoId),channelId,channelTitle:text(r.channelTitle),title:text(r.title),description:text(r.description),publishedAt:text(r.publishedAt),views:integer(r.viewCount),tags:t});}
 // Cited channels outside the day's rows still need their network tags.
 const missing=[...new Set(topics.flatMap(t=>t.evidence.map(e=>e.channelId)))].filter(id=>!tags.has(id));
 if(missing.length)for(const r of await reader.rows(sql`SELECT u_id,tags FROM urt_count WHERE u_id IN(${sql.join(missing.map(id=>sql`${id}`),sql`,`)})`))tags.set(Number(r.u_id),channelTagIds(r.tags));
 return {window,status:'ready',matches:matchTopics(topics,videos),tags};
}

/** Per-process cache: a past day is stable, today keeps receiving videos. */
export function topicRelatedCache(reader:Reader,now:()=>Date=()=>new Date(),limit=24){
 const entries=new Map<string,{at:number;value:Promise<DayMatches>}>();
 return (topics:readonly TopicInput[],date:string):Promise<DayMatches>=>{
  const key=date+'|'+createHash('sha256').update(JSON.stringify(topics.map(t=>[t.id,t.title,t.people,t.keywords,t.evidence.flatMap(e=>e.videoIds)]))).digest('hex');
  const today=new Date(now().getTime()+8*3600_000).toISOString().slice(0,10),ttl=date>=today?10*60_000:6*3600_000,at=now().getTime(),hit=entries.get(key);
  if(hit&&at-hit.at<ttl)return hit.value;
  const value=loadDay(reader,topics,date);entries.set(key,{at,value});value.catch(()=>entries.delete(key));
  while(entries.size>limit)entries.delete(entries.keys().next().value!);
  return value;
 };
}

/** Attach `coverage` to each topic; any failure leaves the topics as they were. */
export async function withTopicCoverage<T extends TopicRow>(load:ReturnType<typeof topicRelatedCache>,topics:T[],date:string|null):Promise<T[]>{
 if(!date||!topics.length)return topics;
 try{const day=await load(topics,date);return topics.map(t=>({...t,coverage:day.status==='ready'?topicCoverage(t,day.matches.get(t.id),day.tags,day.window):topicCoverage(t,undefined,day.tags,day.window)}));}
 catch{return topics;}
}
