import type {ReactNode} from 'react';
import Link from 'next/link';
import type {Collection,ReportMeta,VideoRow} from '@/lib/api';
import {compact,count,dateTime} from '@/lib/format';
import {ChannelAvatar} from './ChannelAvatar';
import {VideoThumbnail} from './VideoThumbnail';
import {KeywordEvidenceNotice} from './KeywordEvidenceNotice';
import FollowButton from './reader/FollowButton';

/** Layout from tag.observe.tw tag/[tag] and ArticleResults at afe0a653.
 * Keep API ranking and scope; a page of videos cannot establish global facets. */
export function KeywordProfile({keyword,description,data,meta,notice,tabs,filters,pagination}:{
 keyword:string;description:string;data:Collection<VideoRow>;meta:ReportMeta;
 notice:ReactNode;tabs:ReactNode;filters:ReactNode;pagination:ReactNode;
}){
 return <div className="space-y-6">
  <header className="flex flex-wrap items-baseline justify-between gap-3">
   <div className="min-w-0 space-y-1">
    <div className="flex flex-wrap items-center gap-3"><h1 className="min-w-0 break-words text-2xl font-semibold tracking-tight [overflow-wrap:anywhere]"><span className="text-zinc-500">#</span>{keyword}</h1><FollowButton kind="tag" target={keyword}/></div>
    <p className="max-w-4xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{description}</p>
    <p className="text-sm text-zinc-600 dark:text-zinc-400">更新於 {dateTime(meta.updatedAt)} · 台北時間</p>
   </div>
   <Link href="/vocabulary" className="text-sm text-brand-700 hover:underline dark:text-brand-400">共同詞彙 →</Link>
  </header>
  {notice}
  {tabs}
  <section className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]" aria-label="共同標籤影片與比對範圍">
   <aside className="min-w-0 space-y-4 lg:order-2">
    <section className="space-y-3" aria-label="影片來源範圍">
     <h2 className="text-sm font-medium text-zinc-600 dark:text-zinc-400">收錄與比對範圍</h2>
     <KeywordEvidenceNotice coverage={meta.coverage} subject={keyword}/>
    </section>
    <details className="rounded-xl border border-zinc-300 bg-white dark:border-zinc-800 dark:bg-zinc-900">
     <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-zinc-700 focus-visible:outline-2 focus-visible:outline-brand-600 dark:text-zinc-300">篩選影片與日期</summary>
     <div className="min-w-0 px-1 [&_form]:my-0 [&_form]:rounded-none [&_form]:border-0 [&_form]:pt-1 [&_label]:w-full [&_input]:w-full [&_select]:w-full">{filters}</div>
    </details>
   </aside>
   <div className="min-w-0 space-y-4">
    <div className="space-y-1">
     <h2 className="text-lg font-semibold tracking-tight">符合共同標籤的影片 <span className="text-sm font-normal text-zinc-500">{count(data.total)} 部</span></h2>
     <p className="text-sm text-zinc-600 dark:text-zinc-400">詞彙使用 tag.observe.tw 現行比對證據；往前 7 日涵蓋今天加前七天。日數、日期與小時條件會同時套用。</p>
    </div>
    <KeywordVideoList rows={data.rows}/>
    {pagination}
   </div>
  </section>
 </div>;
}

export function KeywordVideoList({rows}:{rows:VideoRow[]}){
 if(!rows.length)return <p className="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">目前沒有可呈現的符合影片。請參考比對範圍；尚未收錄或比對不完整，不代表 YouTube 沒有相關內容。</p>;
 return <ul className="divide-y divide-zinc-200 dark:divide-zinc-800" aria-label="符合共同標籤的影片列表">{rows.map(row=>{
  const href=`/videos/${encodeURIComponent(row.id)}`,title=row.title||'影片標題尚未取得';
  return <li key={row.id} className="flex items-start gap-3 py-3">
   <div className="min-w-0 flex-1">
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-zinc-600 dark:text-zinc-400">
     <Link href={`/channels/${row.channelId}`} className="inline-flex min-w-0 items-center gap-1.5 font-medium hover:underline"><ChannelAvatar avatar={row.channelAvatar} title={row.channelTitle} size={16}/><span className="min-w-0 break-words">{row.channelTitle||'頻道名稱尚未取得'}</span></Link>
     <span aria-hidden="true">·</span><time dateTime={row.publishedAt??undefined} className="tabular-nums">{dateTime(row.publishedAt)}</time>
    </p>
    <h3 className="mt-1 break-words text-[15px] font-medium leading-6 [overflow-wrap:anywhere]"><Link href={href} className="line-clamp-3 hover:text-brand-700 dark:hover:text-brand-400" title={title}>{title}</Link></h3>
    {row.description&&<p className="mt-0.5 line-clamp-2 break-words text-sm text-zinc-600 dark:text-zinc-400 [overflow-wrap:anywhere]">{row.description}</p>}
    <dl className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs tabular-nums text-zinc-500 dark:text-zinc-400">{[['累計觀看',compact(row.views)],['喜歡',count(row.likes)],['留言',count(row.comments)]].map(([label,value])=><div className="flex gap-1" key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
   </div>
   <Link href={href} aria-label={`觀看影片：${title}`} className="mt-1 shrink-0 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"><VideoThumbnail videoId={row.id} title={title} width={96} height={54}/></Link>
  </li>;
 })}</ul>;
}
