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
type Item={name:ReportValue|ReportCell|undefined;detail:ReportValue|ReportCell|undefined;tag?:ReportValue|ReportCell|undefined;source:ReportValue|ReportCell|undefined};
interface Card{title:string;href:string;label:string;updatedAt?:string|null;items:Item[];status?:string[]}
const sourceKey=(v:Item['source'])=>v!==null&&typeof v==='object'?v.href??String(v.value):String(v??'');
// Stored-analysis caveats live in the method block; a card only repeats a note when the source is unavailable.
function unavailable(report:ReportData){return !report.rows.length&&!report.columns.length&&report.notes?.length?report.notes:undefined;}
function InsightCard({card}:{card:Card}){
 const sources=new Set(card.items.map(i=>sourceKey(i.source))),shared=sources.size===1?card.items[0]!.source:undefined;
 return <article className={ui.panel+' text-sm'}>
  <div className="flex flex-wrap items-baseline justify-between gap-x-3"><h3 className="text-sm font-semibold">{card.title}</h3><Link className={'text-xs '+ui.link} href={card.href}>{card.label} →</Link></div>
  {(card.updatedAt||shared!=null)&&<p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-zinc-500 dark:text-zinc-400">{card.updatedAt&&<span>更新 {dateTime(card.updatedAt)}</span>}{shared!=null&&<span className="inline-flex items-center gap-1">來源 {cell(shared)}</span>}</p>}
  <ul className="mt-3 space-y-3">{card.items.slice(0,5).map((item,i)=><li key={i}>
   <p className="font-medium">{cell(item.name)}{item.tag!=null&&<span className={ui.tag+' ml-2 align-middle'}>{cell(item.tag)}</span>}</p>
   <p className="mt-0.5 leading-relaxed text-zinc-600 dark:text-zinc-400">{cell(item.detail)}</p>
   {shared==null&&item.source!=null&&<p className="mt-1 text-xs text-zinc-500">{cell(item.source)}</p>}
  </li>)}</ul>
 </article>;
}
export function ChannelInsights({data}:{data:ChannelData}){
 const id=data.channel.id,overview=data.aiSummary,people=overview.sections?.find(s=>s.key==='people'),aspect=overview.sections?.find(s=>s.key==='aspects'),source=overview.sections?.find(s=>s.key==='sources');
 const topics=(report:ReportData):Item[]=>report.rows.map(r=>({name:r.title,detail:r.description,source:r.source}));
 const cards:Card[]=[
  {title:'最近每日重點',href:`/channels/${id}/ai/days`,label:'每日分析與引用影片',updatedAt:data.dailySummary.updatedAt,items:topics(data.dailySummary),status:unavailable(data.dailySummary)},
  {title:'議題分析',href:`/channels/${id}/ai`,label:'全部分析',updatedAt:overview.updatedAt,items:topics(overview),status:unavailable(overview)},
  {title:'人物分析',href:`/channels/${id}/people`,label:'人物逐日引用',items:(people?.rows??[]).map(r=>({name:r.name,detail:r.description,tag:r.evaluation==null?undefined:{value:'模型評價：'+String(typeof r.evaluation==='object'?r.evaluation.value:r.evaluation)},source:r.source}))},
  {title:'觀點描述',href:`/channels/${id}/ai`,label:'分析面向與來源',items:(aspect?.rows??[]).map(r=>({name:r.item,detail:r.description,source:r.source}))},
 ];
 const shown=cards.filter(c=>c.items.length),empty=cards.filter(c=>!c.items.length),status=[...new Set(cards.flatMap(c=>c.status??[]))];
 return <section><SectionHeading title="頻道分析與資料範圍" href={`/channels/${id}/ai`}/>
  <p className="text-sm">{data.trendAvailable?<Link className={ui.link} href={`/channels/${id}/trends`}>已有頻道歷史觀測，查看趨勢 →</Link>:<span className="muted">尚無頻道歷史觀測。</span>}</p>
  {status.map((note,i)=><p key={i} className={ui.note}>{note}</p>)}
  {shown.length?<div className="mt-3 grid gap-3 md:grid-cols-2">{shown.map(c=><InsightCard key={c.title} card={c}/>)}</div>:null}
  {!status.length&&(shown.length?empty.length?<p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">尚無既有分析：{empty.map(c=>c.title).join('、')}。</p>:null:<p className={ui.note}>這個頻道目前沒有可呈現的 AI 分析（每日重點、議題、人物、觀點）。</p>)}
  {source?.rows.length?<details className={ui.panel+' text-sm'} style={{padding:16,marginTop:16}}><summary>各分析的實際期間與來源</summary><ul>{source.rows.map((row,i)=><li key={i}>{cell(row.type)} · {cell(row.from)} ～ {cell(row.to)} · {cell(row.source)}</li>)}</ul></details>:null}
 </section>;
}
