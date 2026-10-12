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
 return {title,description:text(get(raw,['描述','說明','description','content'])),category:text(category)||strings(category)[0]||'',angle:text(get(raw,['角度','angle'])),camp:text(get(raw,['陣營','camp','stance'])),keywords:strings(get(raw,['關鍵字','keywords'])),people:strings(get(raw,['人物','people'])),places:strings(get(raw,['地名','places'])),videoIds:ids,videoCount:ids.length,mediaCount:record(media)?Object.keys(media).length:0,position,videos:[],mediaReports:[]};
}
function report(uId:number,channel:string,event:Record<string,unknown>):MediaReport {const e=normalizeEvent(event,0);return {uId,channel,event:e.title,description:e.description,category:e.category,angle:e.angle,camp:e.camp,keywords:e.keywords,people:e.people,places:e.places,videoIds:e.videoIds,tags:[],group:'其他'};}
function hydrate(event:Event,reports:MediaReport[]):Event {
 const count=(key:'keywords'|'people'|'places')=>{const counts=new Map<string,number>();for(const r of reports)for(const v of r[key])counts.set(v,(counts.get(v)??0)+1);return [...counts].sort((a,b)=>b[1]-a[1]).slice(0,8).map(([v])=>v);};
 const dominant=(key:'category'|'angle'|'camp',limit=1)=>{const counts=new Map<string,number>();for(const r of reports)if(r[key])counts.set(r[key],(counts.get(r[key])??0)+r.videoIds.length);return [...counts].sort((a,b)=>b[1]-a[1]).slice(0,limit).map(([v])=>v).join('、');};
 const videoIds=unique(reports.flatMap(r=>r.videoIds));if(videoIds.length>500)throw new Error('notification_event_video_cap');
 return {...event,mediaReports:reports,videoIds,videoCount:videoIds.length,mediaCount:new Set(reports.map(r=>r.uId)).size,keywords:count('keywords'),people:count('people'),places:count('places'),category:dominant('category'),angle:dominant('angle',2),camp:dominant('camp',4)};
}
/** Preserve exact editorial topic→channel-event references; never resolve a newer channel snapshot. */
async function dailyEvents(db:Connection,row:RowDataPacket,events:Event[]):Promise<{events:Event[];runId:string|null}> {
 if(row.data_type==='oneday'&&typeof row.user_token==='string'&&/^[A-Za-z0-9_-]{1,32}$/.test(row.user_token)){
  const source=await loadDailySource(db,String(row.date_from).slice(0,10),'all',String(row.user_token??'CLI'));
  if(source.pk!==String(row.pk))throw new Error('notification_daily_source_changed');
  return {events:events.map(e=>{const topic=source.topics.find(t=>legacyEventTitle(t.title)===e.title);if(!topic)throw new Error('notification_topic_unresolved');return hydrate(e,topic.media.map(m=>report(m.u_id,m.channel,m.event as unknown as Record<string,unknown>)));}),runId:source.runId};
 }
 // Laravel's legacy todate rows share daily shape, but may not have TS journals.
 const [journals]=await db.query<RowDataPacket[]>("SELECT run_id FROM ts_ai_runs WHERE workflow='ai.daily' AND target_pk=? LIMIT 1",[row.pk]);
 if(journals.length)throw new Error('notification_todate_snapshot_unsupported');
 const channels=json(row.channel_id);if(!record(channels)||!Object.keys(channels).length||Object.keys(channels).length>100)throw new Error('notification_channel_map_invalid');
 const ids=Object.keys(channels).map(Number);if(ids.some(id=>!Number.isSafeInteger(id)||id<1)||new Set(Object.values(channels)).size!==ids.length)throw new Error('notification_channel_map_ambiguous');
 const [sources]=await db.query<RowDataPacket[]>(`SELECT pk,u_id,result_json FROM urt_channel_ai WHERE date_from=? AND date_to=? AND data_type=? AND BINARY user_token <=> BINARY ? AND del_flag IS NULL AND ctime<=? AND (mtime IS NULL OR mtime<=?) AND u_id IN (${ids.map(()=>'?').join(',')}) ORDER BY pk DESC`,[row.date_from,row.date_to,row.data_type,row.user_token,row.ctime,row.ctime,...ids]);
 const raw=list(row.result_json);
 return {events:events.map((event,index)=>{const item=raw[index];if(!record(item))throw new Error('notification_topic_invalid');const refs=get(item,['媒體事件','media_events','mediaEvents']);if(!record(refs)||!Object.keys(refs).length)throw new Error('notification_topic_references_missing');const reports=Object.entries(refs).flatMap(([channel,names])=>{const uId=Number(Object.keys(channels).find(k=>channels[k]===channel));const source=sources.find(s=>Number(s.u_id)===uId);if(!source)throw new Error('notification_channel_snapshot_missing');const channelEvents=list(source.result_json);return unique((Array.isArray(names)?names:[]).map(legacyEventTitle).filter(Boolean)).map(name=>{const found=channelEvents.filter(raw=>record(raw)&&normalizeEvent(raw,0).title===name);if(found.length!==1)throw new Error('notification_editorial_association_ambiguous');return report(uId,channel,found[0] as Record<string,unknown>);});});if(!reports.length)throw new Error('notification_topic_empty');return hydrate(event,reports);}),runId:null};
}
const tagPriority=(name:string)=>groups.slice(0,4).includes(name)?1:groups.includes(name)?2:['台灣立場','中國立場'].includes(name)?3:9;
export async function enrichEvent(db:Connection,event:Event,cfg:Config):Promise<Event> {
 if(!event.videoIds.length)return event;
 const [rows]=await db.query<RowDataPacket[]>(`SELECT v.videoId,v.title,v.u_id,v.channelTitle,v.viewCount,v.publishedAt,c.title channel_name,n.tags FROM urt_video v LEFT JOIN urt_channel c ON c.u_id=v.u_id LEFT JOIN urt_count n ON n.u_id=v.u_id WHERE BINARY v.videoId IN (${event.videoIds.map(()=>'?').join(',')}) ORDER BY v.pk`,event.videoIds);
 if(new Set(rows.map(r=>r.videoId)).size!==rows.length)throw new Error('notification_source_duplicate_video');
 const [tags]=await db.query<RowDataPacket[]>('SELECT tag_id,tag_name FROM urt_tag');const tagNames=new Map(tags.map(t=>[String(t.tag_id),text(t.tag_name)]));
 const videos:Video[]=event.videoIds.flatMap((id,position)=>{const row=rows.find(r=>r.videoId===id);if(!row)return [];const names=unique([...String(row.tags??'').matchAll(/\[(\d+)\]/g)].map(m=>tagNames.get(m[1]!)??'').filter(v=>v&&!['排除','未分類'].includes(v))).sort((a,b)=>tagPriority(a)-tagPriority(b)||a.localeCompare(b)).slice(0,cfg.tagLimit);const views=row.viewCount===null?null:Number(row.viewCount);if(views!==null&&(!Number.isSafeInteger(views)||views<0))throw new Error('notification_counter_out_of_range');return [{videoId:id,title:text(row.title),uId:Number(row.u_id),channel:text(row.channelTitle)||text(row.channel_name),tags:names,group:groups.find(g=>names.includes(g))??'其他',views,publishedAt:String(row.publishedAt??''),url:'https://www.youtube.com/watch?v='+encodeURIComponent(id),position}];});
 for(const r of event.mediaReports)for(const id of r.videoIds){const v=videos.find(v=>v.videoId===id);if(!v||v.uId!==r.uId)throw new Error('notification_editorial_video_owner_mismatch');}
 const reports=event.mediaReports.map(r=>{const v=videos.find(v=>v.uId===r.uId);return {...r,tags:v?.tags??[],group:v?.group??'其他'};});
 videos.sort((a,b)=>(b.views??-1)-(a.views??-1)||a.position-b.position);
 return {...event,videos,mediaReports:reports,mediaCount:Math.max(event.mediaCount,new Set(videos.map(v=>v.uId>0?'u:'+v.uId:'c:'+v.channel)).size)};
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
