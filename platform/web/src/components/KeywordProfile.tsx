import type {ReactNode} from 'react';
import Link from 'next/link';
import type {VideoCollection,ReportMeta,VideoRow} from '@/lib/api';
import {count,dateTime} from '@/lib/format';
import {DESCRIPTION_TEMPLATE_NOTE,DISPLAY_EXCLUSION_NOTE,EVIDENCE_FIELD_LABELS,NO_VIEWS,TAG_SOURCE_ATTRIBUTION,evidenceParts,keywordEvidenceOf,viewsText} from '@/lib/keyword-ranking';
import MethodDisclosure from './MethodDisclosure';
import {ChannelAvatar} from './ChannelAvatar';
import {VideoThumbnail} from './VideoThumbnail';
import {KeywordEvidenceNotice} from './KeywordEvidenceNotice';
import FollowButton from './reader/FollowButton';
import LinkPending from './LinkPending';
import KeywordRelations from './KeywordRelations';
import KeywordIllustration from './KeywordIllustration';
import type {KeywordMetadata} from '@/lib/keyword-metadata';

/** Layout from tag.observe.tw tag/[tag] and ArticleResults at afe0a653.
 * Keep API ranking and scope; a page of videos cannot establish global facets. */
/** Text match only; no claim that quality filtering removed promotional or copyright passages. */
export const MATCH_CAVEAT='標題或說明出現標籤，不代表影片主題；可能來自固定宣傳或版權文字。';
type Period={from:string|null;to:string|null;days:string|null;since?:string|null;until?:string|null};
const periodLabel=(p:Period|undefined)=>p?.since&&p?.until?`發布時間 ${dateTime(p.since)} 至 ${dateTime(p.until)}（不含截止時間，台北時間）`:p?.from||p?.to?`發布日期 ${p.from??'不限'} 至 ${p.to??'不限'}（台北時間）`:p?.days&&/^\d+$/.test(p.days)?`往前 ${p.days} 日發布（含今天共 ${Number(p.days)+1} 個台北日曆日）`:p?.days?`往前 ${p.days} 日發布`:'全部已收錄期間';
export function KeywordProfile({keyword,description,data,meta,notice,tabs,filters,pagination,period,metadata}:{
 keyword:string;description:string;data:VideoCollection;meta:ReportMeta;
 notice:ReactNode;tabs:ReactNode;filters:ReactNode;pagination:ReactNode;period?:Period;metadata?:KeywordMetadata;
}){
 return <div className="space-y-6">
  <header className="flex flex-wrap items-baseline justify-between gap-3">
   <div className="min-w-0 space-y-1">
    <div className="flex flex-wrap items-center gap-3"><h1 className="min-w-0 break-words text-2xl font-semibold tracking-tight [overflow-wrap:anywhere]"><span className="text-zinc-500">#</span>{keyword}</h1><FollowButton kind="tag" target={keyword}/></div>
    <p className="max-w-4xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{description}</p>
    <p className="text-sm text-zinc-600 dark:text-zinc-400">更新於 {dateTime(meta.updatedAt)} · 台北時間</p>
   </div>
   <div className="flex gap-4 text-sm"><Link href="/keywords" className="inline-flex items-center gap-1 text-brand-700 hover:underline dark:text-brand-400">熱門標籤排行 →<LinkPending/></Link><a href="#method" className="text-brand-700 hover:underline dark:text-brand-400">怎麼算 ⓘ</a></div>
  </header>
  <section className="grid min-w-0 items-start gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]" aria-label="標籤圖片與關聯">
   <KeywordIllustration key={keyword} keyword={keyword} initialView={metadata?.illustration}/>
   <KeywordRelations key={keyword} keyword={keyword} initialView={metadata?.relations}/>
  </section>
  {notice}
  {tabs}
  {/* One compact line, as tag.observe.tw's ranking subtitle; the long method text is in 「本頁資料來源與計算方式」. */}
  <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-zinc-600 dark:text-zinc-400" aria-label="來源、期間與比對方式">
   <Link className="text-brand-700 hover:underline dark:text-brand-400" href="/vocabulary">{TAG_SOURCE_ATTRIBUTION}</Link>
   <span>{periodLabel(period)}</span>
   <span>比對標題與說明・字幕尚未取得・未比對影片不列入</span>
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
    <p className="text-sm text-zinc-600 dark:text-zinc-400">{MATCH_CAVEAT}</p>
    {/* A page past the results is not "no matches": the counted total says otherwise. */}
    {!data.rows.length&&data.total!==null&&data.total>0?<p className="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400" data-keyword-results="page-empty">這一頁沒有可呈現的影片，但目前條件共 {count(data.total)} 部符合；請改看其他頁碼。</p>:<KeywordVideoList rows={data.rows} total={data.total}/>}
    {pagination}
   </div>

  </section>
  <MethodDisclosure>
   <p>{TAG_SOURCE_ATTRIBUTION}。共同標籤「{keyword}」以文字比對影片標題與說明，不是 AI 判讀；命中不代表事件歸屬或立場，與頻道分類分開。字幕尚未取得，不列入比對。</p>
   <p>僅列出目前詞彙版本與影片標題、說明仍相符的比對結果；待比對或來源文字已變動的影片不會列入，數量見「收錄與比對範圍」。</p>
   <p>期間：「往前 N 日」包含今天與前 N 天，共 N+1 個台北日曆日（往前 7 日為 8 個日曆日）；指定起訖日期時以實際起訖日為準。日數、日期與小時條件會同時套用。</p>
   <p>每支影片最多顯示 3 段命中片段，標示來自標題、說明或字幕；沒有片段時顯示「沒有命中片段」，片段的來源文字缺漏時顯示「來源文字未提供」，不另行補寫。完整比對依據在影片頁的「共同標籤與比對依據」。</p>
   <p>{DISPLAY_EXCLUSION_NOTE}</p>
   <p>{DESCRIPTION_TEMPLATE_NOTE}</p>
   <p>列表與片段只是符合條件的影片例子，不能用來推算整體比例或全站失真程度；有效比對的影片比例只代表比對完成度。</p>
   <p>累計觀看為取得當時的公開觀測值，不是期間增量；{NO_VIEWS}的影片不當作 0。</p>
  </MethodDisclosure>
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
