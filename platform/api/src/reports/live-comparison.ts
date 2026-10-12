import {sql} from 'drizzle-orm';
import type {Reader,Row} from '../db/client.js';
import {BadQuery,NotFound,bounded,dateFilter,page,type Query} from './query.js';
import {integer,latest,taipeiDate,text} from './normalize.js';
import {cacheFilters,range,table,type Register} from './table.js';
import {publishedLiveTagCache,cacheWindowNotes,cacheLineageNote} from './cache-lineage.js';
import {sourceMap} from './source-map.js';
import {metricMap,hourlyPeak} from './live-cache-shapes.js';
import {groupDefinitions} from './group-definitions.js';
import {keywordGroupDefinitions} from './keyword-group-definitions.js';
import {legacyTagSets} from '../legacy/group-config.js';
type Kind='keyword'|'group';
type Metric='tags_views'|'tags_video';
type Group={name:string;filters:Query};
const DAY_BYTES=1024*1024,TOTAL_BYTES=16*1024*1024;
const shift=(date:string,days:number)=>new Date(Date.parse(date)+days*86400000).toISOString().slice(0,10);
function scalar(value:unknown,label:string){if(value===undefined)return undefined;if(typeof value!=='string'||value.length>64)throw new BadQuery('Invalid '+label);return value;}
export function liveComparisonOptions(kind:Kind,q:Query){
 page(q);const raw=scalar(q.type,'live metric')||'tags_views',aliases:Record<string,Metric>={views:'tags_views',tags_views:'tags_views',videos:'tags_video',count_videos:'tags_video',tags_video:'tags_video'};
 const metric=Object.hasOwn(aliases,raw)?(kind==='group'&&raw!=='tags_video'?'tags_views':aliases[raw]):undefined;if(!metric)throw new BadQuery('Unknown live metric.');
 const all=scalar(q.all,'all selection')?.toLowerCase();if(all!==undefined&&!['','0','false','off','no','1','true','on','yes'].includes(all))throw new BadQuery('Invalid all selection.');
 const includeAll=['1','true','on','yes'].includes(all??'');
 const requested=scalar(kind==='keyword'?(q.group??q.view):q.view,'comparison group')??'position',definitions=kind==='keyword'?groupDefinitions:keywordGroupDefinitions;
 const fallback=kind==='keyword'?'media':'position',normalized=requested.trim().replace(/[^A-Za-z0-9_]/g,'')||fallback,key=Object.hasOwn(definitions,normalized)?normalized:fallback;
 return {metric,key,requested,definition:definitions[key]!,definitions,includeAll,allExpansion:kind==='group'&&includeAll?'unavailable':'not-requested'};
}
export function liveComparisonPeriod(kind:Kind,q:Query,clock:()=>Date,latestDate?:string){
 q={...q};if(q.today==='')delete q.today;
 const days=bounded(q.days,kind==='keyword'?10:30,1,kind==='keyword'?90:120),today=bounded(q.today,0,0,kind==='keyword'?3650:365);
 const from=dateFilter(q.from),explicitTo=dateFilter(q.to),anchor=kind==='group'&&!from&&!explicitTo&&(q.today===undefined||q.today==='')?latestDate:undefined;
 const to=explicitTo??anchor??taipeiDate(new Date(+clock()-today*86400000));
 return range({...q,days:String(kind==='keyword'?days+1:days),from:from??undefined,to},clock,kind==='keyword'?11:30,kind==='keyword'?91:120);
}
async function mapLimited<T,R>(items:T[],fn:(item:T)=>Promise<R>):Promise<R[]>{const result:R[]=[];let next=0;await Promise.all(Array.from({length:Math.min(4,items.length)},async()=>{while(next<items.length){const index=next++;result[index]=await fn(items[index]!);}}));return result;}
type Source={group:Group;metadata:Row[];eligible:Row[];rows:Row[];days:Map<string,Map<string,number|null>>;withheld:number;oversized:number;budget:number;changed:number;malformed:number};
/** Select latest PK and inspect metadata before transferring any cache body. */
async function readSources(reader:Reader,groups:Group[],metric:Metric,from:string,to:string){
 const column=sql.identifier(metric);
 const sources:Source[]=await mapLimited(groups,async group=>{
  const metadata=await reader.rows(sql`SELECT pk,ctime,mtime,the_date,OCTET_LENGTH(${column}) AS payload_bytes FROM urt_show_live_tag_date WHERE pk IN(SELECT MAX(pk) FROM urt_show_live_tag_date WHERE ${cacheFilters(group.filters)} AND the_date BETWEEN ${from} AND ${to} GROUP BY the_date) ORDER BY the_date DESC,pk DESC LIMIT 127`);
  if(metadata.length>126)throw new BadQuery('Live comparison exceeds source-day bound.');
  const eligible=await publishedLiveTagCache(reader,metadata,group.filters);
  return {group,metadata,eligible,rows:[],days:new Map(),withheld:metadata.length-eligible.length,oversized:0,budget:0,changed:0,malformed:0};
 });
 let remaining=TOTAL_BYTES;const selected=new Set<Row>();
 for(const {source,row}of sources.flatMap(source=>source.eligible.map(row=>({source,row}))).sort((a,b)=>text(b.row.the_date).localeCompare(text(a.row.the_date)))){
  const bytes=integer(row.payload_bytes);if(bytes===null||bytes<1){source.malformed++;continue;}if(bytes>DAY_BYTES){source.oversized++;continue;}if(bytes>remaining){source.budget++;continue;}remaining-=bytes;selected.add(row);
 }
 await mapLimited(sources,async source=>{
  const approved=source.eligible.filter(r=>selected.has(r));if(!approved.length)return;
  // Hash only byte-budget-approved rows. A checksum observation anchors each body read.
  const identity=approved.map(r=>sql`(pk=${r.pk} AND mtime <=> ${r.mtime} AND OCTET_LENGTH(${column})=${r.payload_bytes})`);
  const hashes=await reader.rows(sql`SELECT pk,SHA2(CAST(${column} AS BINARY),256) AS payload_hash FROM urt_show_live_tag_date WHERE ${sql.join(identity,sql` OR `)} LIMIT 127`),byHash=new Map(hashes.map(r=>[Number(r.pk),r.payload_hash]));
  const predicates=approved.map(r=>sql`(pk=${r.pk} AND mtime <=> ${r.mtime} AND OCTET_LENGTH(${column})=${r.payload_bytes} AND SHA2(CAST(${column} AS BINARY),256)=${byHash.get(Number(r.pk))??null})`);
  const bodies=await reader.rows(sql`SELECT pk,${column} AS payload FROM urt_show_live_tag_date WHERE ${sql.join(predicates,sql` OR `)} LIMIT 127`),byPk=new Map(bodies.map(r=>[Number(r.pk),r]));
  const second=await publishedLiveTagCache(reader,approved,source.group.filters),byPublishedPk=new Map(second.map(r=>[Number(r.pk),r]));
  for(const r of approved){const body=byPk.get(Number(r.pk)),current=byPublishedPk.get(Number(r.pk));
   if(!current){source.withheld++;continue;}
   if(!body||JSON.stringify(current._cacheLineage)!==JSON.stringify(r._cacheLineage)||JSON.stringify(current._cacheWindow)!==JSON.stringify(r._cacheWindow)){source.changed++;continue;}
   if(!sourceMap(body.payload)){source.malformed++;continue;}
   source.days.set(text(r.the_date).slice(0,10),new Map(Object.entries(metricMap(body.payload)).map(([term,hours])=>[term,hourlyPeak(hours)])));source.rows.push({...r,...current});
  }
 });return sources;
}
export function registerLiveComparisons(register:Register,reader:Reader,clock:()=>Date){
 const report=async(kind:Kind,name:string,q:Query)=>{
  if(!name.trim()||name.length>240)throw new BadQuery('Invalid comparison term/group.');
  const options=liveComparisonOptions(kind,q);liveComparisonPeriod(kind,q,clock);
  let terms:string[],tagSetSource='literal-keyword';
  if(kind==='keyword')terms=[name.trim()];else{
   name=name.trim();const preset=name.startsWith('tags_')?name.replace(/[^A-Za-z0-9_]/g,''):null;
   if(preset){if(!Object.hasOwn(legacyTagSets,preset))throw new NotFound();name=preset;terms=legacyTagSets[preset]!;tagSetSource='LegacyGroupViewConfig reviewed embedded terms';}
   else{const records=await reader.rows(sql`SELECT MIN(tag) AS tag FROM tag_group WHERE group_name=${name} AND (del_flag IS NULL OR del_flag<'1') GROUP BY BINARY tag ORDER BY BINARY MIN(tag) LIMIT 201`);if(records.length>200)throw new BadQuery('Compare at most 200 stored terms.');terms=records.map(r=>text(r.tag)).filter(t=>t!==''&&t!=='0');tagSetSource='tag_group';}
  }
  terms=[...new Set(terms)];if(!terms.length)throw new NotFound();if(terms.length>200||terms.some(t=>t.length>240))throw new BadQuery('Compare 1–200 terms of at most 240 characters.');
  const groups=options.definition.groups;if(groups.length>20)throw new BadQuery('Compare at most 20 categories.');
  let latestDate:string|undefined;if(kind==='group'&&!dateFilter(q.from)&&!dateFilter(q.to)&&(q.today===undefined||q.today==='')){const dates=await mapLimited(groups,g=>reader.rows(sql`SELECT MAX(the_date) AS latest FROM urt_show_live_tag_date WHERE ${cacheFilters(g.filters)}`));latestDate=dates.map(r=>text(r[0]?.latest).slice(0,10)).filter(Boolean).sort().at(-1);}
  const period=liveComparisonPeriod(kind,q,clock,latestDate);if(terms.length*groups.length*period.dates.length>50000)throw new BadQuery('Narrow comparison to at most 50,000 category/term/day cells.');
  const sources=await readSources(reader,groups,options.metric,shift(period.from,-6),period.to),rows:Record<string,string|number|null>[]=[],chart=new Map<string,{time:string;value:number|null}[]>();let unsafeTotals=0;
  for(const [groupIndex,source]of sources.entries())for(const [termIndex,term]of terms.entries())for(const date of period.dates){
   let sum=0,observed=0;for(let offset=0;offset<7;offset++){const values=source.days.get(shift(date,-offset));if(!values)continue;const value=values.has(term)?values.get(term):0;if(value===null||value===undefined)continue;observed++;sum+=value;}
   const unsafe=!Number.isSafeInteger(sum);if(unsafe)unsafeTotals++;const value=observed&&!unsafe?sum:null;rows.push({group:source.group.name,term,date,value,observedDays:observed});const key=groupIndex+':'+termIndex,points=chart.get(key)??[];points.push({time:date,value});chart.set(key,points);
  }
  const path=kind==='keyword'?`/keywords/${encodeURIComponent(name)}/live/trends`:`/groups/${encodeURIComponent(name)}/live`,selector=kind==='keyword'?'group':'view';
  const params=(key:string)=>new URLSearchParams({[selector]:key,type:options.metric,from:period.from,to:period.to,...(options.includeAll?{all:'1'}:{})}).toString();
  const result=table(`${name}：${options.definition.label}直播七日趨勢`,[{key:'group',label:'頻道群組'},{key:'term',label:'詞彙'},{key:'date',label:'日期',kind:'date'},{key:'value',label:'七日每日峰值總和',kind:'number'},{key:'observedDays',label:'有快取日數',kind:'number'}],rows,q,{updatedAt:latest(...sources.flatMap(s=>s.rows.flatMap(r=>[r.mtime,r.ctime]))),series:sources.flatMap((s,i)=>terms.slice(0,12).map((term,j)=>({name:`${s.group.name}／${term}`,unit:options.metric==='tags_video'?'部':'人次',points:chart.get(i+':'+j)??[]}))),filters:[{key:selector,label:'頻道分類',type:'select',value:options.key,options:Object.entries(options.definitions).map(([value,d])=>({value,label:d.label}))},{key:'type',label:'觀測度量',type:'select',value:options.metric,options:[{value:'tags_views',label:'每日每小時峰值加總'},{value:'tags_video',label:'直播影片數峰值加總'}]},{key:'from',label:'起日',type:'date',value:period.from},{key:'to',label:'迄日',type:'date',value:period.to}],navigation:Object.entries(options.definitions).map(([key,d])=>({label:d.label,active:key===options.key,href:path+'?'+params(key)})),notes:[cacheLineageNote,...cacheWindowNotes(sources.flatMap(s=>s.rows)),'每日值為該詞每小時觀測峰值；七日值累加當日與前六日。這不是同時在線人數、不重複觀眾或累計觀看。分類可重疊，彼此不相加。','完整有效的空快取或缺少該詞才記為 0；快取、詞彙時段資料缺漏或未發布時保留空值與涵蓋日數。圖表只顯示前 12 詞。','資料量過大、讀取中更新或格式不完整的日期暫不顯示；可縮短日期範圍後再查詢。',...(kind==='group'?['頻道分類沿用已知的預設設定；舊站的自訂分類設定尚未取得，因此可能與當時顯示的分類不同。']:[]),...(options.allExpansion==='unavailable'?['尚未取得此群組「包含全部」的額外分類設定；目前僅顯示已知分類，未推定額外組合。']:[])]});
  return {...result,period,evidenceCoverage:{metric:options.metric,requestedGroup:options.requested,group:options.key,definitionSource:kind==='keyword'?'LegacyLiveGroupDefinitions':'LegacyKeywordGroupDefinitions embedded fallback',fileDefinitions:kind==='group'?'unavailable':'not-applicable',tagSetSource,includeAllRequested:options.includeAll,allExpansion:options.allExpansion,requestedDates:period.dates.length,sourceFrom:shift(period.from,-6),sourceTo:period.to,unsafeTotals,groups:sources.map(s=>({name:s.group.name,selectedDays:s.metadata.length,observedDays:s.days.size,withheldDays:s.withheld,oversizedDays:s.oversized,budgetExceededDays:s.budget,changedDays:s.changed,malformedDays:s.malformed}))}};
 };
 register('/keywords/:keyword/live/trends',(p,q)=>report('keyword',p.keyword,q));
 register('/groups/:name/live',(p,q)=>report('group',p.name,q));
}
