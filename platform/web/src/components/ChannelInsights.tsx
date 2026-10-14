import {reportStyle as ui} from '@/lib/report-styles';
import Link from 'next/link';
import type {ChannelData} from '@/lib/api';
import type {ReportData,ReportCell,ReportValue} from '@/lib/report-contract';
import {safeReportHref,reportLinkPrefetch} from '@/lib/report-contract';
import {dateTime} from '@/lib/format';
import {SectionHeading} from './ReportUI';
import {ChannelAvatar} from './ChannelAvatar';
import {VideoThumbnail} from './VideoThumbnail';
import {ChannelSourceList,cellSources} from './ChannelSource';
import {table} from '@/lib/table-styles';
// Source names stay on one clipped line; the list title keeps every name.
function cell(v:ReportValue|ReportCell|undefined){if(v===null||v===undefined)return '—';if(typeof v==='object'){const sources=cellSources(v);if(sources)return <ChannelSourceList sources={sources} className={table.clip}/>;const href=v.href?safeReportHref(v.href):undefined,text=String(v.value??'—'),content=v.media?<span className="inline-flex min-w-0 items-center gap-2">{v.media.kind==='channel'?<ChannelAvatar avatar={v.media.avatar} title={text} size={20}/>:<VideoThumbnail videoId={v.media.videoId} width={96} height={54}/>}<span className="min-w-0">{text}</span></span>:text;return href?<Link href={href} prefetch={reportLinkPrefetch(href)}>{content}</Link>:content;}return String(v);}
function brief(report:ReportData,keys:string[]){return report.rows.length?<ul>{report.rows.slice(0,5).map((row,i)=><li key={i}><strong>{cell(row[keys[0]!])}</strong>{keys.slice(1).map(k=><p key={k} className="muted">{cell(row[k])}</p>)}{row.source!=null&&<small>{cell(row.source)}</small>}</li>)}</ul>:report.notes?.length?null:<p className="muted">尚無可呈現的既有分析。</p>;}
export function ChannelInsights({data}:{data:ChannelData}){
 const id=data.channel.id,overview=data.aiSummary,people=overview.sections?.find(s=>s.key==='people'),aspect=overview.sections?.find(s=>s.key==='aspects'),source=overview.sections?.find(s=>s.key==='sources');
 return <section><SectionHeading title="頻道分析與資料範圍" href={`/channels/${id}/ai`}/><p className="muted">以下內容來自已儲存的 AI 分析，閱讀不會產生新分析。描述與模型分數需搭配原始影片查證，各面向的分析期間可能不同。</p><p>{data.trendAvailable?<Link href={`/channels/${id}/trends`}>已有頻道歷史觀測，查看趨勢 →</Link>:'尚無頻道歷史觀測。'}</p><div className="grid gap-3 md:grid-cols-2">
  <article className={ui.panel+' text-sm'}><h3 className="mb-2 text-sm font-semibold">最近每日重點</h3><p className="muted">更新 {dateTime(data.dailySummary.updatedAt)}</p>{!data.dailySummary.rows.length&&data.dailySummary.notes?.map((note,i)=><p className="muted" key={i}>{note}</p>)}{brief(data.dailySummary,['title','description'])}<Link href={`/channels/${id}/ai/days`}>每日分析與引用影片 →</Link></article>
  <article className={ui.panel+' text-sm'}><h3 className="mb-2 text-sm font-semibold">議題分析</h3><p className="muted">總覽資料更新 {dateTime(overview.updatedAt)}</p>{!overview.rows.length&&overview.notes?.map((note,i)=><p className="muted" key={i}>{note}</p>)}{brief(overview,['title','description'])}<Link href={`/channels/${id}/ai`}>查看全部分析 →</Link></article>
  <article className={ui.panel+' text-sm'}><h3 className="mb-2 text-sm font-semibold">人物分析</h3>{people?.rows.length?<ul>{people.rows.slice(0,5).map((p,i)=><li key={i}><strong>{cell(p.name)}</strong><p className="muted">{cell(p.description)} · 模型評價：{cell(p.evaluation)}</p><small>{cell(p.source)}</small></li>)}</ul>:<p className="muted">尚無可呈現的人物分析。</p>}<Link href={`/channels/${id}/people`}>人物逐日引用 →</Link></article>
  <article className={ui.panel+' text-sm'}><h3 className="mb-2 text-sm font-semibold">觀點描述</h3>{aspect?.rows.length?<ul>{aspect.rows.slice(0,5).map((p,i)=><li key={i}><strong>{cell(p.item)}</strong><p className="muted">{cell(p.description)}</p><small>{cell(p.source)}</small></li>)}</ul>:<p className="muted">尚無可呈現的觀點分析。</p>}<Link href={`/channels/${id}/ai`}>分析面向與來源 →</Link></article>
 </div>{source?.rows.length?<details className={ui.panel+' text-sm'} style={{padding:16,marginTop:16}}><summary>各分析的實際期間與來源</summary><ul>{source.rows.map((row,i)=><li key={i}>{cell(row.type)} · {cell(row.from)} ～ {cell(row.to)} · {cell(row.source)}</li>)}</ul></details>:null}</section>;
}
