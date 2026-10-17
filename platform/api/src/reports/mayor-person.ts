import {createHash} from 'node:crypto';
import {sql} from 'drizzle-orm';
import type {Reader,Row} from '../db/client.js';
import {aiOutputFields,aiPublication,publicationVisible,publicationCoverage,publicationNote} from './ai-publication.js';
import {inspectReportRows,cacheLineageNote,cacheWindowNotes} from './cache-lineage.js';
import {BadQuery,NotFound,bounded,dateFilter,page,search,type Query} from './query.js';
import {integer,latest,list,object,taipeiDate,text,timestamp} from './normalize.js';
import {link,table,weights,type Register} from './table.js';
import {ReportReadBound} from './cache-weights.js';
import {cities} from './city-definitions.js';
import {MAYOR_TAGS,MAYOR_METRICS,mayorMetric,mayorReadBudget,readMayorBuckets,mayorObservations,type MayorBuckets,type MayorMetric} from './mayor.js';

const labels=['泛藍','泛綠','泛紅','泛白'],shift=(date:string,days:number)=>new Date(Date.parse(date)+days*86400000).toISOString().slice(0,10);
const safeSum=(values:number[])=>{const n=values.reduce((a,b)=>a+b,0);if(!Number.isFinite(n)||Math.abs(n)>Number.MAX_SAFE_INTEGER)throw new ReportReadBound('Mayor person total exceeds numeric precision.');return n;};
const valueAt=(source:Pick<MayorBuckets,'byDate'>,date:string,tag:string,name:string)=>{const bucket=source.byDate.get(date)?.get(tag);return bucket?(bucket.get(name)??0):null;};

/** Descriptive observation only; no political factors, posture or strategic recommendations. */
export function mayorPersonSummary(date:string,name:string,candidates:string[],source:Pick<MayorBuckets,'byDate'>){
 const daily=(day:string)=>{const values=MAYOR_TAGS.map(tag=>valueAt(source,day,tag,name)),known=values.filter((v):v is number=>v!==null),observedTotal=known.length?safeSum(known):null;return{date:day,values,observedCategories:known.length,complete:known.length===4,observedTotal,total:known.length===4?observedTotal:null};};
 const today=daily(date),previous=daily(shift(date,-1)),row=mayorObservations([date],candidates,source)[0]!,candidateInConfiguration=candidates.includes(name),observedBuckets=Number(row.observedBuckets);
 const largest=Math.max(0,...today.values.filter((v):v is number=>v!==null)),largestObservedCategories=largest>0?today.values.flatMap((value,i)=>value===largest?[labels[i]!]:[]):[];
 // The city denominator includes only its maintained historical candidate set.
 const rollingValue=candidateInConfiguration?row[name] as number|null:observedBuckets?safeSum(Array.from({length:7},(_,i)=>MAYOR_TAGS.map(tag=>valueAt(source,shift(date,-i),tag,name))).flat().filter((v):v is number=>v!==null)):null;
 return{daily:today,previous,change:today.total!==null&&previous.total!==null?safeSum([today.total,-previous.total]):null,largestObservedCategories,
  rolling:{from:shift(date,-6),to:date,value:rollingValue,cityTotal:row.total as number|null,sharePercent:candidateInConfiguration?row[`${name}：占比`] as number|null:null,candidateInConfiguration,observedBuckets,expectedBuckets:28,complete:observedBuckets===28}};
}
export function mayorPersonNarrative(summary:ReturnType<typeof mayorPersonSummary>,unit:string,videoCount:number){
 const {daily,previous,rolling}=summary,notes:string[]=[];
 notes.push(daily.observedTotal===null?`${daily.date} 尚無可核對的分類日觀測，不能判定為零。`:`${daily.date} 已觀測 ${daily.observedCategories}/4 個分類，${unit}合計 ${daily.observedTotal}；${daily.complete?'四個分類均有紀錄。':'其餘分類未取得有效紀錄，這不是完整單日總量。'}`);
 if(summary.change===null)notes.push(`${previous.date} 與當日未同時具備四個分類，整體日差暫不計算。`);
 else notes.push(`相較 ${previous.date} 的同範圍${unit}，${summary.change===0?'持平':summary.change>0?`增加 ${summary.change}`:`減少 ${Math.abs(summary.change)}`}。`);
 if(summary.largestObservedCategories.length)notes.push(`已觀測分類中，${summary.largestObservedCategories.join('、')}${summary.largestObservedCategories.length>1?'並列':''}記錄量最高；分類可重疊。`);
 notes.push(`${rolling.from}～${rolling.to} 的七日範圍已有 ${rolling.observedBuckets}/28 個分類日桶；${rolling.complete?'所有桶均有紀錄。':'缺少的桶不補零。'}`);
 if(!rolling.candidateInConfiguration)notes.push('此人物不在該縣市的歷史設定名單中，七日人物占比不計算。');
 else if(rolling.sharePercent!==null)notes.push(`依已觀測的原始量，此人物占歷史名單合計 ${Number(rolling.sharePercent.toFixed(2))}%；${rolling.cityTotal===0?'名單合計為零，依縣市報表約定顯示 0%。':''}這是媒體引用量占比，不是支持度或民調。`);
 notes.push(`本頁列出 ${videoCount} 部來源影片（最多 8 部），用於核對內容，不代表所有相關影片。`);
 return notes;
}

