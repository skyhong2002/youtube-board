import Link from "next/link";
import {VideoSearchReadHint} from "@/components/VideoSearchReadHint";
import { api, type Search, type VideoCollection } from "@/lib/api";
import { boardApiQuery, boardFeedUrl, boardSearch, parseBoardRequest } from "@/lib/boards";
import { Heading, Unavailable, DataNotice, Pagination } from "@/components/ReportUI";
import { VideoTable } from "@/components/DataViews";
import { KeywordEvidenceNotice } from "@/components/KeywordEvidenceNotice";
import { privateMetadata } from "@/lib/seo";
import { ReportMethod } from "@/components/ReportMethod";
import { BoardsMethod, KeywordMethod } from "@/components/MethodNotes";
export const dynamic = "force-dynamic";
export const metadata = privateMetadata("自訂觀測看板");
export default async function Board({ searchParams }: { searchParams: Promise<Search> }) {
    const parsed = parseBoardRequest(await searchParams);
    if (!parsed) return <Unavailable status={400} title="看板篩選條件無效" />;
    const { board, offset } = parsed;
    const name = board.name || "自訂觀測看板";
    const result = await api<VideoCollection>("videos", boardApiQuery(board, 50, offset));
    if (!result.ok) return <><Unavailable status={result.status} title={name} />{result.status===503&&board.query&&<><VideoSearchReadHint/><Link href={`/boards?${new URLSearchParams(boardSearch(board))}`}>調整這個看板的篩選條件</Link></>}</>;
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
            <div style={{ overflowWrap: "anywhere" }}><Heading title={name} meta={meta} /><p className="-mt-3 mb-4 text-sm text-zinc-600 dark:text-zinc-400">{description}</p></div>
            <DataNotice meta={meta} />
            {board.keyword && <KeywordEvidenceNotice coverage={meta.coverage} subject={board.keyword} scopeLabel="本看板範圍" compact />}
            <p><a className="button" href={boardFeedUrl(board)}>訂閱這個看板的 RSS</a>{" "}<Link className="button" href={`/boards?${new URLSearchParams(search)}`}>收藏或調整這個看板</Link></p>
            <VideoTable rows={data.rows} />
            <Pagination collection={data} search={search} path="/boards/view" />
            <p style={{ marginTop: 20 }}><Link className="button" href="/boards">管理我的看板</Link></p>
            <ReportMethod path="/boards/view" meta={meta}><BoardsMethod />{board.keyword && <KeywordMethod />}</ReportMethod>
        </>
    );
}
