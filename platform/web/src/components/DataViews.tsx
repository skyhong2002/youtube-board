import { CHANNEL_SORTS, type ChannelRanking } from '../../../shared/channel-ranking';
import Link from "next/link";
import { Fragment } from "react";
import {ChannelAvatar} from "./ChannelAvatar";
import {VideoThumbnail} from "./VideoThumbnail";
import type {
    ChannelRow,
    VideoRow,
    LiveRow,
    TopicRow,
    TagRow,
} from "@/lib/api";
import { count, compact, dateTime, youtubeUrl } from "@/lib/format";
import { Empty } from "./ReportUI";
import TableScroller from "./TableScroller";
import { table } from "@/lib/table-styles";
type Tag = ChannelRow["tags"][number];
/** Categories on one clipped line; the full list stays in the title. In the
 *  lead it gives way first and hides once the table is scrolled on phones. */
function TagLine({ tags, href, lead=false }: { tags: Tag[]; href: (tag: Tag) => string; lead?: boolean }) {
    return <span className={lead ? `${table.leadWide} ${table.leadText} shrink-3 text-xs text-zinc-500 sm:max-w-48` : `${table.clip} text-xs text-zinc-500`} title={tags.map((tag) => tag.name).join("、")}>
        {tags.map((tag, index) => <Fragment key={tag.id}>{index > 0 && "、"}<Link className="hover:underline" href={href(tag)}>{tag.name}</Link></Fragment>)}
    </span>;
}
/** Channel attribution as its own one-line column. */
function ChannelCell({ id, title, avatar }: { id: number; title: string; avatar?: VideoRow["channelAvatar"] }) {
    return <Link className="flex min-w-0 items-center gap-1.5 hover:underline" href={`/channels/${id}`} title={title || undefined}>
        <ChannelAvatar avatar={avatar} title={title} size={16}/><span className={table.clip}>{title || "頻道名稱尚未取得"}</span>
    </Link>;
}
const channelColumns = {viewCount:'views',subscriberCount:'subscribers',videoCount:'videoCount',view_week:'weeklyViews',view_month:'monthlyViews',views_pred_week:'estimatedWeeklyViews',views_pred_month:'estimatedMonthlyViews',sub_week:'weeklySubscribers',sub_month:'monthlySubscribers',video_week:'weeklyVideos',video_month:'monthlyVideos'} as const;
/** The channel name is the one lead text allowed to wrap: on phones up to two lines inside the
 *  9.5rem / 5.5rem lead (full name in the link title); from sm up it stays one clipped line. */
