import Link from "next/link";
import {ChannelAvatar} from "@/components/ChannelAvatar";
import {VideoThumbnail} from "@/components/VideoThumbnail";
import {
    api,
    type Search,
    type VideoCollection,
    type VideoRow,
    type VideoData,
} from "@/lib/api";
import { first, dateTime } from "@/lib/format";
import { reportStyle as ui } from "@/lib/report-styles";
import { compareTitles, type TitlePiece } from "@/lib/headline";
import { Heading, DataNotice, Unavailable } from "@/components/ReportUI";
import { pageMetadata } from "@/lib/seo";
import { ReportMethod } from "@/components/ReportMethod";
import { CompareTitlesMethod } from "@/components/MethodNotes";
export const dynamic = "force-dynamic";
export const metadata = pageMetadata({ title: "影片標題用語比較", description: "並排比較兩支 YouTube 影片標題的用語與寫法差異，回到各自的影片觀測與原始來源。", path: "/compare/titles" });
export default async function Compare({
    searchParams,
}: {
    searchParams: Promise<Search>;
}) {
    const search = await searchParams;
    const leftId = first(search.left),
        rightId = first(search.right);
    const [list, left, right] = await Promise.all([
        api<VideoCollection>("videos", { limit: "50" }),
        leftId ? api<VideoData>(`videos/${encodeURIComponent(leftId)}`) : null,
        rightId
            ? api<VideoData>(`videos/${encodeURIComponent(rightId)}`)
            : null,
    ]);
    if (!list.ok)
        return <Unavailable status={list.status} title="影片標題用語比較" />;
    const options = new Map(
        list.response.data.rows.map((row) => [row.id, row]),
    );
    if (left?.ok)
        options.set(left.response.data.video.id, left.response.data.video);
    if (right?.ok)
        options.set(right.response.data.video.id, right.response.data.video);
    const compared =
        left?.ok && right?.ok
            ? compareTitles(
                  left.response.data.video.title,
                  right.response.data.video.title,
              )
            : null;
    return (
        <>
            <Heading
                title="影片標題用語比較"
                meta={list.response.meta}
            />
            <DataNotice meta={list.response.meta} />
            {/* Same controls as the report filters; a long title must not widen the select past the column. */}
            <form className={ui.form} action="/compare/titles">
                <label className={`${ui.label} min-w-0 flex-1 basis-64`}>
                    左側影片
                    <select className={`${ui.input} w-full min-w-0`} name="left" required defaultValue={leftId || ""}>
                        <option value="">選擇影片</option>
                        {[...options.values()].map((row) => (
                            <option value={row.id} key={row.id}>
                                {row.channelTitle} · {row.title}
                            </option>
                        ))}
                    </select>
                </label>
                <label className={`${ui.label} min-w-0 flex-1 basis-64`}>
                    右側影片
                    <select className={`${ui.input} w-full min-w-0`} name="right" required defaultValue={rightId || ""}>
                        <option value="">選擇影片</option>
                        {[...options.values()].map((row) => (
                            <option value={row.id} key={row.id}>
                                {row.channelTitle} · {row.title}
                            </option>
                        ))}
                    </select>
                </label>
                <button className={ui.primary}>比較</button>
            </form>
            {(left && !left.ok) || (right && !right.ok) ? (
                <p role="alert">部分影片無法取得，請重新選擇。</p>
            ) : null}
            {left?.ok && right?.ok && (
                <>
                    <div
                        className="card-grid"
                        style={{
                            gridTemplateColumns:
                                "repeat(auto-fit,minmax(min(100%,300px),1fr))",
                        }}
                    >
                        <ComparedTitle
                            video={left.response.data.video}
                            pieces={compared?.left}
                        />
                        <ComparedTitle
                            video={right.response.data.video}
                            pieces={compared?.right}
                        />
                    </div>
                    {leftId === rightId && (
                        <p className="muted">目前選擇了同一支影片。</p>
                    )}
                    {!compared && (
                        <p className="muted">
                            標題超過比較長度上限，目前呈現完整原文。
                        </p>
                    )}
                </>
            )}
            <ReportMethod path="/compare/titles" meta={list.response.meta}><CompareTitlesMethod /></ReportMethod>
        </>
    );
}
function ComparedTitle({
    video,
    pieces,
}: {
    video: VideoRow;
    pieces?: TitlePiece[];
}) {
    return (
        <article className="panel">
            <p className="eyebrow"><ChannelAvatar avatar={video.channelAvatar} title={video.channelTitle} size={20}/>{" "}{video.channelTitle}</p>
            <VideoThumbnail videoId={video.id} width={160} height={90}/>
            <h2 style={{ lineHeight: 1.8 }}>
                {pieces
                    ? pieces.map((piece, index) =>
                          piece.shared ? (
                              <mark
                                  key={index}
                                  style={{
                                      background: "var(--tint)",
                                      color: "var(--accent)",
                                  }}
                              >
                                  {piece.text}
                              </mark>
                          ) : (
                              piece.text
                          ),
                      )
                    : video.title}
            </h2>
            <p>{dateTime(video.publishedAt)}</p>
            <Link
                className="external-link"
                href={`/videos/${encodeURIComponent(video.id)}`}
            >
                影片與來源資料 →
            </Link>
        </article>
    );
}
