import type {ReportValue,ReportCell} from '../report-contracts.js';
import type {AiEventData,AiEventPeopleFields,AiEventWallData,AiEventWallVideo,EventCitation} from '../contracts.js';
import {channelSource} from './channel-sources.js';
import type {ReportService} from './service.js';
import {BadQuery,positiveId,type Query} from './query.js';
import {latest} from './normalize.js';
import {link,table,type Register} from './table.js';
import {eventPresentation,presentationCitations} from './event-shapes.js';
const citationLabels={snapshot:'生成時快照引用','stored-reference':'歷史儲存引用',missing:'未附引用',invalid:'識別格式無效','outside-snapshot':'不屬於生成時來源'};
const labels={supporting:'支持',opposing:'反對',other:'其他觀點'};
export function registerEventExtra(register:Register,service:ReportService){
 const load=(id:string,q:Query)=>{if(q.event!==undefined&&(typeof q.event!=='string'||q.event.length>256))throw new BadQuery('Invalid event name.');return service.aiEvent(positiveId(id),q.event as string|undefined);};
 register('/ai/events/:id/people',async(p,q)=>{
  const event=await load(p.id,q),presentation=event.presentation??eventPresentation(event.analyses),people=presentation.people,media=presentation.media;
  const rows:Record<string,ReportValue|ReportCell>[]=(people?.groups??[]).flatMap(g=>g.rows.flatMap((person):Record<string,ReportValue|ReportCell>[]=>{const base={person:person.person,role:person.role,section:labels[g.kind],stance:person.stance,strength:person.strength,description:person.description};return person.citations.length?person.citations.map(c=>({...base,video:c.href?link(c.id!,c.href):c.rawId||null,media:{value:c.media,sources:c.sourceChannel?[c.sourceChannel]:[]},citationStatus:citationLabels[c.verification]})): [{...base,video:null,media:null,citationStatus:citationLabels.missing}];}));
  return {...table(event.title+'：人物與媒體觀點',[{key:'person',label:'人物'},{key:'role',label:'角色'},{key:'section',label:'AI 分類'},{key:'stance',label:'觀點'},{key:'strength',label:'強度'},{key:'description',label:'描述'},{key:'video',label:'引用影片'},{key:'media',label:'媒體'},{key:'citationStatus',label:'引用來源狀態'}],rows,q,{updatedAt:latest(...event.analyses.filter(a=>['people','media'].includes(a.type)).map(a=>a.updatedAt)),notes:['人物與媒體角色、觀點分類和強度來自儲存的 AI 分析，需回到影片驗證；不代表本站認定的政治立場。',`每日來源 #${event.dailyId}；人物分析 ${people?'#'+people.analysisId:'尚無'}；媒體分析 ${media?'#'+media.analysisId:'尚無'}。`,...(people?[`人物分析主體：${people.mainSubject||'未記錄'}。`]:[]),...(media?[`媒體分析主體：${media.mainSubject||'未記錄'}；列示媒體：${media.all.join('、')||'未記錄'}。`]:[]),...(event.evidenceCoverage?.sourceScopeMismatch?['指定分析與目前每日紀錄的來源範圍不同；同頁僅選取相同分析範圍的紀錄。']:[]),...(event.evidenceCoverage?.sourceChanged?['每日來源已有變動；保留原始分析快照，不以新的每日分組重新解讀。']:[])],sections:[{key:'media',title:'媒體觀點（儲存的 AI 分類）',columns:[{key:'media',label:'媒體'},{key:'section',label:'AI 分類'},{key:'stance',label:'觀點'},{key:'strength',label:'強度'},{key:'description',label:'描述'}],rows:(media?.groups??[]).flatMap(g=>g.rows.map(({sourceChannel,...r})=>({...r,media:{value:r.media,sources:sourceChannel?[sourceChannel]:[]},section:labels[g.kind]})))}]}),evidenceCoverage:event.evidenceCoverage,...peopleFields(event,presentation)};
 });
 register('/ai/events/:id/wall',async(p,q)=>{
  const event=await load(p.id,q),refs=new Map<string,{id:string;label:string}>();
  const add=(id:string,label:string)=>{if(/^[A-Za-z0-9_-]{11}$/.test(id)&&!refs.has(id))refs.set(id,{id,label});};
  for(const v of event.videos)add(v.id,v.title);
  for(const analysis of event.analyses){for(const v of analysis.lineage?.sourceVideos??[])add(v.id,v.title);for(const c of presentationCitations(eventPresentation([analysis])))if(c.href&&c.id)add(c.id,c.media||c.id);}
  const wall=eventWall(event);
  const data:AiEventWallData={title:event.title+'：來源影片牆',tabs:[],streams:[...refs.values()].slice(0,48).map((r,i)=>({...r,slot:i+1})),total:refs.size,updatedAt:latest(...event.analyses.map(a=>a.updatedAt)),notes:[`來源每日資料 #${event.dailyId}；包含原始彙整引用與 AI 分析引用，最多顯示 48 部；影片引用不代表已人工查證。`],variant:'event',evidenceCoverage:event.evidenceCoverage,event:event.title,date:event.date,dailyId:event.dailyId,resolution:event.resolution,...wall};
  return data;
 });
}

