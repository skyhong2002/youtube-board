import Link from "next/link";
import { api, type Search, type Collection, type VideoRow } from "@/lib/api";
import { boardApiQuery, boardFeedUrl, boardSearch, parseBoardRequest } from "@/lib/boards";
import { Heading, Unavailable, DataNotice, Pagination } from "@/components/ReportUI";
import { VideoTable } from "@/components/DataViews";
import { KeywordEvidenceNotice } from "@/components/KeywordEvidenceNotice";
export const dynamic = "force-dynamic";
export const metadata = { title: "自訂觀測看板" };
export default async function Board({ searchParams }: { searchParams: Promise<Search> }) {
    const parsed = parseBoardRequest(await searchParams);
    if (!parsed) return <Unavailable status={400} title="看板篩選條件無效" />;
    const { board, offset } = parsed;
    const name = board.name || "自訂觀測看板";
    const result = await api<Collection<VideoRow>>("videos", boardApiQuery(board, 50, offset));
    if (!result.ok) return <Unavailable status={result.status} title={name} />;
    const { data, meta } = result.response;
    const description = [
        board.channelIds ? `篩選 ${board.channelIds.split(",").length} 個頻道` : "全部觀測頻道",
        board.tagid && `頻道分類同時符合 ${board.tagid.split(",").length} 類`,
        board.or && `頻道分類任一符合 ${board.or.split(",").length} 類`,
        board.not && `排除頻道分類 ${board.not.split(",").length} 類`,
        board.keyword && `共同標籤「${board.keyword}」`,
        board.query && `影片文字搜尋「${board.query}」`,
        (board.from || board.to) && `發布日期（台北時間）：${board.from || "不限起日"}～${board.to || "不限迄日"}（含當日）`,
    ].filter(Boolean).join("；");
    const search = boardSearch(board);
    return (
        <>
            <div style={{ overflowWrap: "anywhere" }}><Heading title={name} description={`${description}。可複製目前網址分享此設定。`} meta={meta} /></div>
            <DataNotice meta={meta} />
            {board.keyword && <KeywordEvidenceNotice coverage={meta.coverage} subject={board.keyword} scopeLabel="本看板範圍" />}
            <p><a className="button" href={boardFeedUrl(board)}>訂閱這個看板的 RSS</a>{" "}<Link className="button" href={`/boards?${new URLSearchParams(search)}`}>收藏或調整這個看板</Link></p>
            <VideoTable rows={data.rows} />
            <Pagination collection={data} search={search} path="/boards/view" />
            <p style={{ marginTop: 20 }}><Link className="button" href="/boards">管理我的看板</Link></p>
        </>
    );
}
