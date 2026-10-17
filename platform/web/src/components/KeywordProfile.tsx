import type {ReactNode} from 'react';
import Link from 'next/link';
import type {VideoCollection,ReportMeta,VideoRow} from '@/lib/api';
import {count,dateTime} from '@/lib/format';
import {EVIDENCE_FIELD_LABELS,TAG_SOURCE_ATTRIBUTION,evidenceParts,keywordEvidenceOf,viewsText} from '@/lib/keyword-ranking';
import MethodLink from './MethodLink';
import {ReportMethod} from './ReportMethod';
import {ChannelAvatar} from './ChannelAvatar';
import {VideoThumbnail} from './VideoThumbnail';
import {KeywordEvidenceNotice} from './KeywordEvidenceNotice';
import FollowButton from './reader/FollowButton';
import KeywordExcludeButton from './admin/KeywordExcludeButton';
import LinkPending from './LinkPending';
import KeywordRelations from './KeywordRelations';
import KeywordIllustration from './KeywordIllustration';
import type {KeywordMetadata} from '@/lib/keyword-metadata';

/** Layout from tag.observe.tw tag/[tag] and ArticleResults at afe0a653.
 * Keep API ranking and scope; a page of videos cannot establish global facets. */
type Period={from:string|null;to:string|null;days:string|null;since?:string|null;until?:string|null};
const periodLabel=(p:Period|undefined)=>p?.since&&p?.until?`發布時間 ${dateTime(p.since)} 至 ${dateTime(p.until)}（不含截止時間，台北時間）`:p?.from||p?.to?`發布日期 ${p.from??'不限'} 至 ${p.to??'不限'}（台北時間）`:p?.days&&/^\d+$/.test(p.days)?`往前 ${p.days} 日發布（含今天共 ${Number(p.days)+1} 個台北日曆日）`:p?.days?`往前 ${p.days} 日發布`:'全部已收錄期間';
export function KeywordProfile({keyword,description,data,meta,notice,tabs,filters,pagination,period,metadata}:{
 keyword:string;description:string;data:VideoCollection;meta:ReportMeta;
 notice:ReactNode;tabs:ReactNode;filters:ReactNode;pagination:ReactNode;period?:Period;metadata?:KeywordMetadata;
}){
 return <div className="space-y-6">
  <header className="flex flex-wrap items-baseline justify-between gap-3">
   <div className="min-w-0 space-y-1">
    <div className="flex flex-wrap items-center gap-3"><h1 className="min-w-0 break-words text-2xl font-semibold tracking-tight [overflow-wrap:anywhere]"><span className="text-zinc-500">#</span>{keyword}</h1><FollowButton kind="tag" target={keyword}/><KeywordExcludeButton terms={[keyword]} label={keyword}/></div>
    <p className="text-sm text-zinc-600 dark:text-zinc-400">更新於 {dateTime(meta.updatedAt)} · 台北時間 · <MethodLink/></p>
   </div>
   <div className="flex gap-4 text-sm"><Link href="/keywords" className="inline-flex items-center gap-1 text-brand-700 hover:underline dark:text-brand-400">熱門標籤排行 →<LinkPending/></Link></div>
  </header>
  <section className="grid min-w-0 items-start gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]" aria-label="標籤圖片與關聯">
   <KeywordIllustration key={keyword} keyword={keyword} initialView={metadata?.illustration}/>
   <KeywordRelations key={keyword} keyword={keyword} initialView={metadata?.relations}/>
  </section>
  {notice}
  {tabs}
  {/* One compact line, as tag.observe.tw's ranking subtitle; the method text is in 本頁的資料來源與計算方式. */}
  <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-zinc-600 dark:text-zinc-400" aria-label="來源、期間與比對方式">
   <Link className="text-brand-700 hover:underline dark:text-brand-400" href="/vocabulary">{TAG_SOURCE_ATTRIBUTION}</Link>
   <span>{periodLabel(period)}</span>
  </p>
  <section className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]" aria-label="共同標籤影片與比對範圍">
   <aside className="min-w-0 space-y-4 lg:order-2">
    <section className="space-y-3" aria-label="影片來源範圍">
     <h2 className="text-sm font-medium text-zinc-600 dark:text-zinc-400">收錄與比對範圍</h2>
     <KeywordEvidenceNotice coverage={meta.coverage} subject={keyword} compact visibleCount={data.rows.length} total={data.total}/>
    </section>
    <details className="rounded-xl border border-zinc-300 bg-white dark:border-zinc-800 dark:bg-zinc-900">
     <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-zinc-700 focus-visible:outline-2 focus-visible:outline-brand-600 dark:text-zinc-300">篩選影片與日期</summary>
     <div className="min-w-0 px-1 [&_form]:my-0 [&_form]:rounded-none [&_form]:border-0 [&_form]:pt-1 [&_label]:w-full [&_input]:w-full [&_select]:w-full">{filters}</div>
    </details>
   </aside>
   <div className="min-w-0 space-y-4">
    <h2 className="text-lg font-semibold tracking-tight">符合共同標籤的影片 <span className="text-sm font-normal text-zinc-500">{data.total===null?(data.totalStatus==='unavailable'?'總數暫時無法取得':'總數未計算'):`${count(data.total)} 部`}</span></h2>
    {/* A page past the results is not "no matches": the counted total says otherwise. */}
    {!data.rows.length&&data.total!==null&&data.total>0?<p className="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400" data-keyword-results="page-empty">這一頁沒有可呈現的影片，但目前條件共 {count(data.total)} 部符合；請改看其他頁碼。</p>:<KeywordVideoList rows={data.rows} total={data.total}/>}
    {pagination}
   </div>

  </section>
  <ReportMethod path={`/keywords/${encodeURIComponent(keyword)}/videos`} description={description} meta={meta}/>
 </div>;
}
function Evidence({row,href}:{row:VideoRow;href:string}){
 const evidence=keywordEvidenceOf(row);
 if(!evidence?.length)return <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">沒有命中片段</p>;
 return <ul className="mt-1 space-y-0.5 text-sm text-zinc-600 dark:text-zinc-400" aria-label="命中片段">{evidence.map((e,i)=>{
  const parts=evidenceParts(e),label=EVIDENCE_FIELD_LABELS[e.field]??'來源文字',empty=!parts.before&&!parts.match&&!parts.after;
  return <li key={i} className="flex min-w-0 items-baseline gap-1.5">
   <span className="shrink-0 rounded bg-zinc-100 px-1.5 text-[11px] leading-5 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">{label}</span>
   {/* A match whose source text did not arrive is still a match: say the text is missing, never "no match".
       Otherwise one line: the trailing context gives way first, then the leading context is clipped
       from its start (justify-end overflows leftwards), so the mark itself stays visible. */}
   {empty?<span className="text-xs">{e.field==='caption'?'字幕尚未取得':'來源文字未提供'}</span>:<span className="flex min-w-0 whitespace-nowrap" title={e.snippet}>
    {parts.before&&<span className="flex min-w-0 shrink justify-end overflow-hidden"><span>{parts.before}</span></span>}
    {parts.match?<mark className="max-w-full shrink-0 truncate bg-brand-50 text-brand-800 dark:bg-brand-950 dark:text-brand-300">{parts.match}</mark>:null}
    {parts.after&&<span className="min-w-0 flex-1 shrink-[1000] truncate">{parts.after}</span>}
   </span>}
  </li>;
 })}<li><Link href={`${href}#keyword-evidence`} className="inline-flex items-center gap-1 text-xs text-brand-700 hover:underline dark:text-brand-400">查看影片比對依據 →<LinkPending/></Link></li></ul>;
}

