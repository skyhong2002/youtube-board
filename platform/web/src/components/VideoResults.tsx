import Link from 'next/link';
import type {VideoRow} from '@/lib/api';
import {count,dateTime} from '@/lib/format';
import {VideoMetrics} from './VideoMetrics';
import {ChannelAvatar} from './ChannelAvatar';
import {VideoThumbnail} from './VideoThumbnail';
import {COMMENTS_PUBLISHED} from '@/lib/comments-launch';

/** Mother ArticleResults divided-row layout: one metrics line per video; collection
 * details (authors, replies, observation times) stay on the video page. */
/** `channel` lists one channel's own videos: its name and avatar would repeat on every row, so only the time shows. */
export function VideoResults({rows,report=false,channel=false}:{rows:VideoRow[];report?:boolean;channel?:boolean}){
 if(!rows.length)return <p className="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">目前沒有可呈現的近期影片。尚未收錄，不代表頻道沒有發布影片。</p>;
 const commentsOf=(row:VideoRow)=>row.listing?.scope==='channel'?row.listing.providerComments:row.comments;
 const unobserved=(row:VideoRow)=>row.views===null&&row.likes===null&&commentsOf(row)===null;
 const waiting=channel?rows.filter(unobserved).length:0;
 // Report lists say once, above the rows, what the per-row record time means; each row keeps only its time.
 // A channel's own list says once how many of its newest videos have no counts yet, and those rows say it
 // on their time line instead of a line of their own. On the channel overview, when only some have counts,
 // those lead and the rest fold into one disclosure, so the figures are not buried under empty rows.
 const split=channel&&!report&&waiting>0&&waiting<rows.length;
 const item=(row:VideoRow)=>{
  const href=`/videos/${encodeURIComponent(row.id)}`,title=row.title||'影片標題尚未取得',listing=row.listing;
  const collected=listing?.scope==='channel';
  const status=listing?.commentStatus==='complete'?(listing.recordedComments===null?'完整批次無總數':'完整收錄'):listing?.commentStatus==='pending'?'收錄未完成':'未收錄';
  return <li key={row.id} className="py-3">
   <div className="flex items-start gap-3">
    <div className="min-w-0 flex-1">
     <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-zinc-600 dark:text-zinc-400">{!channel&&<><Link href={`/channels/${row.channelId}`} className="inline-flex min-w-0 items-center gap-1.5 font-medium hover:underline"><ChannelAvatar avatar={row.channelAvatar} title={row.channelTitle} size={16}/><span className="min-w-0 break-words">{row.channelTitle||'頻道名稱尚未取得'}</span></Link><span aria-hidden="true">·</span></>}<time dateTime={row.publishedAt??undefined} className="tabular-nums">{dateTime(row.publishedAt)}</time>{channel&&unobserved(row)&&<><span aria-hidden="true">·</span><span data-video-metrics="none">尚未取得觀看數據</span></>}</p>
     <h3 className="mt-1 break-words text-[15px] font-medium leading-6 [overflow-wrap:anywhere]"><Link href={href} className={(report?'whitespace-normal break-words [overflow-wrap:anywhere] ':'line-clamp-3 ')+'hover:text-brand-700 dark:hover:text-brand-400'} title={title}>{title}</Link></h3>
     {!report&&row.description&&<p className="mt-0.5 line-clamp-2 break-words text-sm text-zinc-600 dark:text-zinc-400 [overflow-wrap:anywhere]">{row.description}</p>}
     {!(channel&&unobserved(row))&&<div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1"><VideoMetrics views={row.views} likes={row.likes} comments={collected?listing.providerComments:row.comments} commentsLabel={collected&&COMMENTS_PUBLISHED?'YouTube 留言':'留言'}/>{collected&&COMMENTS_PUBLISHED&&<p className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">收錄留言 {count(listing.recordedComments)}<span className="ml-1">（{status}）</span></p>}</div>}
    </div>
    <Link href={href} aria-label={`觀看影片：${title}`} className="mt-1 shrink-0 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"><VideoThumbnail videoId={row.id} title={title} width={96} height={54}/></Link>
   </div>
   {report&&<p className="mt-1.5 text-xs tabular-nums text-zinc-600 dark:text-zinc-400">資料最後記錄 {dateTime(row.updatedAt)}</p>}
   {report&&listing?.scope==='taxonomy'&&<dl className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-600 dark:text-zinc-400"><div className="flex gap-1"><dt>每千次觀看留言</dt><dd>{listing.commentsPerThousandViews==null?'—':listing.commentsPerThousandViews.toFixed(2)+'‰'}</dd></div><div className="flex flex-wrap gap-1"><dt>頻道分類</dt><dd>{listing.tags.length?listing.tags.map((tag,i)=><span key={tag.id}>{i>0?'、':''}<Link href={`/tags/${tag.id}/videos`} className="underline">{tag.name}</Link></span>):'尚未收錄'}</dd></div></dl>}
  </li>;
 };
 const list=(items:VideoRow[],label='近期收錄影片列表')=><ul className="divide-y divide-zinc-200 dark:divide-zinc-800" aria-label={label}>{items.map(item)}</ul>;
 const note='mb-1 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400';
 if(split){
  const pending=rows.filter(unobserved);
  return <><p className={note} data-video-coverage="">這 {count(rows.length)} 支近期影片中，{count(rows.length-waiting)} 支已有觀看數據，列在前面；其餘 {count(waiting)} 支尚未取得，收在下方。未取得不代表沒有觀看。</p>
   {list(rows.filter(row=>!unobserved(row)))}
   <details className="group border-t border-zinc-200 dark:border-zinc-800"><summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 py-2 text-sm text-zinc-700 hover:text-brand-700 dark:text-zinc-300 dark:hover:text-brand-400 [&::-webkit-details-marker]:hidden"><span>另有 {count(waiting)} 支近期影片尚未取得觀看數據</span><span aria-hidden="true" className="text-xs text-zinc-500 group-open:hidden">展開 ▾</span><span aria-hidden="true" className="hidden text-xs text-zinc-500 group-open:inline">收合 ▴</span></summary>{list(pending,'尚未取得觀看數據的近期影片')}</details></>;
 }
 return <>{waiting>0&&<p className={note} data-video-coverage="">這 {count(rows.length)} 支近期影片中，{waiting===rows.length?'全部':`${count(waiting)} 支`}尚未取得觀看數據；未取得不代表沒有觀看。</p>}{report&&<p className={note}>各項統計未必在同一時間觀測；「—」表示未取得。每部影片下方的時間是資料最後記錄的時間。</p>}{list(rows)}</>;
}
