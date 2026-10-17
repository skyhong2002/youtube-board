import {legacyEventTitle} from './contracts.js';
import type {Connection,RowDataPacket} from 'mysql2/promise';
import {loadDailySource,sourceIdentity,type Plan} from '@youtube-board/ai';
import {type Config,type Context,type Event,type MediaReport,type Period,type Video,groups,hash,json,record,strings,text,unique} from './contracts.js';
const get=(r:Record<string,unknown>,keys:string[])=>keys.map(k=>r[k]).find(v=>v!==undefined);
function list(value:unknown):unknown[]{const v=typeof value==='string'?json(value):value;const list=record(v)?v.events:v;if(!Array.isArray(list)||list.length>100)throw new Error('notification_event_list_invalid');return list;}
export function normalizeEvent(raw:unknown,position:number):Event {
 if(!record(raw))throw new Error('notification_event_invalid');
 const title=legacyEventTitle(get(raw,['事件','議題','標題','event','topic','title']));if(!title||title.length>500)throw new Error('notification_event_title_invalid');
 const ids=strings(get(raw,['videoId','video_id','video_ids','videos']));if(ids.length>500||ids.some(id=>!/^[A-Za-z0-9_-]{11}$/.test(id)))throw new Error('notification_video_identity_invalid');
 const media=get(raw,['媒體事件','media_events','mediaEvents']),category=get(raw,['分類','類型','category','type']);
 // Laravel: array_keys(媒體事件) feeds the AI payload `media` (array_filter drops ''/'0') and the raw count feeds media_count.
 const mediaKeys=Array.isArray(media)?media.map((_,i)=>String(i)):record(media)?Object.keys(media):[];
 return {title,description:text(get(raw,['描述','說明','description','content'])),category:text(category)||strings(category)[0]||'',angle:text(get(raw,['角度','angle'])),camp:text(get(raw,['陣營','camp','stance'])),keywords:strings(get(raw,['關鍵字','keywords'])),people:strings(get(raw,['人物','people'])),places:strings(get(raw,['地名','places'])),media:mediaKeys.filter(k=>k!==''&&k!=='0'),videoIds:ids,videoCount:ids.length,mediaCount:mediaKeys.length,position,videos:[],mediaReports:[]};
}

