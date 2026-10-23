import {reportLinkPrefetch} from "@/lib/report-contract";
import { CHANNEL_SORTS, type ChannelRanking } from '../../../shared/channel-ranking';
import Link from "next/link";
import { Fragment } from "react";
import {ChannelAvatar} from "./ChannelAvatar";
import {VideoThumbnail} from "./VideoThumbnail";
import {VideoResults} from "./VideoResults";
import Sparkline from "./Sparkline";
import type {
    ChannelRow,
    VideoRow,
    LiveRow,
    TopicRow,
    TagRow,
} from "@/lib/api";
import { count, compact, clockTime, dateTime, shortDateTime, youtubeUrl } from "@/lib/format";
import { LiveSortable, type LiveSortColumn } from "./LiveSortable";
import { LivePreviewThumb } from "./LivePreview";
import { YouTubeFacade } from "./ai/YouTubeFacade";
import { Empty } from "./ReportUI";
import TableScroller from "./TableScroller";
import { table } from "@/lib/table-styles";
import { COMMENTS_PUBLISHED } from "@/lib/comments-launch";
type Tag = ChannelRow["tags"][number];
/** Categories on one clipped line; the full list stays in the title. In the
 *  lead it gives way first and hides once the table is scrolled on phones. */
function TagLine({ tags, href, lead=false, narrow=false, twoLines=false }: { tags: Tag[]; href: (tag: Tag) => string; lead?: boolean; narrow?: boolean; twoLines?: boolean }) {
    return <span className={lead ? `${table.leadWide} ${table.leadText} shrink-3 pl-8 text-xs text-zinc-500 sm:max-w-xs` : twoLines ? 'line-clamp-2 w-34 whitespace-normal text-xs leading-5 text-zinc-500 [overflow-wrap:anywhere]' : `${narrow?table.clip.replace('max-w-xs','max-w-36'):table.clip} text-xs text-zinc-500`} title={tags.map((tag) => tag.name).join("、")}>
        {tags.map((tag, index) => <Fragment key={tag.id}>{index > 0 && "、"}<Link className="hover:underline" href={href(tag)}>{tag.name}</Link></Fragment>)}
    </span>;
}
/** Channel attribution as its own one-line column. */
function ChannelCell({ id, title, avatar, narrow=false }: { id: number; title: string; avatar?: VideoRow["channelAvatar"]; narrow?: boolean }) {
    return <Link className="flex min-w-0 items-center gap-1.5 hover:underline" href={`/channels/${id}`} title={title || undefined}>
        <ChannelAvatar avatar={avatar} title={title} size={16}/><span className={narrow?table.clip.replace('max-w-xs','max-w-40'):table.clip}>{title || "頻道名稱尚未取得"}</span>
    </Link>;
}
const channelColumns = {viewCount:'views',subscriberCount:'subscribers',videoCount:'videoCount',view_week:'weeklyViews',view_month:'monthlyViews',views_pred_week:'estimatedWeeklyViews',views_pred_month:'estimatedMonthlyViews',sub_week:'weeklySubscribers',sub_month:'monthlySubscribers',video_week:'weeklyVideos',video_month:'monthlyVideos'} as const;
/** Channel names wrap on phones up to two lines inside the
 *  9.5rem / 5.5rem lead (full name in the link title); from sm up it stays one clipped line. */
const channelName = `${table.leadText} max-sm:line-clamp-2 max-sm:whitespace-normal max-sm:[overflow-wrap:anywhere] sm:max-w-xs`;
/** Give phone video titles the whole lead width and room for distinguishing suffixes.
 * Desktop titles stay clipped; the small thumbnail yields when the phone table scrolls. */
const videoName = "min-w-0 max-w-full max-sm:w-full max-sm:whitespace-normal max-sm:[overflow-wrap:anywhere] sm:truncate sm:max-w-xs";
/** Live titles take up to two lines on desktop (full title in the tooltip), sized so the table fits the
 * 1152px content column beside the pinned lead. Phones keep the whole title as other video tables do. */