/** The date of Laravel's title "{event} 到 {date} 的相關報導" (AiEventReport::title(), urt_ai_date.date_to) is
 * AiEventData.date, the daily record's Taipei date; it is null for a record spanning several days. */
function peopleFields(event:AiEventData,presentation:AiEventData['presentation']):AiEventPeopleFields{return {event:event.title,date:event.date,dailyId:event.dailyId,people:presentation.people,media:presentation.media};}
const VIDEO_ID=/^[A-Za-z0-9_-]{11}$/,SOURCE_VIDEO_LIMIT=48;
/** Laravel AiEventReport::wallVideos(): each summary's facts then opinions, then the people
 * analysis's supporting, opposing and other persons' videos, unique by video id (first card wins).
 * Unlike Laravel only citations with a valid id that belong to the generation-time sources are shown.
 * sourceVideos are the remaining local event videos, newest first as the event report orders them. */
export function eventWall(event:Pick<AiEventData,'analyses'|'videos'>&{presentation?:AiEventData['presentation']}):Pick<AiEventWallData,'citedVideos'|'sourceVideos'|'sourceVideosTotal'>{
 const presentation=event.presentation??eventPresentation(event.analyses),local=new Map(event.videos.map(v=>[v.id,v])),seen=new Set<string>(),citedVideos:AiEventWallVideo[]=[];
 const localSource=(id:string)=>{const v=local.get(id);return v?channelSource({u_id:v.channelId,channelTitle:v.channelTitle,youtubeChannelId:v.youtubeChannelId}):null;};
 const add=(c:EventCitation,label:string,kind:AiEventWallVideo['kind'])=>{const id=c.id;if(!id||!c.href||!VIDEO_ID.test(id)||seen.has(id))return;seen.add(id);citedVideos.push({videoId:id,label,media:c.media,kind,title:local.get(id)?.title||null,source:c.sourceChannel??localSource(id)});};
 for(const s of presentation.summaries){for(const f of s.facts)add(f.citation,f.headline,'fact');for(const o of s.opinions)add(o.citation,o.content,'opinion');}
 for(const kind of ['supporting','opposing','other'] as const)for(const g of presentation.people?.groups.filter(g=>g.kind===kind)??[])for(const p of g.rows)for(const c of p.citations)add(c,p.person,kind);
 const rest=event.videos.filter(v=>VIDEO_ID.test(v.id)&&!seen.has(v.id));
 return {citedVideos,sourceVideos:rest.slice(0,SOURCE_VIDEO_LIMIT).map(v=>({videoId:v.id,label:v.title||v.id,media:v.channelTitle,kind:'source',title:v.title||null,source:localSource(v.id)})),sourceVideosTotal:rest.length};
}