// --- Laravel AiTopicProjector / TelegramDigestBroadcaster::hydrateDailyEvents port -------------------------
const phpTrim=legacyEventTitle;
const scalar=(v:unknown):v is string|number|boolean=>typeof v==='string'||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v);
const phpString=(v:unknown)=>typeof v==='string'?v:typeof v==='boolean'?(v?'1':''):typeof v==='number'?String(v):'';
const flatten=(v:unknown):unknown[]=>Array.isArray(v)?v.flatMap(flatten):record(v)?Object.values(v).flatMap(flatten):[v];
/** AiTopicProjector::text — first set, scalar, non-blank key. */
function projText(item:Record<string,unknown>,keys:string[]){for(const k of keys){const v=item[k];if(v!==null&&v!==undefined&&scalar(v)&&phpTrim(phpString(v))!=='')return phpTrim(phpString(v));}return '';}
/** AiTopicProjector::stringList — the first existing key decides; duplicates are kept (they are counted). */
function projList(item:Record<string,unknown>,keys:string[]){for(const k of keys){if(!Object.hasOwn(item,k))continue;const v=item[k];if(Array.isArray(v)||record(v))return flatten(v).filter(scalar).map(x=>phpTrim(phpString(x))).filter(Boolean);return scalar(v)&&phpTrim(phpString(v))!==''?[phpTrim(phpString(v))]:[];}return [];}
/** Broadcaster::scalarList — flatten, trimmed, unique. */
const scalarList=(v:unknown)=>unique((Array.isArray(v)||record(v)?flatten(v):[]).filter(scalar).map(x=>phpTrim(phpString(x))).filter(Boolean));
type Counts=Map<string,number>|Record<string,unknown>;
/** Broadcaster::countedKeys — arsort (stable for ties, PHP 8) then the first `limit` non-blank keys. */
function countedKeys(counts:unknown,limit=8){const entries:[string,number][]=counts instanceof Map?[...counts]:record(counts)?Object.entries(counts).map(([k,v])=>[k,Number(v)||0]):[];return entries.map((e,i)=>({e,i})).sort((a,b)=>b.e[1]-a.e[1]||a.i-b.i).map(({e})=>phpTrim(e[0])).filter(Boolean).slice(0,limit);}
/** Broadcaster::mostCommon — array_count_values + arsort; ties keep first occurrence. */
function mostCommon(values:string[]){const counts=new Map<string,number>();for(const v of values.map(phpTrim).filter(Boolean))counts.set(v,(counts.get(v)??0)+1);let best='',n=0;for(const[k,c]of counts)if(c>n){best=k;n=c;}return best;}
export interface TopicEntry {uId:number;channel:string;name:string;raw:Record<string,unknown>}
export interface TopicStats {媒體數:number;videos:Map<number,string[]>|Record<string,unknown>;角度:Counts;陣營:Counts;關鍵字:Counts;人物:Counts;地名:Counts;媒體明細:unknown[]}
/** AiTopicProjector::project aggregation for one topic's resolved channel events. */
export function topicStats(entries:TopicEntry[]):TopicStats {
 const videos=new Map<number,string[]>(),angle=new Map<string,number>(),camp=new Map<string,number>(),keywords=new Map<string,number>(),people=new Map<string,number>(),places=new Map<string,number>(),details:unknown[]=[],channels=new Set<string>();
 const add=(t:Map<string,number>,k:string,n=1)=>t.set(k,(t.get(k)??0)+n);
 for(const e of entries){
  const ids=projList(e.raw,['videoId','video_id','video_ids','videos']);if(!ids.length)throw new Error('notification_daily_event_videos_missing');
  const n=ids.length,a=projText(e.raw,['角度','angle']),c=projText(e.raw,['陣營','camp','stance']);channels.add(e.channel);
  videos.set(e.uId,unique([...(videos.get(e.uId)??[]),...ids]));
  for(const k of ['台灣','中國'])if(a.includes(k))add(angle,k,n);
  for(const k of ['民進黨','國民黨'])if(c.includes(k))add(camp,k,n);
  const kw=projList(e.raw,['關鍵字','keywords']),pp=projList(e.raw,['人物','people']),pl=projList(e.raw,['地名','places']);
  kw.forEach(k=>add(keywords,k));pp.forEach(k=>add(people,k));pl.forEach(k=>add(places,k));
  details.push({u_id:e.uId,媒體:e.channel,事件:projText(e.raw,['事件','議題','標題','event','topic','title'])||e.name,描述:projText(e.raw,['描述','說明','description','content']),分類:projText(e.raw,['分類','category','type'])||projList(e.raw,['類型','types']).join('、'),角度:a,陣營:c,關鍵字:kw,人物:pp,地名:pl,videoId:ids});
 }
 return {媒體數:channels.size,videos,角度:angle,陣營:camp,關鍵字:keywords,人物:people,地名:places,媒體明細:details};
}
/** PHP is_array($v) && $v !== [] for a JSON-decoded value. */
const phpNonEmptyArray=(v:unknown)=>Array.isArray(v)?v.length>0:record(v)&&Object.keys(v).length>0;
/** Broadcaster::usableDailyProjection over the cached urt_ai_date.data_json topic map. */
export function usableTopicCache(events:Pick<Event,'title'>[],topics:unknown):topics is Record<string,Record<string,unknown>> {
 if(!events.length||!record(topics)||!Object.keys(topics).length)return false;
 return events.every(e=>{const s=Object.hasOwn(topics,e.title)?topics[e.title]:null;return record(s)&&phpNonEmptyArray(s.videos)&&phpNonEmptyArray(s.媒體明細);});
}
/** Broadcaster::hydrateDailyEvents — a missing topic leaves an empty (incomplete) event, never an invented one. */
export function hydrateDaily(event:Event,stats:TopicStats|Record<string,unknown>|undefined):Event {
 const s:Record<string,unknown>=record(stats)?stats as Record<string,unknown>:{};
 const reports:MediaReport[]=(record(s.媒體明細)?Object.values(s.媒體明細):Array.isArray(s.媒體明細)?s.媒體明細:[]).filter(record).map(r=>({uId:Math.trunc(Number(r.u_id))||0,channel:phpTrim(phpString(r.媒體)),event:phpTrim(phpString(r.事件)),description:phpTrim(phpString(r.描述)),category:phpTrim(phpString(r.分類)),angle:phpTrim(phpString(r.角度)),camp:phpTrim(phpString(r.陣營)),keywords:scalarList(r.關鍵字),people:scalarList(r.人物),places:scalarList(r.地名),videoIds:scalarList(r.videoId),tags:[],group:'其他'}));
 const rawVideos=s.videos instanceof Map?[...s.videos.values()]:s.videos;
 const videoIds=scalarList(rawVideos);if(videoIds.length>500)throw new Error('notification_event_video_cap');
 if(videoIds.some(id=>!/^[A-Za-z0-9_-]{11}$/.test(id)))throw new Error('notification_video_identity_invalid');
 return {...event,mediaReports:reports,videoIds,videoCount:videoIds.length,mediaCount:Math.max(new Set(reports.map(r=>r.channel).filter(Boolean)).size,Math.trunc(Number(s.媒體數))||0),keywords:countedKeys(s.關鍵字),people:countedKeys(s.人物),places:countedKeys(s.地名),angle:countedKeys(s.角度,2).join('、'),camp:countedKeys(s.陣營,4).join('、'),category:mostCommon(reports.map(r=>r.category))};
}
function cachedTopics(row:RowDataPacket):unknown{const parse=(v:unknown)=>{if(typeof v!=='string'||!v.trim())return null;try{const d=json(v);return record(d)||Array.isArray(d)&&d.length?d:null;}catch{return null;}};const topic=parse(row.data_json),video=parse(row.video_json);return topic&&video?topic:null;}
/** Laravel AiTopicProjector drops a topic whose videos are not all present in urt_video, and caps the projection. */
async function projectedStats(db:Connection,byTitle:Map<string,TopicEntry[]>){
 const stats=new Map<string,TopicStats>();for(const[title,entries]of byTitle)if(entries.length&&!stats.has(title))stats.set(title,topicStats(entries));
 if(!stats.size)throw new Error('notification_daily_projection_empty');
 const ids=unique([...stats.values()].flatMap(s=>[...(s.videos as Map<number,string[]>).values()].flat()));if(ids.length>5000)throw new Error('notification_daily_projection_video_cap');
 if(ids.some(id=>!/^[A-Za-z0-9_-]{11}$/.test(id)))throw new Error('notification_video_identity_invalid');
 const[rows]=ids.length?await db.query<RowDataPacket[]>(`SELECT videoId FROM urt_video WHERE BINARY videoId IN (${ids.map(()=>'?').join(',')})`,ids):[[]];const present=new Set(rows.map(r=>String(r.videoId)));
 for(const[title,s]of[...stats])if([...(s.videos as Map<number,string[]>).values()].flat().some(id=>!present.has(id)))stats.delete(title);
 if(!stats.size)throw new Error('notification_daily_projection_videos_missing');
 return stats;
}
/** Prefer the cached topic projection exactly like Laravel; otherwise project the exact editorial topic→channel-event references. */
async function dailyEvents(db:Connection,row:RowDataPacket,events:Event[]):Promise<{events:Event[];runId:string|null}> {
 const cached=cachedTopics(row);
 if(usableTopicCache(events,cached)){
  const[runs]=await db.query<RowDataPacket[]>("SELECT run_id,result_json FROM ts_ai_runs WHERE workflow='ai.daily' AND target_pk=? AND status='published' ORDER BY updated_at DESC,run_id DESC",[row.pk]);
  const run=runs.find(r=>r.result_json===row.result_json);
  return {events:events.map(e=>hydrateDaily(e,cached[e.title])),runId:run?String(run.run_id):null};
 }
 const byTitle=new Map<string,TopicEntry[]>();
 if(row.data_type==='oneday'&&typeof row.user_token==='string'&&/^[A-Za-z0-9_-]{1,32}$/.test(row.user_token)){
  const source=await loadDailySource(db,String(row.date_from).slice(0,10),'all',String(row.user_token??'CLI'));
  if(source.pk!==String(row.pk))throw new Error('notification_daily_source_changed');
  for(const topic of source.topics){const title=legacyEventTitle(topic.title);if(!byTitle.has(title))byTitle.set(title,topic.media.map(m=>({uId:m.u_id,channel:m.channel,name:m.event.事件,raw:m.event as unknown as Record<string,unknown>})));}
  const stats=await projectedStats(db,byTitle);
  return {events:events.map(e=>hydrateDaily(e,stats.get(e.title))),runId:source.runId};
 }
 // Laravel's legacy todate rows share daily shape, but may not have TS journals.
 const [journals]=await db.query<RowDataPacket[]>("SELECT run_id FROM ts_ai_runs WHERE workflow='ai.daily' AND target_pk=? LIMIT 1",[row.pk]);
 if(journals.length)throw new Error('notification_todate_snapshot_unsupported');
 const channels=json(row.channel_id);if(!record(channels)||!Object.keys(channels).length||Object.keys(channels).length>100)throw new Error('notification_channel_map_invalid');
 const ids=Object.keys(channels).map(Number);if(ids.some(id=>!Number.isSafeInteger(id)||id<1)||new Set(Object.values(channels)).size!==ids.length)throw new Error('notification_channel_map_ambiguous');
 const [sources]=await db.query<RowDataPacket[]>(`SELECT pk,u_id,result_json FROM urt_channel_ai WHERE date_from=? AND date_to=? AND data_type=? AND BINARY user_token <=> BINARY ? AND del_flag IS NULL AND ctime<=? AND (mtime IS NULL OR mtime<=?) AND u_id IN (${ids.map(()=>'?').join(',')}) ORDER BY pk DESC`,[row.date_from,row.date_to,row.data_type,row.user_token,row.ctime,row.ctime,...ids]);
 const raw=list(row.result_json);
 events.forEach((event,index)=>{const item=raw[index];if(!record(item))throw new Error('notification_topic_invalid');const refs=get(item,['媒體事件','media_events','mediaEvents']);if(!record(refs)||!Object.keys(refs).length)throw new Error('notification_topic_references_missing');const entries=Object.entries(refs).flatMap(([channel,names])=>{const uId=Number(Object.keys(channels).find(k=>channels[k]===channel));const source=sources.find(s=>Number(s.u_id)===uId);if(!source)throw new Error('notification_channel_snapshot_missing');const channelEvents=list(source.result_json);return unique((Array.isArray(names)?names:[]).map(legacyEventTitle).filter(Boolean)).map(name=>{const found=channelEvents.filter(raw=>record(raw)&&normalizeEvent(raw,0).title===name);if(found.length!==1)throw new Error('notification_editorial_association_ambiguous');return {uId,channel,name,raw:found[0] as Record<string,unknown>};});});if(!entries.length)throw new Error('notification_topic_empty');if(!byTitle.has(event.title))byTitle.set(event.title,entries);});
 const stats=await projectedStats(db,byTitle);
 return {events:events.map(e=>hydrateDaily(e,stats.get(e.title))),runId:null};
}
const tagPriority=(name:string)=>groups.slice(0,4).includes(name)?1:groups.includes(name)?2:['台灣立場','中國立場'].includes(name)?3:9;
/** Laravel sorts sprintf('%02d:%s') strings byte-wise; code-unit order matches UTF-8 byte order in the BMP. */
const byteOrder=(a:string,b:string)=>a<b?-1:a>b?1:0;
export async function enrichEvent(db:Connection,event:Event,cfg:Config):Promise<Event> {
 if(!event.videoIds.length)return event;
 const [rows]=await db.query<RowDataPacket[]>(`SELECT v.videoId,v.title,v.u_id,v.channelTitle,v.viewCount,v.publishedAt,c.title channel_name,n.tags FROM urt_video v LEFT JOIN urt_channel c ON c.u_id=v.u_id LEFT JOIN urt_count n ON n.u_id=v.u_id WHERE BINARY v.videoId IN (${event.videoIds.map(()=>'?').join(',')}) ORDER BY v.pk`,event.videoIds);
 if(new Set(rows.map(r=>r.videoId)).size!==rows.length)throw new Error('notification_source_duplicate_video');
 const [tags]=await db.query<RowDataPacket[]>('SELECT tag_id,tag_name FROM urt_tag');const tagNames=new Map(tags.map(t=>[String(t.tag_id),text(t.tag_name)]));
 const videos:Video[]=event.videoIds.flatMap((id,position)=>{const row=rows.find(r=>r.videoId===id);if(!row)return [];const names=unique([...String(row.tags??'').matchAll(/\[(\d+)\]/g)].map(m=>tagNames.get(String(Number(m[1])))??'').filter(v=>v&&!['排除','未分類'].includes(v))).sort((a,b)=>tagPriority(a)-tagPriority(b)||byteOrder(a,b)).slice(0,cfg.tagLimit);const views=row.viewCount===null?null:Number(row.viewCount);if(views!==null&&(!Number.isSafeInteger(views)||views<0))throw new Error('notification_counter_out_of_range');return [{videoId:id,title:text(row.title),uId:Number(row.u_id),channel:text(row.channelTitle)||text(row.channel_name),tags:names,group:groups.find(g=>names.includes(g))??'其他',views,publishedAt:String(row.publishedAt??''),url:'https://www.youtube.com/watch?v='+encodeURIComponent(id),position}];});
 // A video that is missing from urt_video is skipped like Laravel's enricher (the event may become incomplete);
 // a present video owned by another channel than its editorial report is corrupt source data and fails closed.
 for(const r of event.mediaReports)for(const id of r.videoIds){const v=videos.find(v=>v.videoId===id);if(v&&v.uId!==r.uId)throw new Error('notification_editorial_video_owner_mismatch');}
 const reports=event.mediaReports.map(r=>{const v=videos.find(v=>v.uId===r.uId);return {...r,tags:v?.tags??[],group:v?.group??'其他'};});
 videos.sort((a,b)=>(b.views??-1)-(a.views??-1)||a.position-b.position);
 const mediaKeys=new Set(videos.map(v=>v.uId>0?'u:'+v.uId:v.channel?'c:'+v.channel:'').filter(Boolean));
 return {...event,videos,mediaReports:reports,mediaCount:Math.max(event.mediaCount,mediaKeys.size)};
}
export async function loadContext(db:Connection,period:Period,cfg:Config):Promise<Context|null> {
 const table=period==='daily'?'urt_ai_date':'urt_ai_hour';
 const [rows]=await db.query<RowDataPacket[]>(`SELECT * FROM ${table} WHERE del_flag IS NULL AND (condition_type IS NULL OR condition_type='all') ${period==='daily'?"AND data_type IN ('oneday','todate')":''} ORDER BY date_from DESC,pk DESC LIMIT 1`);
 const row=rows[0];if(!row)return null;if(typeof row.date_from!=='string'||typeof row.date_to!=='string')throw new Error('Notifications require dateStrings:true');
 let events=list(row.result_json).map(normalizeEvent),runId:string|null=null;
 if(new Set(events.map(e=>e.title)).size!==events.length)throw new Error('notification_event_titles_ambiguous');
 if(period==='daily'){const daily=await dailyEvents(db,row,events);events=daily.events;runId=daily.runId;}else{const[runs]=await db.query<RowDataPacket[]>("SELECT * FROM ts_ai_runs WHERE workflow='ai.hourly' AND target_pk=? ORDER BY updated_at DESC",[row.pk]);if(runs.length){const run=runs.find(r=>r.status==='published'&&r.result_json===row.result_json);if(!run)throw new Error('notification_hourly_snapshot_unavailable');const snapshot=json(run.input_json);if(!record(snapshot)||!record(snapshot.plan)||typeof snapshot.model!=='string')throw new Error('notification_hourly_snapshot_invalid');const plan=snapshot.plan as unknown as Plan;if(plan.table!=='urt_ai_hour'||plan.key.date_from!==row.date_from||plan.key.date_to!==row.date_to||sourceIdentity(plan,snapshot.model)!==run.input_sha256)throw new Error('notification_hourly_snapshot_corrupt');runId=String(run.run_id);}}
 const enriched:Event[]=[];for(const event of events)enriched.push(await enrichEvent(db,event,cfg));
 const groupsCount=(e:Event)=>new Set(e.videos.map(v=>v.group).filter(g=>g!=='其他')).size,views=(e:Event)=>e.videos.reduce((n,v)=>n+(v.views??0),0);
 enriched.sort((a,b)=>period==='daily'?b.mediaCount-a.mediaCount||b.videoCount-a.videoCount||groupsCount(b)-groupsCount(a)||views(b)-views(a)||a.position-b.position:b.videoCount-a.videoCount||b.mediaCount-a.mediaCount||a.position-b.position);
 const date=row.date_from.slice(0,10),snapshot={table,pk:String(row.pk),result:row.result_json,from:row.date_from,to:row.date_to,runId,events:enriched};
 // Polling may refresh counters during inference; editorial text, membership and ownership remain pinned.
 const stable=enriched.map(e=>({...e,videos:e.videos.map(({views,...v})=>v).sort((a,b)=>a.videoId.localeCompare(b.videoId))})).sort((a,b)=>a.position-b.position);
 const sourceHash=hash(JSON.stringify({...snapshot,events:stable})),snapshotHash=hash(JSON.stringify(snapshot));
 return {period,key:period==='daily'?'d:'+date:'h:'+row.date_from,label:period==='daily'?date:date+' '+row.date_from.slice(11,13)+'時',url:cfg.dashboard+(period==='daily'?'/ai/days/'+date:'/ai/hours?date='+date),dateFrom:row.date_from,dateTo:row.date_to,sourceTable:table,sourcePk:String(row.pk),sourceHash,snapshotHash,aiRunId:runId,events:enriched};
}