/** `total` (when the caller has one) only marks the empty state: a counted 0 is a confirmed empty
 * read in the stated scope, null is uncounted. Neither claims YouTube has no such videos. */
export function KeywordVideoList({rows,total}:{rows:VideoRow[];total?:number|null}){
 if(!rows.length)return <p role="status" data-keyword-list-state={total===0?'none':total===null?'uncounted':undefined} className="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">目前沒有可呈現的符合影片。請參考比對範圍；尚未收錄或比對不完整，不代表 YouTube 沒有相關內容。</p>;
 return <ul className="divide-y divide-zinc-200 dark:divide-zinc-800" aria-label="符合共同標籤的影片列表">{rows.map(row=>{
  const href=`/videos/${encodeURIComponent(row.id)}`,title=row.title||'影片標題尚未取得';
  return <li key={row.id} className="flex items-start gap-3 py-3">
   <div className="min-w-0 flex-1">
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-zinc-600 dark:text-zinc-400">
     <Link href={`/channels/${row.channelId}`} className="inline-flex min-w-0 items-center gap-1.5 font-medium hover:underline"><ChannelAvatar avatar={row.channelAvatar} title={row.channelTitle} size={16}/><span className="min-w-0 break-words">{row.channelTitle||'頻道名稱尚未取得'}</span></Link>
     <span aria-hidden="true">·</span><time dateTime={row.publishedAt??undefined} className="tabular-nums">{dateTime(row.publishedAt)}</time>
    </p>
    <h3 className="mt-1 break-words text-[15px] font-medium leading-6 [overflow-wrap:anywhere]"><Link href={href} className="line-clamp-3 hover:text-brand-700 dark:hover:text-brand-400" title={title}>{title}</Link></h3>
    <Evidence row={row} href={href}/>
    <dl className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs tabular-nums text-zinc-500 dark:text-zinc-400">{[['累計觀看',viewsText(row.views)],['喜歡',count(row.likes)],['留言',count(row.comments)]].map(([label,value])=><div className="flex gap-1" key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
   </div>
   <Link href={href} aria-label={`觀看影片：${title}`} className="mt-1 shrink-0 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"><VideoThumbnail videoId={row.id} title={title} width={96} height={54}/></Link>
  </li>;
 })}</ul>;
}