const channelName = `${table.leadText} max-sm:line-clamp-2 max-sm:whitespace-normal max-sm:[overflow-wrap:anywhere] sm:max-w-xs`;
export function ChannelTable({ rows, offset=0, ranking }: { rows: ChannelRow[];offset?:number;ranking?:ChannelRanking }) {
    if (!rows.length) return <Empty title="尚無符合條件的頻道" />;
    // As tag.observe.tw's ranking: the sorted metric sits right after the name, so phones see it
    // without scrolling; every other metric follows in its usual order, none dropped or repeated.
    const sorts = ranking ? [...CHANNEL_SORTS.filter(([key]) => key === ranking.column), ...CHANNEL_SORTS.filter(([key]) => key !== ranking.column)] : [];
    return (
        <TableScroller card label="頻道排行表，可左右捲動">
            <table className={table.nowrap} style={ranking?{minWidth:1780}:undefined}>
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
                                <Link className="flex min-w-0 items-center gap-2 font-medium hover:underline" href={`/channels/${row.id}`} title={row.title || undefined}><ChannelAvatar avatar={row.avatar} title={row.title} size={24}/>
                                    <span className={channelName}>{row.title || "頻道名稱尚未取得"}</span>
                                </Link>
                                {row.tags.length > 0 && <TagLine lead tags={row.tags} href={(tag) => `/tags/${tag.id}/channels`}/>}
                              </div>
                            </td>
                            {ranking ? <>{sorts.map(([key])=><td key={key} className="number">{count(row[channelColumns[key]])}</td>)}<td className="number">{count(row.monthlyEstimateGap)}</td></> : <><td className="number">{compact(row.subscribers)}</td><td className="number">{compact(row.weeklyViews)}</td><td className="number">{count(row.videoCount)}</td></>}
                        </tr>
                    ))}
                </tbody>
            </table>
        </TableScroller>
    );
}
export function VideoTable({ rows }: { rows: VideoRow[] }) {
    if (!rows.length) return <Empty title="尚無符合條件的影片" />;
    const channel=rows.some(r=>r.listing?.scope==='channel'),taxonomy=rows.some(r=>r.listing?.scope==='taxonomy');
    const ratio=(v:number|null|undefined,suffix:string)=>v===null||v===undefined?'—':v.toFixed(2)+suffix;
    return (
        <TableScroller card label="影片觀測表，可左右捲動">
            <table className={table.nowrap}>
                <thead>
                    <tr>
                        <th className={table.leadHead}>影片</th>
                        <th>頻道</th>
                        <th>發布時間</th>
                        <th className="number">觀看數</th>
                        <th className="number">喜歡</th>
                        <th className="number">{channel?'留言（收錄／YouTube）':'留言'}</th>
                        {taxonomy&&<><th className="number">每千次觀看留言</th><th>頻道分類</th></>}
                        {channel&&<><th className="number">喜歡占互動</th><th className="number">收錄作者</th><th className="number">收錄回覆</th><th className="number">留言獲讚</th></>}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row) => (
                        <tr key={row.id} className={table.row}>
                            <td className={table.lead}>
                              {/* Phones give the whole lead to the title; the thumbnail appears from sm up. */}
                              <div className={`${table.leadBox} flex items-center gap-2`}>
                                <span className={`${table.leadWide} shrink-0`}><VideoThumbnail videoId={row.id} width={48} height={27}/></span>
                                <Link className={`${table.leadText} font-medium hover:underline sm:max-w-xs`}
                                    title={row.title || undefined}
                                    href={`/videos/${encodeURIComponent(row.id)}`}
                                >
                                    {row.title || "影片標題尚未取得"}
                                </Link>
                              </div>
                            </td>
                            <td><ChannelCell id={row.channelId} title={row.channelTitle} avatar={row.channelAvatar}/></td>
                            <td>
                                <small>{dateTime(row.publishedAt)}</small>
                            </td>
                            <td className="number">{compact(row.views)}</td>
                            <td className="number">{count(row.likes)}</td>
                            <td className="number">{channel?`${count(row.listing?.recordedComments??null)} ／ ${count(row.listing?.providerComments??null)}`:count(row.comments)}{channel&&<small className="ml-1.5">{row.listing?.commentStatus==='complete'?(row.listing.recordedComments===null?'完整批次無總數，顯示 YouTube':'完整收錄'):row.listing?.commentStatus==='pending'?'收錄未完成，顯示 YouTube':'未收錄，顯示 YouTube'}</small>}</td>
                            {taxonomy&&<><td className="number">{ratio(row.listing?.commentsPerThousandViews,'‰')}</td><td>{row.listing?.tags.map(tag=><Link className="badge" key={tag.id} href={`/tags/${tag.id}/videos`}>{tag.name}</Link>)}</td></>}
                            {channel&&<><td className="number">{ratio(row.listing?.likeSharePercent,'%')}</td><td className="number">{count(row.listing?.commentAuthors??null)}</td><td className="number">{count(row.listing?.commentReplies??null)}</td><td className="number">{count(row.listing?.commentLikes??null)}</td></>}
                        </tr>
                    ))}
                </tbody>
            </table>
        </TableScroller>
    );
}
export function LiveTable({ rows,offset=0 }: { rows: LiveRow[];offset?:number }) {
    if (!rows.length)
        return (
            <Empty
                title="目前沒有符合條件的直播觀測"
                description="直播名單依最近取得的資料顯示；沒有觀測結果不代表 YouTube 上沒有直播。"
            />
        );
    return (
        <TableScroller card label="直播觀測表，可左右捲動">
            <table className={table.nowrap}>
                <thead>
                    <tr>
                        <th className={table.leadHead}>直播 / 頻道</th>
                        <th className="number">同時在線</th>
                        <th className="number">今日高峰</th>
                        <th className="number">歷史高峰</th>
                        <th>頻道</th>
                        <th>頻道分類</th>
                        <th>更新時間</th>
                        <th>原始來源</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row, index) => (
                        <tr key={row.id} className={table.row}>
                            <td className={table.lead}>
                              {/* One line. Desktop: rank, thumbnail, title. Phones: only the channel avatar marks the
                                  source (many live titles share a prefix) so the title keeps the lead; the channel name
                                  is in its own column, and the full text stays in the link title. */}
                              <div className={`${table.leadBox} flex items-center gap-2`}>
                                <span className={`${table.leadWide} shrink-0 text-xs tabular-nums text-zinc-400`}>{String(offset+index+1).padStart(2,'0')}</span>
                                <span className={`${table.leadWide} shrink-0`}><VideoThumbnail videoId={row.id} width={48} height={27}/></span>
                                <Link className="flex min-w-0 items-center gap-1.5 font-medium hover:underline sm:max-w-xs"
                                    title={[row.channelTitle, row.title].filter(Boolean).join(" · ") || undefined}
                                    href={`/videos/${encodeURIComponent(row.id)}`}
                                >
                                    <span className="shrink-0 sm:hidden"><ChannelAvatar avatar={row.channelAvatar} title={row.channelTitle} size={16}/></span>
                                    <span className={table.leadText}>{row.title || "直播標題尚未取得"}</span>
                                </Link>
                              </div>
                            </td>
                            <td className="number">
                                <strong>{count(row.currentViewers)}</strong>
                            </td>
                            <td className="number">{count(row.todayPeak)}{row.partialLogEvidence&&<small className="ml-1.5">部分取樣</small>}</td>
                            <td className="number">{count(row.allTimePeak)}</td>
                            <td><ChannelCell id={row.channelId} title={row.channelTitle} avatar={row.channelAvatar}/></td>
                            <td>{row.tags.length > 0 ? <TagLine tags={row.tags} href={(tag) => `/live/current?tagid=${tag.id}`}/> : "—"}</td>
                            <td><small>{dateTime(row.updatedAt)}</small></td>
                            <td>
                                <a
                                    className="external-link"
                                    href={youtubeUrl(row.youtubeUrl)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    YouTube ↗
                                </a>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </TableScroller>
    );
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
    return (
        <div className="card-grid">
            {rows.map((row) => (
                <Link
                    className="card"
                    key={row.id}
                    href={`/tags/${row.id}/channels`}
                >
                    <div className="card-body">
                        <p className="eyebrow">CHANNEL CATEGORY</p>
                        <h3>{row.name}</h3>
                        <div className="card-meta">
                            <span>{count(row.channels)} 個頻道</span>
                            <span>
                                近七日 {compact(row.weeklyViews)} 次觀看增量
                            </span>
                            <span>平均 {compact(row.average)} 次 · 中位數 {compact(row.median)} 次</span>
                        </div>
                    </div>
                </Link>
            ))}
        </div>
    );
}
