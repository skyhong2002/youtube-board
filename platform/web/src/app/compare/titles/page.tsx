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
import { compareTitles, type TitlePiece } from "@/lib/headline";
import { Heading, DataNotice, Unavailable } from "@/components/ReportUI";
export const dynamic = "force-dynamic";
export const metadata = { title: "影片標題用語比較" };
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
                description="並排閱讀不同影片的標題，觀察共有文字與各自使用的措辭。"
            />
            <DataNotice meta={list.response.meta} />
            <form className="filters" action="/compare/titles">
                <label style={{ flex: 1, minWidth: 0 }}>
                    左側影片
                    <select name="left" required defaultValue={leftId || ""}>
                        <option value="">選擇影片</option>
                        {[...options.values()].map((row) => (
                            <option value={row.id} key={row.id}>
                                {row.channelTitle} · {row.title}
                            </option>
                        ))}
                    </select>
                </label>
                <label style={{ flex: 1, minWidth: 0 }}>
                    右側影片
                    <select name="right" required defaultValue={rightId || ""}>
                        <option value="">選擇影片</option>
                        {[...options.values()].map((row) => (
                            <option value={row.id} key={row.id}>
                                {row.channelTitle} · {row.title}
                            </option>
                        ))}
                    </select>
                </label>
                <button className="button button-primary">比較</button>
            </form>
            <aside className="notice">
                <p>
                    標記顯示字元順序的共有部分；未標記部分是各標題的措辭。文字相同不等於報導同一事件，也不能據此推論抄襲、協同行動或因果關係。
                </p>
            </aside>
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
