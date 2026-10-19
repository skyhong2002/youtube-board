import type {AiDaysData,TopicRow,TopicSummary} from '../contracts.js';
import type {Row} from '../db/client.js';
import {channelTopics,type ChannelTopic} from './channel-ai-shapes.js';
import {channelNetwork} from '../../../shared/channel-networks.js';
/** Party tags on urt_count.tags, as the Laravel daily page read them: [4] 泛綠, [3] 泛藍. */
const GREEN_TAG=4,BLUE_TAG=3;
/** 24-hour news streams the Laravel page never used as representative videos. */
const NO_REPRESENTATIVE=new Set([406,456]);
const VIDEO_ID=/^[A-Za-z0-9_-]{11}$/;
function top(counts:Map<string,number>):{term:string;count:number}[]{
 return [...counts].map(([term,count])=>({term,count})).sort((a,b)=>b.count-a.count).slice(0,5);
}
export function channelTagIds(tags:unknown):number[]{return typeof tags==='string'?[...tags.matchAll(/\[(\d+)\]/g)].map(m=>Number(m[1])):[];}
/** Daily order counts media networks, not channels: two 三立 channels citing one story are one
 * source. Topics confirmed by at least two networks come first, then videos + 3 × networks.
 * Unresolved references cannot be attributed to a network and are not counted. Stable sort. */
export function rankByNetworks(topics:TopicRow[],tags:Map<number,number[]>):TopicRow[]{
 for(const topic of topics){
  const networks=new Map<string,string>();
  for(const e of topic.evidence){const n=channelNetwork(e.channelId,tags.get(e.channelId)??[],e.channelTitle);if(!networks.has(n.key))networks.set(n.key,n.name);}
  topic.networkCount=networks.size;topic.networks=[...networks.values()];topic.score=topic.videoCount+networks.size*3;
 }
 const confirmed=(t:TopicRow)=>Number((t.networkCount??0)>=2);
 return topics.map((t,i)=>({t,i})).sort((a,b)=>confirmed(b.t)-confirmed(a.t)||b.t.score-a.t.score||a.i-b.i).map(x=>x.t);
}
/** Per-topic counts shown on the Laravel /ai/days page, computed from the cited channel summaries. */
export function summarizeTopics(topics:TopicRow[],sources:Map<number,Row>,tags:Map<number,number[]>):void{
 const parsed=new Map<number,ChannelTopic[]>();
 const items=(id:number)=>{let rows=parsed.get(id);if(!rows){const source=sources.get(id);rows=source?channelTopics(source.result_json):[];parsed.set(id,rows);}return rows;};
 for(const topic of topics){
  const keywords=new Map<string,number>(),people=new Map<string,number>(),summary:TopicSummary={keywords:[],people:[],party:{green:0,blue:0},angle:{taiwan:0,china:0},camp:{dpp:0,kmt:0},videos:[]};
  for(const e of topic.evidence){
   const videos=e.videoIds.length;
   for(const k of e.keywords)keywords.set(k,(keywords.get(k)??0)+1);
   for(const p of e.people)people.set(p,(people.get(p)??0)+1);
   const list=items(e.channelId),match=(e.source.itemIndex===undefined?undefined:list[e.source.itemIndex])??list.find(t=>t.title===e.event);
   if(match){
    if(match.angle.includes('台灣'))summary.angle.taiwan+=videos;
    if(match.angle.includes('中國'))summary.angle.china+=videos;
    if(match.camp.includes('民進黨'))summary.camp.dpp+=videos;
    if(match.camp.includes('國民黨'))summary.camp.kmt+=videos;
   }
   const channelTags=tags.get(e.channelId)??[];
   if(channelTags.includes(GREEN_TAG))summary.party.green+=videos;
   if(channelTags.includes(BLUE_TAG))summary.party.blue+=videos;
   const first=e.videoIds[0];
   if(first&&VIDEO_ID.test(first)&&!NO_REPRESENTATIVE.has(e.channelId)&&summary.videos.length<3)summary.videos.push({videoId:first,channelId:e.channelId,channelTitle:e.channelTitle,event:e.event});
  }
  summary.keywords=top(keywords);summary.people=top(people);topic.summary=summary;
 }
}
/** Laravel coverage card "AI source": with condition=all, events citing at most one video are not counted. */
export function sourceStats(sources:Map<number,Row>,condition:string):NonNullable<AiDaysData['sourceStats']>{
 const stats={channels:sources.size,channelsWithEvents:0,eventRows:0,videoRefs:0};
 for(const source of sources.values()){
  const events=channelTopics(source.result_json).filter(t=>t.title&&(condition!=='all'||t.videos.length+t.invalidReferences>1));
  if(events.length)stats.channelsWithEvents++;
  stats.eventRows+=events.length;stats.videoRefs+=events.reduce((n,t)=>n+t.videos.length+t.invalidReferences,0);
 }
 return stats;
}
