import {metricPeriod,metricType,metricFilters,metricPeriodNote} from './metric-period.js';
import {observedMetric} from './observed-metrics.js';
import {loadDerivedSource,initialDerivedCoverage,derivedDayGuard,derivedNote,DERIVED_RULE,tagMetricsFromEvidence,keywordDayFromEvidence,type DerivedCoverage} from './derived-cache.js';
import { publishedTagCache, inspectReportRows, cacheWindowNotes, cacheLineageNote, unknownViewVideos, unknownViewNotes } from './cache-lineage.js';
import { sql } from 'drizzle-orm';
import { DataSourceUnavailable,type Reader,type Row } from '../db/client.js';
import { BadQuery, bounded, mergeTagId, positiveId, type Query } from './query.js';
import { integer, latest, text,taipeiDate } from './normalize.js';
import {dayRanking,diffEnabled} from './day-ranking.js';
import {reportStopwords,stopwordNote} from './stopwords.js';
import {CACHE_PAYLOAD_BYTES,ReportReadBound} from './cache-weights.js';
import { cacheFilters, weights, range, table, type Register } from './table.js';
/** Presentation names only; filters and evidenceCoverage.metric keep the raw metric key. */
export const trendSeriesLabels:Record<string,string>={total_views:'七日已知累計觀看加總',count_videos:'七日已知影片數',average:'七日已知資料每部影片累計觀看'};
export function registerTagDays(register: Register, reader: Reader, clock: () => Date) {
    const daily = async (q: Query, keyword?: string, trend = false) => {
        const now=clock();let derivedCoverage:DerivedCoverage|undefined;
        q={...q};for(const key of ['days','from','to','today'])if(q[key]==='')delete q[key];
        const requestedType=q.type==='tags_view'?'tags_views':text(q.type);
        if (keyword && requestedType === 'tags_views')throw new BadQuery('Keyword daily cache stores co-occurrence counts, not view totals.');
        // Legacy day selector is an offset: days=7 includes today and seven preceding dates.
        const trendType=trend?metricType(q.type,'tag'):null,trendPeriod=trend?metricPeriod(q,()=>now,'tag'):null;
        const period=trendPeriod??range({...q,days:String(bounded(q.days,7,1,90)+1)},()=>now,7,91),cacheFrom=trendPeriod?.cacheFrom??period.from;
        const sourceTable=keyword?'urt_show_video_tag_date':'urt_show_tag_date',where=sql`the_date BETWEEN ${cacheFrom} AND ${period.to} ${keyword?sql`AND BINARY tag=BINARY ${keyword}`:sql`AND ${cacheFilters(q)}`}`;
        const latestIds=sql`SELECT MAX(pk) FROM ${sql.identifier(sourceTable)} WHERE ${where} GROUP BY the_date`;
        const payload=trend?sql`0`:keyword?sql`OCTET_LENGTH(tags_json)`:sql`COALESCE(OCTET_LENGTH(tags_result),0)+COALESCE(OCTET_LENGTH(tags_video),0)+COALESCE(OCTET_LENGTH(tags_views),0)`;
        const sizes=(await reader.rows(sql`SELECT COUNT(*) AS source_rows,COALESCE(SUM(${payload}),0) AS payload_bytes,MAX(${payload}) AS largest FROM ${sql.identifier(sourceTable)} WHERE pk IN (${latestIds})`))[0];
        if(Number(sizes?.source_rows)>400||Number(sizes?.payload_bytes)>16*1024*1024||Number(sizes?.largest)>CACHE_PAYLOAD_BYTES)throw new ReportReadBound('Daily cache exceeds read budget');
        const loadSources=()=>trend?reader.rows(sql`SELECT pk,ctime,mtime,the_date,count_channels,count_videos,total_views FROM urt_show_tag_date WHERE pk IN (${latestIds}) ORDER BY the_date LIMIT 401`):keyword?reader.rows(sql`SELECT pk,ctime,mtime,the_date,count_channels,count_videos,tags_json AS tags_result FROM urt_show_video_tag_date WHERE pk IN (${latestIds}) ORDER BY the_date`):reader.rows(sql`SELECT pk,ctime,mtime,the_date,count_channels,count_videos,total_views,tags_result,tags_video,tags_views FROM urt_show_tag_date WHERE pk IN (${latestIds}) ORDER BY the_date`);
        const sourceRecords=await loadSources();
        const actualBytes=sourceRecords.reduce((total,r)=>total+['tags_result','tags_video','tags_views'].reduce((n,k)=>n+(typeof r[k]==='string'?Buffer.byteLength(r[k]):0),0),0);if(actualBytes>16*1024*1024)throw new ReportReadBound('Daily cache exceeds read budget');
        if(sourceRecords.length>400)throw new ReportReadBound('Daily cache selection exceeds read budget');
        const records=keyword?(await inspectReportRows(reader,sourceTable,sourceRecords.map(row=>({keys:{the_date:text(row.the_date).slice(0,10),tag:keyword},row})))).flatMap(r=>r.row?[r.row]:[]):await publishedTagCache(reader,sourceRecords,q);
        const byDate = new Map<string, typeof records[number]>();
        for (const r of records) {
            const d = text(r.the_date).slice(0, 10);
            if (!byDate.has(d))
                byDate.set(d, r);
        }
        let updatedAt = latest(...records.flatMap(r => [r.mtime, r.ctime]));
        if (trend) {
            const type=trendType!;
            const rows=period.dates.map(date=>{const window=Array.from({length:7},(_,i)=>byDate.get(new Date(Date.parse(date)-i*86400000).toISOString().slice(0,10))),observed=window.filter(Boolean).length,views=observedMetric(window.map(r=>r?.total_views)),videos=observedMetric(window.map(r=>r?.count_videos)),average=observed>0&&views.knownDays===observed&&videos.knownDays===observed&&videos.sum?views.sum!/videos.sum:null;
                return {date,observedDays:observed,viewsKnownDays:views.knownDays,videosKnownDays:videos.knownDays,views:views.sum,videos:videos.sum,average,value:type==='count_videos'?videos.sum:type==='average'?average:views.sum};});
            return {...table('分類七日移動趨勢',[{key:'date',label:'日期',kind:'date'},{key:'views',label:'七日已知累計觀看加總',kind:'number'},{key:'videos',label:'七日已知影片數',kind:'number'},{key:'average',label:'每部影片觀看',kind:'number'},{key:'observedDays',label:'有快取日數',kind:'number'},{key:'viewsKnownDays',label:'觀看有值日數',kind:'number'},{key:'videosKnownDays',label:'影片有值日數',kind:'number'}],rows,q,{updatedAt,series:[{name:trendSeriesLabels[type]??type,unit:type==='count_videos'?'部':'次',points:rows.map(r=>({time:r.date,value:r.value}))}],filters:metricFilters(q,trendPeriod!,type),notes:[cacheLineageNote,...cacheWindowNotes(records),...unknownViewNotes(unknownViewVideos(records)),metricPeriodNote(trendPeriod!),'每點包含當日與前六日的已知值；缺日和未知欄位不補零，未滿七日為部分觀測。平均只在有快取的每一天都同時有觀看與影片值時提供。觀看是影片累計觀測，不是每日新增觀看。']}),period:{from:period.from,to:period.to},evidenceCoverage:{from:period.from,to:period.to,startBoundary:'inclusive',requestedDays:period.dates.length,todayOffset:trendPeriod!.today,withheldDates:sourceRecords.length-records.length,unknownViewVideos:unknownViewVideos(records),metric:type}};
        }
        const field=keyword?'tags_result':['tags_result','tags_video','tags_views'].includes(requestedType)?requestedType:'tags_result',stop=await reportStopwords(reader),requestedDiff=diffEnabled(q.diff),withheld=new Set(sourceRecords.map(r=>text(r.the_date).slice(0,10)).filter(date=>!byDate.has(date))),initialRanking=dayRanking(period.dates,byDate,field,requestedDiff,stop,!!keyword,withheld);let ranking=initialRanking;
        if(!ranking.rows.length&&ranking.comparable&&!ranking.malformedDates.length&&!withheld.size){
         try {
         const guard=await derivedDayGuard(reader,q,period.dates,keyword);
         if(!guard.blocked){const source=await loadDerivedSource(reader,keyword?{}:q,period.from,period.to,now,keyword,!keyword);derivedCoverage=source.coverage;
          if(source.coverage.status==='ready'){
           if(!keyword&&source.coverage.unknownViewVideos)derivedCoverage.status='unknown-views';
           else {const after=await derivedDayGuard(reader,q,period.dates,keyword),freshSources=await loadSources();
            if(after.blocked||after.signature!==guard.signature||JSON.stringify(freshSources)!==JSON.stringify(sourceRecords))derivedCoverage.status='cache-changed';
            else {derivedCoverage.replacedCacheDates=records.map(r=>text(r.the_date).slice(0,10));derivedCoverage.cacheUpdatedAt=updatedAt;byDate.clear();for(const date of period.dates){const videos=source.videos.filter(v=>v.publishedAt.slice(0,10)===date);if(!videos.length)continue;const metrics=keyword?keywordDayFromEvidence(videos,keyword):{...tagMetricsFromEvidence(videos),count_channels:source.channelCount};if(keyword&&!metrics.count_videos)continue;byDate.set(date,{...metrics,tags_result:'tags_json' in metrics?metrics.tags_json:metrics.tags_result,the_date:date,mtime:source.coverage.updatedAt,_derived:true,_cacheLineage:{version:source.coverage.version,coverage:source.coverage.coverage,rule:DERIVED_RULE},_cacheWindow:{from:date,to:date,closed:date<taipeiDate(now),observedUntil:source.coverage.updatedAt}});}
             ranking=dayRanking(period.dates,byDate,field,requestedDiff,stop,!!keyword);updatedAt=source.coverage.updatedAt;derivedCoverage.status='derived';}
           }
          }
         }
         } catch(error) {
          if(!(error instanceof ReportReadBound)&&!(error instanceof DataSourceUnavailable))throw error;
          derivedCoverage??=initialDerivedCoverage(keyword);derivedCoverage.status='unavailable';derivedCoverage.reason=error instanceof ReportReadBound?'read-budget':'data-source-unavailable';
         }
        }
        const unknownViews=derivedCoverage?.status==='derived'?0:unknownViewVideos(records),dateColumns=period.dates.map(date=>({key:date,label:date})),notes=[...(derivedCoverage?[derivedNote(derivedCoverage),...(derivedCoverage.replacedCacheDates?.length?[`原有 ${derivedCoverage.replacedCacheDates.length} 日快取經排除詞彙後整份排行為空；已整段改用來源影片計算，每日總量也隨來源更新。原快取日期：${derivedCoverage.replacedCacheDates.join('、')}。`]:[])]:[]),cacheLineageNote,...cacheWindowNotes(records),...unknownViewNotes(unknownViews),stopwordNote,'days 沿用舊版的往前日數：7 代表今天加前七天，共八個日期；明確 from/to 包含兩端。',ranking.diff?'差值 = 當日值 − 該詞期間合計 ÷ 選定日期數；缺失日期仍保留於平均分母。':'顯示當日原值。',...(requestedDiff&&!ranking.comparable?['期間含不同或未知的詞彙版本／匹配規則，或無法解析的詞彙快取；停用跨日差值與期間合計，只顯示各日原值。']:[]),...(ranking.malformedDates.length?[`${ranking.malformedDates.length} 個日期的詞彙快取無法解析；每日總量另依原始欄位呈現。`]:[]),'觀看為影片累計觀測，不是每日觀看增量；關鍵字共現來源沒有觀看總量。',`有來源資料 ${byDate.size} 日，選定 ${period.dates.length} 日；缺失不代表零。`];
        return {...table(`${keyword??'分類'}逐日排行`,[{key:'date',label:'日期',kind:'date'},{key:'rank',label:'名次',kind:'number'},{key:'term',label:'詞彙'},{key:'value',label:ranking.diff?'相對期間平均差':'當日原值',kind:'number'},{key:'dailyValue',label:'當日原值',kind:'number'},{key:'periodTotal',label:'該詞期間合計',kind:'number'}],ranking.rows,q,{updatedAt,notes,sections:[{key:'rank-matrix',title:'逐日排名對照',columns:[{key:'rank',label:'名次',kind:'number'},...dateColumns],rows:ranking.matrix},{key:'daily-metrics',title:'每日總量與缺漏',columns:[{key:'date',label:'日期',kind:'date'},{key:'channels',label:'頻道數',kind:'number'},{key:'videos',label:'影片數',kind:'number'},{key:'views',label:'影片累計觀看',kind:'number'},{key:'statusLabel',label:'來源狀態'}],rows:ranking.metrics}],filters:[{key:'days',label:'往前日數（起訖優先）',type:'select',value:String(bounded(q.days,7,1,90)),options:[1,3,7,10,30,90].map(d=>({value:String(d),label:String(d)}))},{key:'from',label:'開始日期',type:'date',value:text(q.from)},{key:'to',label:'結束日期',type:'date',value:text(q.to)},{key:'type',label:'度量',type:'select',value:keyword?'tags_video':field,options:keyword?[{value:'tags_video',label:'共現影片數'}]:[{value:'tags_result',label:'重要度'},{value:'tags_video',label:'影片數'},{value:'tags_views',label:'累計觀看'}]},{key:'diff',label:'排名方式',type:'select',value:requestedDiff?'1':'0',options:[{value:'1',label:'相對期間平均差'},{value:'0',label:'當日原值'}]}]}),evidenceCoverage:{derived:derivedCoverage??null,requestedDates:period.dates.length,availableDates:byDate.size,withheldDates:sourceRecords.length-records.length,unknownViewVideos:unknownViews,requestedDiff,appliedDiff:ranking.diff,malformedDates:ranking.malformedDates.length,comparableLineage:ranking.comparable,source:derivedCoverage?.status==='derived'?'derived-current-evidence':sourceTable,stopwordPolicy:'legacy-fixed+local-exclusions'}};

    };
    register('/tags/days', (_p, q) => daily(q));
    register('/tags/trends', (_p, q) => daily(q, undefined, true));
    register('/tags/:id/days', (p, q) => daily({ ...q, tagid: mergeTagId(q.tagid, positiveId(p.id)) }));
    register('/tags/:id/trends', (p, q) => daily({ ...q, tagid: mergeTagId(q.tagid, positiveId(p.id)) }, undefined, true));
    register('/keywords/:keyword/days', (p, q) => daily(q, p.keyword));
}
