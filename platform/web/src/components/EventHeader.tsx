import Link from 'next/link';
import type {ReactNode} from 'react';
import {VideoThumbnail} from './VideoThumbnail';
import {dateTime} from '@/lib/format';
/** Event heading grid and navigation follow mother eve/[id] at afe0a653. */
export function EventHeader({title,breadcrumb,description,updatedAt,actions,cover,tags=[],stats=[],jumps}:{
 title:string;breadcrumb:ReactNode;description:string;updatedAt:string|null;actions?:ReactNode;
 cover?:{videoId:string;title:string;channelTitle?:string}|null;tags?:string[];
 stats?:Array<{label:string;value:string}>;jumps:Array<[string,string]>;
}){
 return <header className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(240px,320px)] md:items-start">
  <aside aria-label="事件來源摘要" className="min-w-0 space-y-3 md:order-last">
   {cover&&<figure className="m-0 space-y-2"><Link href={`/videos/${encodeURIComponent(cover.videoId)}`} tabIndex={-1} aria-hidden="true" className="relative block aspect-video overflow-hidden rounded-xl bg-zinc-100 dark:bg-zinc-800"><VideoThumbnail videoId={cover.videoId} fill sizes="(max-width: 768px) 100vw, 320px" priority/></Link><figcaption className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">來源影片 · <Link href={`/videos/${encodeURIComponent(cover.videoId)}`} className="hover:underline">{cover.title}</Link>{cover.channelTitle&&<span className="mt-1 block">{cover.channelTitle}</span>}</figcaption></figure>}
   {stats.length>0&&<dl className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-lg border border-zinc-200 p-3 text-xs dark:border-zinc-800">{stats.map((s,i)=><div key={`${s.label}-${i}`}><dt className="text-zinc-500 dark:text-zinc-400">{s.label}</dt><dd className="mt-0.5 text-base font-semibold tabular-nums">{s.value}</dd></div>)}</dl>}
  </aside>
  <div className="min-w-0 space-y-2"><p className="text-sm text-zinc-600 dark:text-zinc-400">{breadcrumb}</p>{actions&&<div className="flex flex-wrap gap-2">{actions}</div>}<h1 className="text-2xl font-semibold tracking-tight [overflow-wrap:anywhere]">{title}</h1><p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">{description}</p>{tags.length>0&&<p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"><span className="text-zinc-600 dark:text-zinc-400">來源標籤</span>{tags.map((tag,i)=><Link key={`${tag}-${i}`} href={`/keywords/${encodeURIComponent(tag)}/videos`} className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">{tag}</Link>)}</p>}<p className="text-sm text-zinc-600 dark:text-zinc-400">更新於 {dateTime(updatedAt)} · 台北時間</p><nav className="flex flex-wrap gap-1 text-xs" aria-label="頁內段落">{jumps.map(([anchor,label])=><a key={anchor} href={`#${anchor}`} className="rounded-md bg-zinc-100 px-2.5 py-1 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700">{label}</a>)}</nav></div>
 </header>;
}
