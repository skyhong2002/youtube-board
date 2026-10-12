import { Heading, Unavailable } from "@/components/ReportUI";
import { BoardEditor } from "@/components/BoardEditor";
import { FilterPicker } from "@/components/FilterPicker";
import { parseBoardRequest } from "@/lib/boards";
import type { Search } from "@/lib/api";
export const dynamic = "force-dynamic";
export const metadata = { title: "我的看板" };
export default async function Boards({ searchParams }: { searchParams: Promise<Search> }) {
    const parsed = parseBoardRequest(await searchParams);
    if (!parsed) return <Unavailable status={400} title="看板篩選條件無效" />;
    const { board } = parsed;
    return (
        <>
            <Heading title="我的看板" description="把關注的頻道、分類、日期與共同標籤放在一起，建立可以分享與訂閱的影片觀測頁面。" />
            <BoardEditor key={JSON.stringify(board)} initial={board} pickers={<>
                <FilterPicker name="channelIds" kind="channels" label="來源頻道" value={board.channelIds} />
                <FilterPicker name="tagid" kind="tags" label="頻道分類：同時符合" value={board.tagid} />
                <FilterPicker name="or" kind="tags" label="頻道分類：任一符合" value={board.or} />
                <FilterPicker name="not" kind="tags" label="頻道分類：排除" value={board.not} />
            </>} />
        </>
    );
}