function videoIds(value:unknown):string[]{
 let decoded:unknown=value;if(typeof value==='string'){try{decoded=JSON.parse(value);}catch{return [];}}
 const o=object(decoded);for(const key of ['videos','videos_json','result','data'])if(Array.isArray(o[key]))decoded=o[key];
 const values=Array.isArray(decoded)?decoded.map(v=>typeof v==='string'?v:text(object(v).videoId??object(v).video_id??object(v).id)):Object.keys(object(decoded));
 if(values.length>1000)throw new ReportReadBound('Mayor person video references exceed1000.');return [...new Set(values.filter(v=>/^[A-Za-z0-9_-]{1,32}$/.test(v)))];
}
const lineage=(r:Row|undefined)=>JSON.stringify([r?._cacheLineage??null,r?._cacheWindow??null]);
async function personReferences(reader:Reader,date:string,name:string,budget:ReturnType<typeof mayorReadBudget>){
 const keys={the_date:date,tag:name},meta=(await reader.rows(sql`SELECT pk,ctime,mtime,COALESCE(OCTET_LENGTH(videos_json),0) AS video_bytes,COALESCE(OCTET_LENGTH(tags_json),0) AS tag_bytes,SHA2(COALESCE(videos_json,''),256) AS video_hash,SHA2(COALESCE(tags_json,''),256) AS tag_hash FROM urt_show_video_tag_date WHERE BINARY tag=BINARY ${name} AND the_date=${date} ORDER BY pk DESC LIMIT 1`))[0];
 const before=(await inspectReportRows(reader,'urt_show_video_tag_date',[{keys,row:meta}]))[0]!;
 if(!before.row)return{state:before.status,row:undefined};
 const size=Number(meta!.video_bytes)+Number(meta!.tag_bytes);if(Number(meta!.video_bytes)>131072||Number(meta!.tag_bytes)>131072)return{state:'oversized',row:undefined};
 if(size>budget.remaining)throw new ReportReadBound('Mayor person cache exceeds8MiB request budget.');budget.remaining-=size;
 const body=(await reader.rows(sql`SELECT pk,ctime,mtime,videos_json,tags_json FROM urt_show_video_tag_date WHERE pk=${meta!.pk} AND BINARY tag=BINARY ${name} AND the_date=${date} AND COALESCE(OCTET_LENGTH(videos_json),0)=${meta!.video_bytes} AND COALESCE(OCTET_LENGTH(tags_json),0)=${meta!.tag_bytes} AND SHA2(COALESCE(videos_json,''),256)=${meta!.video_hash} AND SHA2(COALESCE(tags_json,''),256)=${meta!.tag_hash} AND mtime <=> ${meta!.mtime} AND ctime <=> ${meta!.ctime} AND pk=(SELECT MAX(n.pk) FROM urt_show_video_tag_date n WHERE BINARY n.tag=BINARY ${name} AND n.the_date=${date}) LIMIT 1`))[0];
 if(!body||['video','tag'].some(kind=>createHash('sha256').update(text(body[kind==='video'?'videos_json':'tags_json'])).digest('hex')!==meta![kind+'_hash']))return{state:'changed',row:undefined};
 const after=(await inspectReportRows(reader,'urt_show_video_tag_date',[{keys,row:body}]))[0]!;
 if(!after.row||lineage(before.row)!==lineage(after.row))return{state:'changed',row:undefined};return{state:after.status,row:after.row};
}

