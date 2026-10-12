import type {TopicRow,EventEvidence} from '../contracts.js';
import type {Row} from '../db/client.js';
import {channelTopics} from './channel-ai-shapes.js';
import {integer,text} from './normalize.js';
export class DailyBoundError extends Error {readonly statusCode=422;}
const mediaCount=(topic:TopicRow)=>topic.evidence?new Set(topic.evidence.map(e=>e.channelId)).size:topic.channelCount;
export const DAILY_BOUNDS={sources:400,sourceBytes:1024*1024,totalBytes:16*1024*1024,topics:2000,references:20000,videos:5000};
export const dailyTopicBounds=(condition:string)=>condition==='all'?{min:5,max:40}:{min:3,max:25};
const weak=new Set(['ai','台灣','中國','美國','日本','國際','政治','財經','社會','新聞','直播','最新','民進黨','國民黨','川普','專家']);
export function dailySignals(title:string,keywords:string[],people:string[]){return [...new Set([...keywords,...people,title,...title.matchAll(/[A-Za-z0-9][A-Za-z0-9-]{1,}/g)].map(s=>typeof s==='string'?s:s[0]).map(s=>s.replace(/[\s\u3000\p{P}\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e]+/gu,'').replace(/事件|事故|新聞|後續|焦點|最新/g,'').trim().toLowerCase()).filter(s=>[...s].length>=2&&!weak.has(s)))];}
export function needsDailyRegroup(topics:TopicRow[],condition:string){const {min,max}=dailyTopicBounds(condition);return topics.length<min||topics.length>max||topics.filter(t=>mediaCount(t)<=1).length>Math.floor(topics.length/2);}
export function preferDailyRegroup(current:TopicRow[],candidate:TopicRow[],condition:string){
 const {min,max}=dailyTopicBounds(condition);if(!candidate.length||(candidate.length<min&&candidate.length<current.length))return false;
 const quality=(topics:TopicRow[])=>{const n=topics.length,within=n>=min&&n<=max,cross=topics.filter(t=>mediaCount(t)>=2).length;return [Number(within&&cross>=Math.ceil(n/2)),Number(within),cross,-(n<min?min-n:Math.max(0,n-max)),n];};
 const a=quality(current),b=quality(candidate);for(let i=0;i<a.length;i++)if(a[i]!==b[i])return b[i]!>a[i]!;return false;
}
/** Deterministic signal grouping of stored statements, not model inference or event verification. */
export function regroupDaily(rows:Row[],date:string,condition:string):TopicRow[]{
 const entries=rows.flatMap(row=>channelTopics(row.result_json).map((t,itemIndex)=>({title:t.title,signals:dailySignals(t.title,t.keywords,t.people),evidence:{channelId:integer(row.u_id)??0,channelTitle:text(row.title)||`Channel ${row.u_id}`,event:t.title,videoIds:t.videos,invalidReferenceCount:t.invalidReferences,keywords:t.keywords,people:t.people.filter(p=>p!=='無'),source:{table:'urt_channel_ai' as const,id:integer(row.pk)??0,itemIndex}}}))).filter(e=>e.title);
 if(entries.length>DAILY_BOUNDS.topics||entries.reduce((n,e)=>n+e.evidence.videoIds.length,0)>DAILY_BOUNDS.references)throw new DailyBoundError('Daily source grouping exceeds the bounded report capacity.');
 entries.sort((a,b)=>b.evidence.videoIds.length-a.evidence.videoIds.length||b.evidence.source.id-a.evidence.source.id);
 const clusters:{title:string;signals:Set<string>;evidence:EventEvidence[]}[]=[],index=new Map<string,Set<number>>();
 for(const entry of entries){if(entry.signals.length>128)throw new DailyBoundError('Daily event signal capacity exceeded.');
  const overlaps=new Map<number,number>();for(const signal of entry.signals)for(const id of index.get(signal)??[])overlaps.set(id,(overlaps.get(id)??0)+1);
  let best=-1,overlap=1;for(const [id,count]of overlaps)if(count>overlap||(count===overlap&&count>=2&&id<best)){best=id;overlap=count;}
  if(best<0){best=clusters.length;clusters.push({title:entry.title,signals:new Set(),evidence:[]});}
  const cluster=clusters[best]!;cluster.evidence.push(entry.evidence);
  for(const signal of entry.signals){cluster.signals.add(signal);const set=index.get(signal)??new Set();set.add(best);index.set(signal,set);}
 }
 return clusters.map((c,i)=>{const channelCount=new Set(c.evidence.map(e=>e.channelId)).size,videoCount=new Set(c.evidence.flatMap(e=>e.videoIds)).size,id=`derived-${date}-${condition}-${i}`;
  return {id,dailyId:0,title:c.title,channelCount,videoCount,score:videoCount+channelCount*3,keywords:[...new Set(c.evidence.flatMap(e=>e.keywords))],people:[...new Set(c.evidence.flatMap(e=>e.people))],evidence:c.evidence,unresolvedReferences:[],grouping:'source-signals' as const,detailUrl:`/ai/days/${date}?condition=${encodeURIComponent(condition)}#topic-${id}`};
 }).filter(c=>c.channelCount>=2||c.videoCount>=2).sort((a,b)=>b.score-a.score).slice(0,dailyTopicBounds(condition).max);
}
