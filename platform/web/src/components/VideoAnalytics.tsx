import Link from 'next/link';
import {notFound} from 'next/navigation';
import {api,type Search} from '@/lib/api';
import {count,dateTime} from '@/lib/format';
import type {VideoAnalyticsData,AnalyticsPoint} from '../../../api/src/video-analytics-contracts';
import {Heading,DataNotice,Unavailable,Metric,SectionHeading,Empty,Tabs} from './ReportUI';
import {ObservationChart,observedPoints,SINGLE_OBSERVATION_NOTE} from './ObservationChart';
import {videoCommentStatuses as statuses} from '@/lib/video-comment-status';
import {COMMENTS_PUBLISHED} from '@/lib/comments-launch';
import TableScroller from './TableScroller';
import {ObservationValue} from './ObservationValue';
import {table} from '@/lib/table-styles';
import {reportStyle as ui} from '@/lib/report-styles';
import {VideoThumbnail} from './VideoThumbnail';
import {ChannelSourceLabel,hasSource} from './ChannelSource';
import {ReportMethod} from './ReportMethod';
function Chart({title,points,unit}:{title:string;points:AnalyticsPoint[];unit:string}){return <section><SectionHeading title={title}/><ObservationChart points={points} label={title} unit={unit}/></section>;}
export async function VideoAnalytics({apiPath,search,path}:{apiPath:string;search:Search;path:string}){
 const result=await api<VideoAnalyticsData>(apiPath,search);if(!result.ok){if(result.status===404)notFound();return <Unavailable title="影片觀測分析" status={result.status}/>;}
 const {data,meta}=result.response,c=data.comments,channel={channelId:data.channelId,channelTitle:data.channelTitle,channelAvatar:data.channelAvatar??null};
 const views=data.history.map(r=>({time:r.date,value:r.views})),liveSeries=observedPoints(data.live.hourly).length>0||observedPoints(data.live.daily).length>0;
 const limited=[data.live.hourly,data.live.daily,data.history].some(series=>series.length>=data.limit);
 return <>
  <Heading title={data.title+' · 觀測分析'} meta={meta} lead={hasSource(channel)?<ChannelSourceLabel source={channel} size={20}/>:undefined}/>
  <DataNotice meta={meta}/>
  <Tabs items={[{href:`/videos/${encodeURIComponent(data.id)}`,label:'影片概覽'},{href:path,label:'觀測分析'}]} active={path}/>
  <div className="my-4 flex flex-wrap items-center gap-4">
   <Link href={`/videos/${encodeURIComponent(data.id)}`} aria-label="返回影片概覽"><VideoThumbnail videoId={data.id} title={data.title} width={160} height={90}/></Link>
   {data.live.maxCurrent!==null&&<div><div className="text-xs text-zinc-600 dark:text-zinc-400">所讀直播紀錄最高同時在線</div><div className="mt-1 text-xl font-semibold tabular-nums leading-tight">{count(data.live.maxCurrent)}<span className="ml-1 text-sm font-normal text-zinc-500">人</span></div></div>}
   {/* The limit only matters once a series or ranking reaches it. */}
   {(limited||COMMENTS_PUBLISHED)&&<form key={data.limit} action={path} className="flex items-end gap-2 sm:ml-auto"><label className={ui.label}>每組顯示筆數<input className={ui.input+' w-24'} name="limit" type="number" min="1" max="200" defaultValue={data.limit}/></label><button className={ui.button}>套用</button></form>}
  </div>
  {COMMENTS_PUBLISHED&&<div className="metrics"><Metric label="已解析留言與回覆" value={c.status==='pending'||c.status==='missing'||c.status==='malformed'||c.status==='oversized'?'—':count(c.decodedCount)} unit="則" detail={`來源批次記錄 ${count(c.recordedCount)} 則`}/><Metric label="已解析留言帳號" value={c.status==='complete'||c.status==='truncated'?count(c.decodedAuthors):'—'} unit="個" detail={`來源批次記錄 ${count(c.recordedAuthors)} 個`}/><Metric label="留言資料狀態" value={statuses[c.status]} detail={c.latestAt?`來源最新留言 ${dateTime(c.latestAt)}`:'尚無最新留言時間'}/></div>}
  {COMMENTS_PUBLISHED&&(Number(data.evidenceCoverage.invalidComments)>0||Number(data.evidenceCoverage.invalidCommentTimes)>0||data.evidenceCoverage.commentCountMismatch===true||data.evidenceCoverage.malformedAuthorMetadata===true||c.status==='truncated')&&<p className={ui.note}>留言解析範圍不完整，時間分布與排名只涵蓋可解析項目。</p>}
  {/* A video that was never live has no live section; the zero counts stay in the method block's coverage. */}
  {liveSeries&&<div className="analytics-grid"><Chart title="直播逐時最高同時在線" points={data.live.hourly} unit="人"/><Chart title="直播逐日最高同時在線" points={data.live.daily} unit="人"/></div>}
  {/* One stored count is already the table's single row below; a chart needs two. */}
  {observedPoints(views).length>1&&<Chart title="累計觀看數歷史" points={views} unit="次"/>}
  <SectionHeading title="影片統計歷史"/>
  {data.history.length ? <TableScroller card label="影片統計歷史，可左右捲動">
   <table className={'w-full min-w-[30rem] text-left text-sm '+table.nowrap}>
    <thead className="bg-(--table-head-bg) text-xs text-zinc-600 dark:text-zinc-400"><tr><th scope="col" className={table.leadHead}>日期</th><th scope="col" className={table.num}>累計觀看</th><th scope="col" className={table.num}>喜歡</th><th scope="col" className={table.num}>留言</th></tr></thead>
    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">{data.history.map(r => <tr className={table.row} key={r.date}>
     <th scope="row" className={table.lead + ' text-left font-normal'}><div className={table.leadBox}>{r.date}</div></th>
     <td className={table.num}><ObservationValue value={r.views}/></td><td className={table.num}><ObservationValue value={r.likes}/></td><td className={table.num}><ObservationValue value={r.comments}/></td>
    </tr>)}</tbody>
   </table>
  </TableScroller> : <Empty title="尚無有效影片統計歷史"/>}
  {COMMENTS_PUBLISHED&&<>
  <div className="analytics-grid"><Chart title="逐時留言與回覆" points={c.hourly} unit="則"/><Chart title="逐日留言與回覆" points={c.daily} unit="則"/></div>
  <SectionHeading title="最多留言與回覆的帳號"/>
  {c.authors.length ? <TableScroller card label="留言帳號排名，可左右捲動">
   <table className={'w-full min-w-[36rem] text-left text-sm '+table.nowrap}>
    <thead className="bg-(--table-head-bg) text-xs text-zinc-600 dark:text-zinc-400"><tr><th scope="col" className={table.leadHead}>帳號</th><th scope="col" className={table.num}>留言</th><th scope="col" className={table.num}>回覆</th><th scope="col" className={table.num}>合計</th><th scope="col" className={table.num}>喜歡合計</th></tr></thead>
    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">{c.authors.map(a => <tr className={table.row} key={a.id}>
     <th scope="row" className={table.lead + ' text-left font-normal'}><div className={table.leadBox}><span className={table.leadText + ' block sm:max-w-xs'} title={a.name}>{/^[A-Za-z0-9_-]{1,64}$/.test(a.id)?<Link className={ui.link} href={`/comments/authors/${encodeURIComponent(a.id)}?lookup=channel`}>{a.name}</Link>:a.name}</span></div></th>
     <td className={table.num}><ObservationValue value={a.comments}/></td><td className={table.num}><ObservationValue value={a.replies}/></td><td className={table.num}><ObservationValue value={a.total}/></td><td className={table.num}><ObservationValue value={a.likes}/></td>
    </tr>)}</tbody>
   </table>
  </TableScroller> : <Empty title={statuses[c.status]} description="沒有成功解析的公開留言帳號。"/>}
  <SectionHeading title="最多喜歡的留言與回覆"/>
  {c.top.length ? <TableScroller card label="留言與回覆原文">
   <table className={'w-full text-left text-sm ' + table.nowrap + ' ' + table.stack}>
    <thead className="bg-(--table-head-bg) text-xs text-zinc-600 dark:text-zinc-400"><tr><th scope="col" className={table.cell}>帳號／類型</th><th scope="col" className={table.cell}>原文</th><th scope="col" className={table.num}>喜歡</th><th scope="col" className={table.cell}>發布時間</th></tr></thead>
    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">{c.top.map((r,i) => <tr className={table.row} key={`${r.id}-${i}`}>
     <td data-label="帳號／類型" className={table.cell}><span className={table.clip} title={r.authorName}>{r.authorName}</span><small className="ml-1.5 text-xs text-zinc-500">{r.reply?'回覆':'留言'}</small></td>
     {/* One-line summary; the full original text stays in the title and in copied selections. */}
     <td data-label="原文" className={table.cell}><span className={table.clip + ' sm:max-w-xl'} title={r.text}>{r.text}</span></td>
     <td data-label="喜歡" className={table.num}><ObservationValue value={r.likes}/></td>
     <td data-label="發布時間" className={table.cell}>{dateTime(r.publishedAt)}</td>
    </tr>)}</tbody>
   </table>
  </TableScroller> : <Empty title={statuses[c.status]}/>}
  </>}
  <ReportMethod path={path} meta={meta} notes={[...data.notes,...([data.live.hourly,data.live.daily].some(p=>observedPoints(p).length===1)?[SINGLE_OBSERVATION_NOTE]:[])]}>
   <details className="my-3 text-sm"><summary className="cursor-pointer">資料涵蓋範圍與解析限制</summary><dl className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 tabular-nums">{Object.entries(data.evidenceCoverage).filter(([key])=>COMMENTS_PUBLISHED||!commentCoverage.test(key)).map(([key,value])=><div className="contents" key={key}><dt>{coverageLabels[key]||key}</dt><dd className="text-right">{typeof value==='boolean'?(value?'是':'否'):value===null?'—':String(value)}</dd></div>)}</dl></details>
  </ReportMethod>
 </>;
}
const commentCoverage=/comment|author/i;
const coverageLabels:Record<string,string>={liveRowCap:'直播來源日紀錄上限',historyMonthCap:'統計來源月紀錄上限',commentByteCap:'留言本文位元組上限',commentEntryCap:'留言與回覆解析上限',liveRowsRead:'已讀直播日紀錄',historyRowsRead:'已讀統計月紀錄',liveRowsTruncated:'直播來源紀錄是否截斷',historyRowsTruncated:'統計來源紀錄是否截斷',malformedLogRows:'無法解析的日誌紀錄',invalidLogPoints:'無效日誌觀測點',skippedLogBytes:'超出預算略過的日誌位元組',invalidComments:'無效留言項目',invalidCommentTimes:'無有效發布時間的留言',duplicateComments:'重複留言識別碼',truncatedCommentTexts:'截短至 10,000 字的留言',malformedAuthorMetadata:'作者名稱資料是否無法解析',skippedLiveBytes:'略過的直播日誌位元組',skippedHistoryBytes:'略過的統計日誌位元組',skippedLiveRows:'略過的直播紀錄',skippedHistoryRows:'略過的統計紀錄',emptyLogRows:'空日誌紀錄',duplicateHistoryDays:'重複歷史日期',commentsWithoutIds:'無法依識別碼去重的留言',commentStatus:'留言批次狀態',decodedComments:'已解析留言與回覆',decodedAuthors:'已解析作者帳號',commentCountMismatch:'批次記錄與解析留言數是否不一致',hourlyLivePoints:'可用直播逐時點',dailyLivePoints:'可用直播逐日點',historyPoints:'可用統計歷史點'};