const liveVideoName = videoName.replace("sm:truncate sm:max-w-xs", "sm:line-clamp-2 sm:w-58 sm:whitespace-normal sm:[overflow-wrap:anywhere] sm:leading-5");
const videoLead = `${table.leadBox} flex items-center gap-2 max-sm:flex-col max-sm:items-start`;
export function ChannelTable({ rows, offset=0, ranking, responsive=false }: { rows: ChannelRow[];offset?:number;ranking?:ChannelRanking;responsive?:boolean }) {
    if (!rows.length) return <Empty title="尚無符合條件的頻道" />;
    // As tag.observe.tw's ranking: the sorted metric sits right after the name, so phones see it
    // without scrolling; every other metric follows in its usual order, none dropped or repeated.
    const sorts = ranking ? [...CHANNEL_SORTS.filter(([key]) => key === ranking.column), ...CHANNEL_SORTS.filter(([key]) => key !== ranking.column)] : [];
    return (
        <>
        {responsive&&<ol className="divide-y divide-zinc-200 dark:divide-zinc-800 sm:hidden" aria-label="頻道排行列表">{rows.map((row,index)=>{
          const selected=ranking?CHANNEL_SORTS.find(([key])=>key===ranking.column):undefined;
          return <li key={row.id} className="py-4">
            <div className="flex min-w-0 items-start gap-2"><span className="pt-1 text-xs tabular-nums text-zinc-600 dark:text-zinc-400">{String(offset+index+1).padStart(2,'0')}</span><Link href={`/channels/${row.id}`} className="flex min-w-0 items-start gap-2 font-medium hover:underline"><ChannelAvatar avatar={row.avatar} title={row.title} size={24}/><span className="min-w-0 whitespace-normal break-words [overflow-wrap:anywhere]">{row.title||'頻道名稱尚未取得'}</span></Link></div>
            <dl className="mt-2"><dt className="text-sm text-zinc-600 dark:text-zinc-400">{selected?.[1]??'訂閱人數'}</dt><dd className="mt-1 break-all text-xl font-semibold tabular-nums">{count(selected?row[channelColumns[selected[0]]]:row.subscribers)}</dd></dl>
            <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">資料最後記錄：{dateTime(row.updatedAt)}；不代表各項統計同時更新。</p>
            <details className="mt-2 text-sm"><summary className="flex min-h-11 cursor-pointer items-center font-medium">其他指標與分類</summary><dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 text-sm">{(ranking?CHANNEL_SORTS.filter(([key])=>key!==ranking.column).map(([key,label])=>[label,count(row[channelColumns[key]])]):[['近七日觀看增量',count(row.weeklyViews)],['累計影片',count(row.videoCount)]]).map(([label,value])=><div key={label} className="contents"><dt className="text-zinc-600 dark:text-zinc-400">{label}</dt><dd className="text-right tabular-nums">{value}</dd></div>)}{ranking&&<div className="contents"><dt className="text-zinc-600 dark:text-zinc-400">近月估計差距</dt><dd className="text-right tabular-nums">{count(row.monthlyEstimateGap)}</dd></div>}</dl><p className="mt-3 text-xs text-zinc-600 dark:text-zinc-400">頻道分類：{row.tags.length?row.tags.map((tag,i)=><span key={tag.id}>{i>0?'、':''}<Link href={`/tags/${tag.id}/channels`} className="underline">{tag.name}</Link></span>):'尚未收錄'}</p></details>
          </li>;
        })}</ol>}
        <div className={responsive?'hidden sm:block':undefined}>
        <TableScroller card label="頻道排行表，可左右捲動" showScrollHint={responsive}>
            <table className={`${table.nowrap} w-full`}>
                <thead>
                    <tr>
                        <th className={table.leadHead}>頻道</th>
                        {ranking ? <>{sorts.map(([key,label])=><th key={key} className="number" aria-sort={ranking.column===key?'descending':undefined}>{label}{ranking.column===key&&<span aria-hidden="true"> ↓</span>}</th>)}<th className="number">近月估計差距</th></> : <><th className="number">訂閱人數</th><th className="number">近七日觀看增量</th><th className="number">累計影片</th></>}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row, index) => (
                        <tr key={row.id} className={table.row}>
                            <td className={table.lead}>
                              {/* Phones show only the avatar and name (as tag.observe.tw media rows), the name wrapping to two lines; rank and categories appear from sm up. */}
                              <div className={`${table.leadBox} flex items-center gap-2`}>
                                <span className={`${table.leadWide} shrink-0 text-xs tabular-nums text-zinc-400`}>{String(offset+index+1).padStart(2,'0')}</span>
                                {/* Categories sit under the name so the sticky lead stays narrow and the scrolled metrics keep the width. */}
                                <span className="flex min-w-0 flex-col">
                                <Link className="flex min-w-0 items-center gap-2 font-medium hover:underline" href={`/channels/${row.id}`} title={row.title || undefined}><ChannelAvatar avatar={row.avatar} title={row.title} size={24}/>
                                    <span className={channelName}>{row.title || "頻道名稱尚未取得"}</span>
                                </Link>
                                {row.tags.length > 0 && <TagLine lead tags={row.tags} href={(tag) => `/tags/${tag.id}/channels`}/>}
                                </span>
                              </div>
                            </td>
                            {ranking ? <>{sorts.map(([key])=><td key={key} className="number">{count(row[channelColumns[key]])}</td>)}<td className="number">{count(row.monthlyEstimateGap)}</td></> : <><td className="number">{compact(row.subscribers)}</td><td className="number">{compact(row.weeklyViews)}</td><td className="number">{count(row.videoCount)}</td></>}
                        </tr>
                    ))}
                </tbody>
            </table>
        </TableScroller>
        </div>
        </>
    );
}
export function VideoTable({ rows, responsive=false }: { rows: VideoRow[]; responsive?:boolean }) {
    if (!rows.length) return <Empty title="尚無符合條件的影片" />;
    // Without comment collection a channel listing shows the YouTube count like any other.
    const channelListing=rows.some(r=>r.listing?.scope==='channel'),channel=COMMENTS_PUBLISHED&&channelListing,taxonomy=rows.some(r=>r.listing?.scope==='taxonomy');
    const ratio=(v:number|null|undefined,suffix:string)=>v===null||v===undefined?'—':v.toFixed(2)+suffix;
    // A channel's own video list names the channel once in its breadcrumb, not on every row;
    // the freed width goes to the titles.
    const oneChannel=channelListing&&rows.every(r=>r.listing?.scope==='channel'&&r.channelId===rows[0]!.channelId);
    return (
        <>
        {responsive&&<div className="sm:hidden"><VideoResults rows={rows} report/></div>}
        <div className={responsive?'hidden sm:block':undefined}>
        <TableScroller card label="影片觀測表，可左右捲動" showScrollHint={responsive}>
            <table className={table.nowrap}>
                <thead>
                    <tr>
                        <th className={table.leadHead}>影片</th>
                        {!oneChannel&&<th>頻道</th>}
                        <th>發布時間</th>
                        <th className="number">觀看數</th>
                        <th className="number">喜歡</th>
                        <th className="number">{channel?'留言（收錄／YouTube）':'留言'}</th>
                        {taxonomy&&<><th className="number">每千次觀看留言</th><th>頻道分類</th></>}
                        {channelListing&&<th className="number">喜歡占互動</th>}{channel&&<><th className="number">收錄作者</th><th className="number">收錄回覆</th><th className="number">留言獲讚</th></>}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row) => (
                        <tr key={row.id} className={table.row}>
                            <td className={table.lead}>
                              <div className={videoLead}>
                                <span className={`${table.leadExtra} shrink-0`}><VideoThumbnail videoId={row.id} width={48} height={27}/></span>
                                <Link className={`${oneChannel?videoName.replace('sm:max-w-xs','sm:max-w-xl'):videoName} font-medium hover:underline`}
                                    title={row.title || undefined}
                                    href={`/videos/${encodeURIComponent(row.id)}`}
                                >
                                    {row.title || "影片標題尚未取得"}
                                </Link>
                              </div>
                            </td>
                            {!oneChannel&&<td><ChannelCell id={row.channelId} title={row.channelTitle} avatar={row.channelAvatar}/></td>}
                            <td>
                                <small>{dateTime(row.publishedAt)}</small>
                            </td>
                            <td className="number">{compact(row.views)}</td>
                            <td className="number">{count(row.likes)}</td>
                            <td className="number">{channel?`${count(row.listing?.recordedComments??null)} ／ ${count(row.listing?.providerComments??null)}`:count(row.comments)}{channel&&<small className="ml-1.5">{row.listing?.commentStatus==='complete'?(row.listing.recordedComments===null?'完整批次無總數，顯示 YouTube':'完整收錄'):row.listing?.commentStatus==='pending'?'收錄未完成，顯示 YouTube':'未收錄，顯示 YouTube'}</small>}</td>
                            {taxonomy&&<><td className="number">{ratio(row.listing?.commentsPerThousandViews,'‰')}</td><td>{row.listing?.tags.map(tag=><Link className="badge" key={tag.id} href={`/tags/${tag.id}/videos`}>{tag.name}</Link>)}</td></>}
                            {channelListing&&<td className="number">{ratio(row.listing?.likeSharePercent,'%')}</td>}{channel&&<><td className="number">{count(row.listing?.commentAuthors??null)}</td><td className="number">{count(row.listing?.commentReplies??null)}</td><td className="number">{count(row.listing?.commentLikes??null)}</td></>}
                        </tr>
                    ))}
                </tbody>
            </table>
        </TableScroller>
        </div>
        </>
    );
}
/** live.php 時間 and 最近趨勢線: the start time (publication time until YouTube reports one) and today's last 24 samples. */
const liveStart=(row:LiveRow)=>row.startedAt??row.publishedAt;
const LiveTrend=({row}:{row:LiveRow})=>{
    if(!row.trend.length)return <span>—</span>;
    const start=row.trend[0]!,end=row.trend.at(-1)!;
    // The window is today's (Taipei) latest samples, roughly every 11 minutes; show its clock span so the unit is plain.
    return <span className="inline-flex flex-col items-start gap-0.5" title={`台北時間 ${clockTime(start.time)}–${clockTime(end.time)} 共 ${row.trend.length} 筆取樣：${count(start.value)} → ${count(end.value)} 人`}>
        <span className="text-brand-600 dark:text-brand-400"><Sparkline values={row.trend.map(p=>p.value)} className="h-6 w-16"/></span>
        <small className="text-[10px] leading-3 tabular-nums text-zinc-500 dark:text-zinc-400">{clockTime(start.time)}–{clockTime(end.time)}</small>
    </span>;
};
/** Relative change across the trend window; sorts rising streams first. */
const trendChange=(row:LiveRow)=>row.trend.length<2?null:(row.trend.at(-1)!.value-row.trend[0]!.value)/Math.max(row.trend[0]!.value,1);
const LIVE_COLUMNS:LiveSortColumn[]=[
    {key:'rank',label:'直播',className:table.leadHead,hint:'依同時在線排名'},
    {key:'current',label:'同時在線',numeric:true,className:'number'},
    {key:'todayPeak',label:'今日高峰',numeric:true,className:'number'},
    {key:'trend',label:'今日走勢',hint:'依走勢起訖的增減比例排序'},
    {key:'allTimePeak',label:'歷史高峰',numeric:true,className:'number'},
    {key:'channel',label:'頻道',text:true},
    {key:'tags',label:'頻道分類',text:true},
    {key:'start',label:'開播時間'},
];
export function LiveTable({ rows,offset=0,complete }: { rows: LiveRow[];offset?:number;complete?:string }) {
    if (!rows.length)
        return (
            <Empty
                title="目前沒有符合條件的直播觀測"
                description="直播名單依最近取得的資料顯示；沒有觀測結果不代表 YouTube 上沒有直播。"
            />
        );
    // Long video titles and eight metrics do not fit a phone's sticky lead, so phones get
    // tag's single-column cards; the desktop table fits the 1152px content column.
    return <LiveSortable columns={LIVE_COLUMNS} complete={complete} rowClassName={table.row} tableClassName={`${table.nowrap} w-full [&_td]:py-1 [&_td]:align-middle`} rows={rows.map((row,index)=>({
        key:row.id,
        values:{rank:offset+index,current:row.currentViewers,todayPeak:row.todayPeak,trend:trendChange(row),allTimePeak:row.allTimePeak,channel:row.channelTitle||null,tags:row.tags.map(tag=>tag.name).join('、')||null,start:liveStart(row)?Date.parse(liveStart(row)!):null},
        card:<>
            {/* Phones have no hover: the card leads with a full-width thumbnail that plays the stream inline when tapped. */}
            <YouTubeFacade videoId={row.id} title={row.title||row.channelTitle||row.id}/>
            <div className="mt-3 min-w-0">
              <span className="text-xs tabular-nums text-zinc-600 dark:text-zinc-400">{String(offset+index+1).padStart(2,'0')}</span>
              <Link className="block whitespace-normal break-words font-medium leading-6 hover:underline [overflow-wrap:anywhere]" href={`/videos/${encodeURIComponent(row.id)}`} prefetch={false}>{row.title||"直播標題尚未取得"}</Link>
            </div>
            <div className="mt-3 min-w-0"><ChannelCell id={row.channelId} title={row.channelTitle} avatar={row.channelAvatar}/></div>
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-3 text-sm">
              <div><dt className="text-xs text-zinc-600 dark:text-zinc-400">同時在線</dt><dd className="m-0 font-semibold tabular-nums">{count(row.currentViewers)}</dd></div>
              <div><dt className="text-xs text-zinc-600 dark:text-zinc-400">今日高峰</dt><dd className="m-0 tabular-nums">{count(row.todayPeak)}{row.partialLogEvidence&&<span className="ml-1 text-xs text-zinc-600 dark:text-zinc-400">部分取樣</span>}</dd></div>
              <div><dt className="text-xs text-zinc-600 dark:text-zinc-400">歷史高峰</dt><dd className="m-0 tabular-nums">{count(row.allTimePeak)}</dd></div>
              <div><dt className="text-xs text-zinc-600 dark:text-zinc-400">開播時間</dt><dd className="m-0 whitespace-normal text-xs">{dateTime(liveStart(row))}</dd></div>
              <div><dt className="text-xs text-zinc-600 dark:text-zinc-400">更新時間</dt><dd className="m-0 whitespace-normal text-xs">{dateTime(row.updatedAt)}</dd></div>
              <div className="col-span-2"><dt className="text-xs text-zinc-600 dark:text-zinc-400">今日走勢</dt><dd className="m-0"><LiveTrend row={row}/></dd></div>
              <div className="col-span-2"><dt className="text-xs text-zinc-600 dark:text-zinc-400">頻道分類</dt><dd className="m-0 flex flex-wrap gap-1">{row.tags.length?row.tags.map(tag=><Link className="inline-flex min-h-11 items-center rounded-full border border-zinc-300 px-3 text-sm hover:underline dark:border-zinc-700" key={tag.id} href={`/live/current?tagid=${tag.id}`} prefetch={false}>{tag.name}</Link>):'—'}</dd></div>
            </dl>
            <a className="inline-flex min-h-11 items-center text-sm text-brand-700 underline dark:text-brand-400" href={youtubeUrl(row.youtubeUrl)} target="_blank" rel="noopener noreferrer">YouTube 原始來源 ↗</a>
          </>,
        cells:<>
                            <td className={table.lead}>
                              {/* The live title identifies the video; channel attribution stays in its own column. */}
                              <div className={videoLead}>
                                <span className={`${table.leadWide} shrink-0 text-xs tabular-nums text-zinc-400`}>{String(offset+index+1).padStart(2,'0')}</span>
                                <span className={`${table.leadExtra} shrink-0`}><LivePreviewThumb videoId={row.id} title={row.title||row.channelTitle||row.id}/></span>
                                <Link className={`${liveVideoName} font-medium hover:underline`}
                                    title={[row.channelTitle, row.title].filter(Boolean).join(" · ") || undefined}
                                    href={`/videos/${encodeURIComponent(row.id)}`}
                                >
                                    {row.title || "直播標題尚未取得"}
                                </Link>
                              </div>
                            </td>
                            <td className="number">
                                <strong>{count(row.currentViewers)}</strong>
                            </td>
                            <td className="number">{count(row.todayPeak)}{row.partialLogEvidence&&<small className="ml-1.5">部分取樣</small>}</td>
                            <td><LiveTrend row={row}/></td>
                            <td className="number">{count(row.allTimePeak)}</td>
                            <td><ChannelCell id={row.channelId} title={row.channelTitle} avatar={row.channelAvatar} narrow/></td>
                            <td>{row.tags.length > 0 ? <TagLine tags={row.tags} href={(tag) => `/live/current?tagid=${tag.id}`} twoLines/> : "—"}</td>
                            <td><small><time dateTime={liveStart(row) ?? undefined} title={`更新於 ${dateTime(row.updatedAt)}`}>{shortDateTime(liveStart(row))}</time></small></td>
                        </>,
    }))}/>;
}
export function TopicCards({
    rows,
    date,
}: {
    rows: TopicRow[];
    date: string | null;
}) {
    if (!rows.length)
        return (
            <Empty
                title="這一天尚無已整理的議題"
                description="AI 整理需要可用的來源影片與分析結果；尚未產出不代表沒有公共議題。"
            />
        );
    return (
        <div className="card-grid">
            {rows.map((row, index) => (
                <article className="card" key={row.id}>
                    <div className="card-body">
                        <span className="card-number">
                            TOPIC {String(index + 1).padStart(2, "0")}
                        </span>
                        <h3>
                            <Link
                                href={row.detailUrl??`/ai/days/${row.dailyId}/events?event=${encodeURIComponent(row.title)}`}
                                prefetch={reportLinkPrefetch(row.detailUrl??`/ai/days/${row.dailyId}/events?event=${encodeURIComponent(row.title)}`)}
                            >
                                {row.title}
                            </Link>
                        </h3>
                        <div className="card-meta">
                            <span>{count(row.channelCount)} 個頻道</span>
                            <span>{count(row.videoCount)} {row.grouping?'支引用影片（去重）':'筆影片引用'}</span>
                        </div>
                        <div className="tags">
                            {[...new Set(row.keywords)].slice(0, 5).map((tag) => (
                                <Link
                                    className="tag"
                                    key={tag}
                                    href={`/keywords/${encodeURIComponent(tag)}/videos`}
                                >
                                    {tag}
                                </Link>
                            ))}
                        </div>
                    </div>
                    <div className="card-footer">
                        <span>{date || "日期未記錄"}</span>
                        <span>{row.grouping?'既有來源訊號分組':'AI 輔助整理'}</span>
                    </div>
                </article>
            ))}
        </div>
    );
}
export function TagCards({ rows }: { rows: TagRow[] }) {
    if (!rows.length) return <Empty title="尚無頻道分類" />;
    // A bar against the largest category on this page lets cards be compared at a glance.
    const max = Math.max(1, ...rows.map((row) => row.weeklyViews));
    return (
        <div className="card-grid">
            {rows.map((row) => (
                <Link
                    className="card group block hover:border-brand-600 dark:hover:border-brand-400"
                    key={row.id}
                    href={`/tags/${row.id}/channels`}
                >
                    <div className="card-body space-y-2">
                        <div className="flex items-baseline justify-between gap-3">
                            <h3 className="m-0 text-lg font-semibold group-hover:text-brand-700 dark:group-hover:text-brand-400">{row.name}</h3>
                            <span className="shrink-0 text-xs tabular-nums text-zinc-500 dark:text-zinc-400">{count(row.channels)} 個頻道</span>
                        </div>
                        <p className="m-0 text-xs text-zinc-600 dark:text-zinc-400">近七日觀看增量 <strong className="ml-1 text-base font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{compact(row.weeklyViews)}</strong></p>
                        <span className="block h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800" aria-hidden="true"><span className="block h-full rounded-full bg-brand-600" style={{ width: `${Math.max(1, Math.min(100, (row.weeklyViews / max) * 100))}%` }} /></span>
                        <p className="m-0 text-xs tabular-nums text-zinc-500 dark:text-zinc-400">每頻道平均 {compact(row.average)} · 中位數 {compact(row.median)}</p>
                    </div>
                </Link>
            ))}
        </div>
    );
}