export function registerMayorPerson(register:Register,reader:Reader,clock:()=>Date){
 const person=async(cityKey:string,name:string,q:Query,routeDate?:string)=>{
  const city=Object.hasOwn(cities,cityKey)?cities[cityKey]:undefined;if(!city)throw new NotFound();if(!name.trim()||name.length>100)throw new BadQuery('Invalid person name.');
  page(q);if(q.type!==undefined&&typeof q.type!=='string')throw new BadQuery('Person metric must be a single string.');
  if(routeDate&&q.date!==undefined&&q.date!==routeDate)throw new BadQuery('Person date conflicts with the route.');
  const now=clock(),today=taipeiDate(now),pattern=search(name)!,requested=dateFilter(routeDate??q.date),metric=mayorMetric(q.type),budget=mayorReadBudget();
  let date=requested,dateSource=requested?'explicit':'',lookupCoverage:MayorBuckets['coverage']|null=null,anchorPublication:Awaited<ReturnType<typeof aiPublication>>|null=null;
  if(!date&&q.today!==undefined){date=shift(today,-bounded(q.today,0,0,3650));dateSource='offset';}
  if(!date){
   // Inspect only the newest bounded candidate; a withheld revision never rescues an older AI anchor.
   const ai=(await reader.rows(sql`SELECT pk,city_key,person,the_date,user_token,${aiOutputFields} FROM urt_mayor_person_ai WHERE BINARY city_key=BINARY ${cityKey} AND BINARY person=BINARY ${name} AND del_flag IS NULL AND the_date BETWEEN ${shift(today,-364)} AND ${today} ORDER BY the_date DESC,pk DESC LIMIT 1`))[0];
   if(ai){anchorPublication=await aiPublication(reader,'ai.mayor_person',ai);if(publicationVisible(anchorPublication)){date=text(ai.the_date).slice(0,10);dateSource='stored-ai';}}
  }
  if(!date){
   const recent=await readMayorBuckets(reader,shift(today,-364),today,metric,budget);lookupCoverage=recent.coverage;
   // Exact keys, including recorded zero, choose a date; older revisions never rescue a latest gap.
   const matching=recent.records.filter(r=>Object.hasOwn(object(r.payload),name)).sort((a,b)=>text(b.the_date).localeCompare(text(a.the_date)));
   date=text(matching[0]?.the_date).slice(0,10)||null;if(date)dateSource='observed-signal';
  }
  if(!date){const video=(await reader.rows(sql`SELECT MAX(publishedAt) AS date FROM urt_video WHERE publishedAt>=${shift(today,-364)+' 00:00:00'} AND publishedAt<=${today+' 23:59:59'} AND (title LIKE ${pattern} ESCAPE '=' OR description LIKE ${pattern} ESCAPE '=')`))[0];date=text(video?.date).slice(0,10)||shift(today,-1);dateSource=text(video?.date)?'source-video':'yesterday';}
  dateFilter(date);const previous=shift(date,-1),source=await readMayorBuckets(reader,shift(date,-6),date,metric,budget),sources=new Map<MayorMetric,MayorBuckets>([[metric,source]]);
  for(const other of Object.keys(MAYOR_METRICS) as MayorMetric[])if(other!==metric)sources.set(other,await readMayorBuckets(reader,previous,date,other,budget));
  const summary=mayorPersonSummary(date,name,Object.keys(city.candidates),source);
  const signals=MAYOR_TAGS.map((tagid,i)=>{const selected=valueAt(source,date,tagid,name),prior=valueAt(source,previous,tagid,name);return{category:labels[i]!,views:valueAt(sources.get('tags_views')!,date,tagid,name),videos:valueAt(sources.get('tags_video')!,date,tagid,name),importance:valueAt(sources.get('tags_result')!,date,tagid,name),selected,previous:prior,change:selected!==null&&prior!==null?safeSum([selected,-prior]):null};});
  const references=await personReferences(reader,date,name,budget),cache=references.row,ids=videoIds(cache?.videos_json);
  const videoFields=sql`videoId,LEFT(title,512) AS title,publishedAt,viewCount,mtime,ctime`;
  let videos=ids.length?await reader.rows(sql`SELECT ${videoFields} FROM urt_video WHERE videoId IN (${sql.join(ids.map(id=>sql`${id}`),sql`,`)}) AND BINARY videoId IN (${sql.join(ids.map(id=>sql`${id}`),sql`,`)}) ORDER BY viewCount DESC,pk DESC LIMIT 8`):[];
  const sourceKind=videos.length?'詞彙日期快取引用':'標題／描述文字包含';
  if(!videos.length)videos=await reader.rows(sql`SELECT ${videoFields} FROM urt_video WHERE publishedAt>=${date+' 00:00:00'} AND publishedAt<=${date+' 23:59:59'} AND (title LIKE ${pattern} ESCAPE '=' OR description LIKE ${pattern} ESCAPE '=') ORDER BY viewCount DESC,pk DESC LIMIT 8`);
  const rawAi=(await reader.rows(sql`SELECT pk,city_key,person,the_date,user_token,ai_type,provider,${aiOutputFields},ctime,mtime FROM urt_mayor_person_ai WHERE BINARY city_key=BINARY ${cityKey} AND BINARY person=BINARY ${name} AND the_date=${date} AND del_flag IS NULL ORDER BY pk DESC LIMIT 1`))[0],publication=rawAi?await aiPublication(reader,'ai.mayor_person',rawAi):null,ai=publication&&publicationVisible(publication)?rawAi:undefined,payload=object(ai?.result_json);
  const records=[...sources.values()].flatMap(s=>s.records),unit=MAYOR_METRICS[metric];
  const notes=[cacheLineageNote,publicationNote,...cacheWindowNotes(records),...mayorPersonNarrative(summary,unit,videos.length),'人物名單沿用 2026-05-28 版本；新聞曝光和提及不是支持度。每日摘要只陳述觀測量與缺漏，不套用政治係數，也不提供選戰策略。',`影片來源：${sourceKind}；詞彙日期快取狀態：${references.state}。`,`來源日期：${date}；未指定日期時，訊號／影片最多回看 365 天。所有分類度量與引用快取共用 8 MiB 載入預算，分類每筆上限 128 KiB。`];
  if(publication&&!ai)notes.push(`AI 摘要暫不呈現（${publication.state}）；來源訊號與影片仍可查閱。`);
  if(ai){notes.push(`AI 來源紀錄 #${ai.pk}；模型 ${text(ai.ai_type)||'未記錄'}；供應者 ${text(ai.provider)||'未記錄'}。`);if(text(payload.summary))notes.push('AI 摘要：'+text(payload.summary).slice(0,4000));for(const item of list(payload.what_happened??payload.observations).slice(0,20))if(typeof item==='string')notes.push('來源觀察：'+item.slice(0,1000));}
  const rows=[...signals.map(s=>({kind:'分類日觀測',name:s.category,views:s.views,videos:s.videos,importance:s.importance,change:s.change,source:date})),...videos.map(v=>({kind:'來源影片',name:link(text(v.title),`/videos/${encodeURIComponent(text(v.videoId))}`),views:integer(v.viewCount),videos:null,importance:null,change:null,source:timestamp(v.publishedAt)}))];
  const result=table(`${city.label} ${name} 每日觀測`,[{key:'kind',label:'類別'},{key:'name',label:'分類／影片'},{key:'views',label:'觀看引用',kind:'number'},{key:'videos',label:'影片引用',kind:'number'},{key:'importance',label:'重要度',kind:'number'},{key:'change',label:'所選指標較前日差',kind:'number'},{key:'source',label:'日期'}],rows,q,{
   updatedAt:latest(...records.flatMap(r=>[r.mtime,r.ctime]),cache?.mtime,cache?.ctime,ai?.mtime,ai?.ctime,...videos.flatMap(v=>[v.mtime,v.ctime])),notes,
   metrics:[{label:'已觀測單日量',value:summary.daily.observedTotal,unit,detail:`${summary.daily.observedCategories}/4 個分類；缺漏不補零`},{label:'完整分類較前日差',value:summary.change,unit,detail:summary.change===null?'兩日分類未完整，不能比較':previous+' 至 '+date},{label:'七日已觀測原始量',value:summary.rolling.value,unit,detail:`${summary.rolling.observedBuckets}/28 個分類日桶`},{label:'七日已觀測名單占比',value:summary.rolling.sharePercent,unit:'%',detail:summary.rolling.candidateInConfiguration?'分母為該市歷史名單原始量；不是支持度':'人物不在該市歷史設定名單'},{label:'本頁來源影片',value:videos.length,unit:'部',detail:'最多 8 部，非全部相關影片'}],
   navigation:[{label:'前一日',href:`/mayor/cities/${cityKey}/people/${encodeURIComponent(name)}/days/${previous}?type=${metric}`},{label:'後一日',href:`/mayor/cities/${cityKey}/people/${encodeURIComponent(name)}/days/${shift(date,1)}?type=${metric}`},{label:'同日縣市觀測',href:`/mayor/cities/${cityKey}?from=${date}&to=${date}&type=${metric}`}],
   words:[...weights(cache?.tags_json)].filter(([term])=>term!==name).slice(0,100).map(([term,weight])=>({term,weight,href:`/keywords/${encodeURIComponent(term)}/videos`})),
   filters:[{key:'date',label:'日期',type:'date',value:date},{key:'type',label:'觀測度量',type:'select',value:metric,options:Object.entries(MAYOR_METRICS).map(([value,label])=>({value,label}))}]
  });
  return{...result,summary,evidenceCoverage:{ai:publicationCoverage(publication?[publication]:[]),dateAnchorAi:publicationCoverage(anchorPublication?[anchorPublication]:[]),date,dateSource,metric,signals:source.coverage,metrics:Object.fromEntries([...sources].map(([key,s])=>[key,s.coverage])),lookup:lookupCoverage,referenceCache:references.state,sourceByteBudget:8*1024*1024,sourceBytesPlanned:8*1024*1024-budget.remaining,dailyObservedCategories:summary.daily.observedCategories,previousObservedCategories:summary.previous.observedCategories,comparableDays:summary.change!==null,rollingObservedBuckets:summary.rolling.observedBuckets,rollingComplete:summary.rolling.complete,candidateInConfiguration:summary.rolling.candidateInConfiguration}};
 };
 register('/mayor/cities/:city/people/:person',(p,q)=>person(p.city,p.person,q));
 register('/mayor/cities/:city/people/:person/days/:date',(p,q)=>person(p.city,p.person,q,p.date));
}
