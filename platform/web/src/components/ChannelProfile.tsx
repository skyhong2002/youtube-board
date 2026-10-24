import Link from 'next/link';
import type {ChannelData,ChannelNameVersion,ReportMeta,Search} from '@/lib/api';
import {compact,count,dateTime,youtubeUrl} from '@/lib/format';
import {familyTabs} from '@/lib/report-navigation';
import {reportStyle as ui} from '@/lib/report-styles';
import {ChannelAvatar} from './ChannelAvatar';
import SourceSidebar from './SourceSidebar';
import FollowButton from './reader/FollowButton';
import {DataNotice,SectionHeading,Tabs} from './ReportUI';
import {VideoResults} from './VideoResults';
import {ChannelInsights} from './ChannelInsights';
import MethodLink from './MethodLink';
import {ReportMethod} from './ReportMethod';
const card='rounded-lg border border-zinc-200 p-3 text-xs dark:border-zinc-800';
function NameVersions({rows}:{rows:ChannelNameVersion[]}){return <ol className="space-y-3 leading-5">{rows.map((r,i)=><li key={r.observedAt+i} className="flex items-center gap-2.5"><ChannelAvatar avatar={r.avatar} title={r.title} size={28}/><div className="min-w-0"><time dateTime={r.observedAt} className="block text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">{dateTime(r.observedAt,true)}</time><span className="[overflow-wrap:anywhere]">{r.title}</span></div></li>)}</ol>;}
function Values({items}:{items:Array<[string,string]>}){return <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2.5 leading-5">{items.map(([label,value])=><div key={label} className="contents"><dt className="text-zinc-500 dark:text-zinc-400">{label}</dt><dd className="text-right tabular-nums">{value}</dd></div>)}</dl>;}
/** Source profile structure copied from mother media/[media] at afe0a653. */
export function ChannelProfile({data,meta,path,search}:{data:ChannelData;meta:ReportMeta;path:string;search:Search}){
 const c=data.channel,title=c.title||'頻道名稱尚未取得';
 return <div className="pb-4">
  <nav aria-label="麵包屑" className="mb-3 text-xs text-zinc-500 dark:text-zinc-400"><Link href="/channels" className="hover:underline">頻道</Link><span className="mx-2" aria-hidden="true">/</span>{title}</nav>
  <header className="mb-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-zinc-300 pb-4 dark:border-zinc-700">
   <div className="min-w-0"><div className="flex flex-wrap items-center gap-2.5"><ChannelAvatar avatar={c.avatar} title={title} size={28}/><h1 className="text-2xl font-semibold tracking-tight [overflow-wrap:anywhere]">{title}</h1><FollowButton kind="channel" target={String(c.id)}/></div><p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400"><span>YouTube 頻道觀測</span><span>· 更新於 {dateTime(meta.updatedAt)} · 台北時間 ·</span><MethodLink/></p></div>
   <dl className="flex gap-5 text-right sm:gap-7">{[['訂閱人數',compact(c.subscribers),'人'],['累計觀看',compact(c.views),'次'],['累計影片',count(c.videoCount),'支']].map(([label,value,unit])=><div key={label}><dt className="text-[11px] text-zinc-500 dark:text-zinc-400">{label}</dt><dd className="mt-0.5 text-xl font-semibold tabular-nums">{value}{value!=='—'&&<span className="ml-1 text-[10px] font-normal text-zinc-500">{unit}</span>}</dd></div>)}</dl>
  </header>
  <DataNotice meta={meta}/><Tabs items={familyTabs(path,search,meta.coverage)} active={path}/>
  <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_19rem] lg:gap-6">
   <SourceSidebar label="頻道資料、觀測增量與模型估計">
    <section aria-label="頻道基本資料" className={card}><h2 className="mb-3 text-sm font-semibold">頻道資料</h2><dl className="grid grid-cols-[5rem_minmax(0,1fr)] gap-y-2.5 leading-5"><dt className="text-zinc-500 dark:text-zinc-400">頻道名稱</dt><dd className="[overflow-wrap:anywhere]">{title}</dd><dt className="text-zinc-500 dark:text-zinc-400">來源網站</dt><dd><a className={ui.link} href={youtubeUrl(c.youtubeUrl)} target="_blank" rel="noopener noreferrer">YouTube 頻道 ↗<span className="sr-only">（另開新視窗）</span></a></dd><dt className="text-zinc-500 dark:text-zinc-400">頻道建立</dt><dd>{dateTime(c.publishedAt,true)}</dd><dt className="text-zinc-500 dark:text-zinc-400">資料取得</dt><dd>{dateTime(c.updatedAt)}</dd><dt className="text-zinc-500 dark:text-zinc-400">本站分類</dt><dd className="flex flex-wrap gap-1">{c.tags.length?c.tags.map(t=><Link key={t.id} className={ui.tag} href={`/tags/${t.id}/channels`}>{t.name}</Link>):'未分類'}</dd></dl><details className="mt-3 border-t border-zinc-200 pt-3 dark:border-zinc-800"><summary className="cursor-pointer text-zinc-600 dark:text-zinc-400">頻道簡介</summary><p className="mt-2 whitespace-pre-wrap break-words leading-relaxed text-zinc-600 dark:text-zinc-400">{c.description||'來源尚未提供頻道簡介。'}</p></details></section>
    {data.nameHistory&&data.nameHistory.length>1?<section aria-label="頻道名稱紀錄" className={card}><h2 className="mb-3 text-sm font-semibold">名稱紀錄<span className="ml-1.5 font-normal text-zinc-500 dark:text-zinc-400">{data.nameHistory.length} 個</span></h2><NameVersions rows={data.nameHistory.slice(0,5)}/>{data.nameHistory.length>5&&<details className="mt-3 border-t border-zinc-200 pt-3 dark:border-zinc-800"><summary className="cursor-pointer text-zinc-600 dark:text-zinc-400">更早的 {data.nameHistory.length-5} 個</summary><div className="mt-3"><NameVersions rows={data.nameHistory.slice(5)}/></div></details>}</section>:null}
    <section className={card}><h2 className="mb-3 text-sm font-semibold">期間觀測增量</h2><Values items={[
     ['近七日觀看',count(c.weeklyViews)],['近月觀看',count(c.monthlyViews)],['近七日訂閱',count(c.weeklySubscribers)],['近月訂閱',count(c.monthlySubscribers)],['近七日影片',count(c.weeklyVideos)],['近月影片',count(c.monthlyVideos)],['平均每片週觀看',count(c.averageWeeklyViewsPerVideo)]
    ]}/><p className="mt-3">{data.trendAvailable?<Link className={ui.link} href={`/channels/${c.id}/trends`}>查看歷史觀測 →</Link>:<span className="text-zinc-500 dark:text-zinc-400">尚無頻道歷史觀測。</span>}</p></section>
    {/* Model figures can sit far from the measured ones; folded so they are not read as measurements. */}
    <details className={`${card} group`}><summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-semibold [&::-webkit-details-marker]:hidden"><span aria-hidden="true" className="text-[10px] transition-transform group-open:rotate-90">▶</span>歷史模型估計<span className="font-normal text-zinc-500 dark:text-zinc-400">（非實測）</span></summary><div className="mt-3"><Values items={[
     ['近七日觀看估計',count(c.estimatedWeeklyViews)],['近月觀看估計',count(c.estimatedMonthlyViews)],['近月估計差距',count(c.monthlyEstimateGap)],['觀看成長指標',c.legacyGrowthPercent===null?'—':c.legacyGrowthPercent.toFixed(1)+'%']
    ]}/></div></details>
   </SourceSidebar>
   <div className="min-w-0 lg:col-start-1 lg:row-start-1"><SectionHeading title="近期收錄影片" href={`/channels/${c.id}/videos`}/><VideoResults rows={data.videos}/><ChannelInsights data={data}/></div>
  </div>
  <ReportMethod path={path} meta={meta}/>
 </div>;
}
