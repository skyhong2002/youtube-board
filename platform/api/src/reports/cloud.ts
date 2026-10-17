import {loadDerivedSource,derivedRow,derivedNote,type DerivedCoverage} from './derived-cache.js';
import {inspectReportRows,reportSelectionKeys,cacheWindowNotes,publicCacheWindow,cacheObservationTime,unknownViewVideos,unknownViewNotes,type CacheRead} from './cache-lineage.js';
import {sql} from 'drizzle-orm';
import type {Reader,Row} from '../db/client.js';
import {BadQuery,bounded,mergeTagId,positiveId,type Query} from './query.js';
import {latest,text,object,taipeiDate} from './normalize.js';
import {cacheFilters,table,type Register} from './table.js';
import {cacheWeights,CACHE_PAYLOAD_BYTES,ReportReadBound} from './cache-weights.js';
import {reportStopwords,stopwordNote} from './stopwords.js';
const longPeriod=(days:number)=>({1:3,3:7,7:30,30:90,90:365} as Record<number,number>)[days]??Math.min(365,days*3);
function windowDays(row:Row){const w=object(row._cacheWindow),from=text(w.from).slice(0,10),to=text(w.to).slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to))return null;const n=(Date.parse(to)-Date.parse(from))/86400000+1;return Number.isInteger(n)&&n>=1&&n<=366?{from,to,days:n}:null;}
export function cloudBaseline(short:CacheRead,long:CacheRead,days:number,longDays:number){
 if(short.status==='pending'||long.status==='pending')return {status:'withheld',ratio:null};
 if(!short.row)return {status:'missing-short',ratio:null};if(!long.row)return {status:'missing-baseline',ratio:null};
 if(short.status==='legacy'&&long.status==='legacy')return {status:'legacy-comparable',ratio:(longDays+1)/(days+1)};
 const a=short.lineage,b=long.lineage;if(short.status!==long.status||!a?.version||!a.rule||!a.coverage||a.version!==b?.version||a.rule!==b.rule||a.coverage!==b.coverage)return {status:'incompatible-lineage',ratio:null};
 const sw=windowDays(short.row),lw=windowDays(long.row);if(!sw||!lw||sw.to!==lw.to||sw.from<lw.from||sw.days>=lw.days||sw.days!==days||lw.days!==longDays)return {status:'incompatible-window',ratio:null};
 return {status:'published-comparable',ratio:lw.days/sw.days};
}
export function registerCloud(register:Register,reader:Reader,clock:()=>Date){
 const cloud=async(query:Query,subject:string,scope:{channel?:number;keyword?:string}={})=>{
  const now=clock();let derivedCoverage:DerivedCoverage|undefined;
  const requestedDays=bounded(query.days,scope.keyword?7:3,1,365);if(longPeriod(requestedDays)<=requestedDays)throw new BadQuery('Cloud comparison requires a shorter period than 365 days.');
  const stop=await reportStopwords(reader),memo=new Map<number,Promise<CacheRead>>();
  const load=(period:number)=>{let cached=memo.get(period);if(cached)return cached;cached=(async()=>{
   const name=scope.channel?'urt_show_cloud':scope.keyword?'urt_show_tag_cloud_tag':'urt_show_tag_cloud',field=scope.channel?'keywords_json':'tags_result',keys=scope.channel?{u_id:scope.channel,days:period}:{...reportSelectionKeys(query),...(scope.keyword?{tag:scope.keyword}:{}),days:period};
   const where=scope.channel?sql`u_id=${scope.channel} AND days=${period}`:sql`days=${period} AND ${cacheFilters(query)} ${scope.keyword?sql`AND BINARY tag=BINARY ${scope.keyword}`:sql``}`;
   const metadata=(await reader.rows(sql`SELECT pk,OCTET_LENGTH(${sql.identifier(field)}) AS payload_bytes FROM ${sql.identifier(name)} WHERE ${where} ORDER BY pk DESC LIMIT 1`))[0];
   if(Number(metadata?.payload_bytes)>CACHE_PAYLOAD_BYTES)throw new ReportReadBound('Cloud cache exceeds read budget');
   const row=metadata?(await reader.rows(sql`SELECT pk,ctime,mtime,${sql.identifier(field)} AS words FROM ${sql.identifier(name)} WHERE pk=${metadata.pk} LIMIT 1`))[0]:undefined;
   return (await inspectReportRows(reader,name,[{keys,row}]))[0]!;
  })();memo.set(period,cached);return cached;};
  const evaluate=(days:number,short:CacheRead,long:CacheRead)=>{const longDays=longPeriod(days),a=cacheWeights(short.row?.words),b=cacheWeights(long.row?.words),baseline=cloudBaseline(short,long,days,longDays);
   const malformed=a.status==='malformed'||b.status==='malformed',raw=(m:Map<string,number>)=>[...m].filter(([term])=>!stop.has(term)).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,200).map(([term,weight])=>({term,weight}));
   const rows=!malformed&&baseline.ratio!==null?[...a.words].filter(([term])=>!stop.has(term)).map(([term,short])=>({term,short,long:b.words.get(term)??0,score:short-(b.words.get(term)??0)/baseline.ratio!})).filter(r=>r.score>0).map(r=>({...r,short:Number(r.short.toFixed(3)),long:Number(r.long.toFixed(3)),score:Number(r.score.toFixed(3))})).sort((a,b)=>b.score-a.score||a.term.localeCompare(b.term)):[];
   return {days,longDays,short,long,baseline:malformed&&baseline.status!=='withheld'?{status:'malformed-cache',ratio:null}:baseline,rows,shortRows:raw(a.words),longRows:raw(b.words)};
  };
  const pair=async(days:number)=>evaluate(days,...await Promise.all([load(days),load(longPeriod(days))]) as [CacheRead,CacheRead]);
  let result=await pair(requestedDays);const requested=result;if(['legacy-comparable','published-comparable','missing-short','missing-baseline'].includes(result.baseline.status)&&!scope.channel&&!scope.keyword&&query.days===undefined&&result.rows.length===0){for(const days of [7,30]){const next=await pair(days);if(next.rows.length>=2){result=next;break;}}}
  if(!scope.channel&&!result.rows.length&&(!result.shortRows.length||!result.longRows.length)&&['legacy-comparable','published-comparable','missing-short','missing-baseline'].includes(result.baseline.status)){
   const to=taipeiDate(now),from=new Date(Date.parse(to)-(result.longDays-1)*86400000).toISOString().slice(0,10),source=await loadDerivedSource(reader,query,from,to,now,scope.keyword,!scope.keyword);derivedCoverage=source.coverage;
   if(source.coverage.status==='ready'){
    const shortFrom=new Date(Date.parse(to)-(result.days-1)*86400000).toISOString().slice(0,10),a=derivedRow(source,shortFrom,to,now,scope.keyword),b=derivedRow(source,from,to,now,scope.keyword);
    if(!a.row||!b.row)derivedCoverage.status=[a.reason,b.reason].includes('unknown-views')?'unknown-views':a.reason!=='ready'?a.reason:b.reason;
    else {memo.clear();const again=await pair(result.days);if(JSON.stringify([again.short,again.long])!==JSON.stringify([result.short,result.long]))derivedCoverage.status='cache-changed';else{const read=(row:import('../db/client.js').Row):CacheRead=>({status:'published',row,lineage:row._cacheLineage as import('./cache-lineage.js').CacheLineage});result=evaluate(result.days,read(a.row),read(b.row));derivedCoverage.status='derived';}}
   }
  }
  const {days,longDays,short,long,baseline,rows}=result,periods={short:publicCacheWindow(short.row?._cacheWindow),long:publicCacheWindow(long.row?._cacheWindow)},notes=[...(derivedCoverage?[derivedNote(derivedCoverage)]:[]),stopwordNote,derivedCoverage?.status==='derived'?'詞彙來自現行共享詞彙證據，權重由來源影片計算；這是即時計算結果。':'詞彙與權重沿用各筆快取的來源；舊快取尚無共享詞彙版本證據。',...cacheWindowNotes([short.row,long.row].filter((r):r is Row=>!!r)),...unknownViewNotes(unknownViewVideos([short.row]),'短期快取'),...unknownViewNotes(unknownViewVideos([long.row]),'長期快取')];
  for(const [label,read]of [['短期',short],['長期',long]] as const){const window=object(read.row?._cacheWindow);if(window.from&&window.to)notes.push(`${label}來源期間 ${text(window.from)}～${text(window.to)}，觀測截至台北時間 ${cacheObservationTime(window.observedUntil)??'未記錄'}。`);}if(short.status==='published'&&long.status==='published')notes.push(derivedCoverage?.status==='derived'?'比較依日曆天數正規化；兩個期間使用同一批現行證據，觀看值仍是當前累計觀測。':'比較依日曆天數正規化；兩份快取分別擷取，並非相同時刻的完整期間總量。');
  if(days!==requestedDays)notes.push(`預設 ${requestedDays} 天沒有可比較結果，改用 ${days} 天；明確指定期間不會自動切換。`);
  notes.push(baseline.ratio===null?'短長期基準缺失、發布受限、格式無效或版本／期間不相容，暫不提供相對排名；可讀取的原始權重另列。':`分數 = 短期權重 − 長期權重 ÷ ${baseline.ratio}；${baseline.status==='legacy-comparable'?'舊快取沿用 (長期+1)/(短期+1)':derivedCoverage?.status==='derived'?'依選定期間的實際日曆天數比例':'新版依快取記錄的實際日曆天數比例'}。`);
  return {...table(`${subject}${days} 天文字雲`,[{key:'term',label:'詞彙'},{key:'score',label:'相對權重',kind:'number'},{key:'short',label:`${days} 天權重`,kind:'number'},{key:'long',label:`${longDays} 天權重`,kind:'number'}],rows,query,{updatedAt:latest(short.row?.mtime,short.row?.ctime,long.row?.mtime,long.row?.ctime),words:rows.slice(0,200).map(r=>({term:r.term,weight:r.score,href:`/keywords/${encodeURIComponent(r.term)}/videos`})),notes,sections:[{key:'short',title:'短期原始權重',columns:[{key:'term',label:'詞彙'},{key:'weight',label:'權重',kind:'number'}],rows:result.shortRows},{key:'long',title:'長期原始權重',columns:[{key:'term',label:'詞彙'},{key:'weight',label:'權重',kind:'number'}],rows:result.longRows}]}),periods,evidenceCoverage:{derived:derivedCoverage??null,status:baseline.status,requestedStatus:requested.baseline.status,requestedShortStatus:requested.short.status,requestedLongStatus:requested.long.status,requestedDays,days,longDays,divisor:baseline.ratio,shortStatus:short.status,longStatus:long.status,shortVocabulary:short.lineage?.version??null,longVocabulary:long.lineage?.version??null,shortRule:short.lineage?.rule??null,longRule:long.lineage?.rule??null,shortUnknownViewVideos:unknownViewVideos([short.row]),longUnknownViewVideos:unknownViewVideos([long.row]),stopwordPolicy:'legacy-fixed+local-exclusions'}};
 };
 register('/channels/:id/cloud',(p,q)=>cloud(q,'頻道 ',{channel:positiveId(p.id)}));register('/tags/cloud',(_p,q)=>cloud(q,'分類 '));register('/tags/:id/cloud',(p,q)=>cloud({...q,tagid:mergeTagId(q.tagid,positiveId(p.id))},'分類 '));register('/keywords/:keyword/cloud',(p,q)=>cloud(q,p.keyword+' ',{keyword:p.keyword}));
}
