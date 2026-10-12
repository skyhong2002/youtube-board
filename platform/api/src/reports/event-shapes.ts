import {channelSource,sourceForLabel,sourceLabelLookup} from './channel-sources.js';
import type {ChannelSource} from '../../../shared/media-assets.js';
import type {EventAnalysis,EventCitation,EventPresentation,TopicRow} from '../contracts.js';
import {ReportReadBound} from './cache-weights.js';
import {object,text} from './normalize.js';
const row=(v:unknown)=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const scalar=(o:Record<string,unknown>,keys:string[])=>{for(const k of keys)if(typeof o[k]==='string'||typeof o[k]==='number')return String(o[k]).trim();return '';};
function items(v:unknown,max=1000):unknown[]{if(!Array.isArray(v))return [];if(v.length>max)throw new ReportReadBound('Event analysis item capacity exceeded.');return v;}
function strings(v:unknown):string[]{const out:string[]=[];let visited=0;const visit=(v:unknown,depth:number)=>{if(++visited>5000||depth>8)throw new ReportReadBound('Event list capacity exceeded.');if(Array.isArray(v))for(const child of v)visit(child,depth+1);else if(typeof v==='string'||typeof v==='number'){const t=String(v).trim();if(t)out.push(t);}};visit(v,0);return out;}
export function resolveEventAlias(topics:TopicRow[],requested:string){
 const exact=topics.filter(t=>t.title===requested);if(exact.length)return {title:requested,topics:exact,kind:'exact' as const};
 const candidates=topics.filter(t=>[...t.evidence,...t.unresolvedReferences].some(e=>e.event===requested));
 if(candidates.length>1||(candidates.length===1&&topics.filter(t=>t.title===candidates[0]!.title).length>1))throw Object.assign(new Error('Event alias has multiple same-day source topics.'),{statusCode:409});
 return candidates.length?{title:candidates[0]!.title,topics:candidates,kind:'same-day-source-alias' as const}:{title:requested,topics:[],kind:'exact' as const};
}
export function eventPresentation(analyses:EventAnalysis[],videoSources:Map<string,ChannelSource>=new Map()):EventPresentation{
 let references=0;
 const citation=(v:unknown,a:EventAnalysis):EventCitation=>{if(++references>5000)throw new ReportReadBound('Event citation capacity exceeded.');const o=row(v),rawId=scalar(o,['video_id','videoId']),media=scalar(o,['media','媒體']),id=/^[A-Za-z0-9_-]{11}$/.test(rawId)?rawId:null;
  const verification:EventCitation['verification']=!rawId?'missing':!id?'invalid':a.lineage?.state==='immutable-snapshot'?(a.lineage.sourceVideos.some(v=>v.id===id&&v.media===media)?'snapshot':'outside-snapshot'):'stored-reference';
  const explicit=verification==='snapshot'?a.lineage?.sourceVideos.filter(v=>v.id===id&&v.media===media).map(v=>channelSource(v))??[]:verification==='stored-reference'&&id&&videoSources.has(id)?[videoSources.get(id)!]:[];
  return {id,rawId,media,verification,sourceChannel:sourceForLabel(media,explicit),href:id&&verification!=='outside-snapshot'?`https://www.youtube.com/watch?v=${id}`:null};};
 const summaries:EventPresentation['summaries']=[];let people:EventPresentation['people']=null,media:EventPresentation['media']=null;
 const groups=[['supporting','supporting_persons','supporting_medias'],['opposing','opposing_persons','opposing_medias'],['other','other_opinions_persons','other_opinions_medias']] as const;
 for(const a of analyses){const payload=object(a.result),sources=a.lineage?.state==='immutable-snapshot'?a.lineage.sourceVideos.map(v=>channelSource(v)):[],sourceByLabel=sourceLabelLookup(sources);
  if(a.type==='summary')for(const value of items(payload.events??a.result)){const e=row(value),title=scalar(e,['event','事件','title']);if(!title)continue;summaries.push({analysisId:a.id,title,description:scalar(e,['description','描述']),keywords:strings(e.keywords??e['關鍵字']),media:strings(e.media??e['媒體']),sourceChannels:strings(e.media??e['媒體']).map(name=>sourceByLabel(name)),facts:items(e.fact??e.facts).map(row).map(r=>({headline:scalar(r,['headline','標題']),citation:citation(r,a)})).filter(r=>r.headline),opinions:items(e.opinion??e.opinions).map(row).map(r=>({stance:scalar(r,['stance','角度','立場']),intensity:scalar(r,['intensity','強度']),content:scalar(r,['content','內容','description']),citation:citation(r,a)})).filter(r=>r.content)});}
  if(a.type==='people'&&Object.keys(payload).length)people={analysisId:a.id,mainSubject:scalar(payload,['main_subject','主體角色']),groups:groups.map(([kind,key])=>({kind,rows:items(payload[key]).map(row).map(r=>({person:scalar(r,['person','人物']),role:scalar(r,['role','角色']),stance:scalar(r,['support_or_opposition','立場']),strength:scalar(r,['strength','強度']),description:scalar(r,['description','描述']),citations:items(r.videos).map(v=>citation(v,a))})).filter(r=>r.person)}))};
  if(a.type==='media'&&Object.keys(payload).length)media={analysisId:a.id,mainSubject:scalar(payload,['main_subject','主體角色']),all:strings(payload.all_medias??payload['全部媒體']),sourceChannels:strings(payload.all_medias??payload['全部媒體']).map(name=>sourceByLabel(name)),groups:groups.map(([kind,,key])=>({kind,rows:items(payload[key]).map(row).map(r=>({media:scalar(r,['media','媒體']),sourceChannel:sourceByLabel(scalar(r,['media','媒體'])),stance:scalar(r,['support_or_opposition','立場']),strength:scalar(r,['strength','強度']),description:scalar(r,['description','描述'])})).filter(r=>r.media)}))};
 }
 return {summaries,people,media};
}
export function presentationCitations(p:EventPresentation){return [...p.summaries.flatMap(s=>[...s.facts,...s.opinions].map(r=>r.citation)),...(p.people?.groups.flatMap(g=>g.rows.flatMap(r=>r.citations))??[])];}
