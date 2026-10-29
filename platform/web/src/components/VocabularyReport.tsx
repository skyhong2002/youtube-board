import FollowButton from './reader/FollowButton';
import TableScroller from './TableScroller';
import {table} from '@/lib/table-styles';
import {reportStyle as ui} from '@/lib/report-styles';
import Link from "next/link";
import {
    api,
    type VocabularyData,
    type Search,
    type VideoTagEvidenceData,
} from "@/lib/api";
import { count, dateTime, first } from "@/lib/format";
import {
    Heading,
    DataNotice,
    Unavailable,
    Empty,
    Metric,
    Pagination,
    Tabs,
    SectionHeading,
} from "./ReportUI";
import { EvidenceDisclosure } from "./EvidenceDisclosure";
import { splitEvidence, tagEvidenceRenderable } from "@/lib/evidence";
import { displayExclusionLabel } from "@/lib/keyword-ranking";
import PageMethod from "./PageMethod";
import { PageNotes, SourceMethod, VocabularyMethod } from "./MethodNotes";
import { metaNotes } from "./ReportMethod";
/** Shared by /keywords (ranking) and /vocabulary (complete original pool). */
export const keywordTabs = [
    { href: "/keywords", label: "熱門標籤排行" },
    { href: "/vocabulary", label: "原始詞彙池" },
    { href: "/tags", label: "頻道分類" },
];
export async function VocabularyReport({
    search,
    path,
}: {
    search: Search;
    path: string;
}) {
    const result = await api<VocabularyData>("vocabulary", search);
    if (!result.ok)
        return <Unavailable status={result.status} title="共同標籤詞彙" />;
    const { data, meta } = result.response;
    return (
        <>
            <Heading
                title="共同標籤詞彙"
                meta={meta}
            />
            <DataNotice meta={meta} />
            <Tabs active={path} items={keywordTabs} />
            <div className="metrics">
                <Metric label="觀測詞彙" value={count(data.total)} unit="個" />
                {data.window ? (
                    <>
                        <Metric
                            label="文章時間窗起點"
                            value={dateTime(data.window.since)}
                        />
                        <Metric
                            label="文章時間窗終點"
                            value={dateTime(data.window.until)}
                        />
                    </>
                ) : (
                    <Metric
                        label="同步範圍"
                        value={
                            data.coverage === "all-current-indexed-article-tags"
                                ? "目前已索引文章"
                                : "未記錄"
                        }
                    />
                )}
                <Metric
                    label="本機同步發布"
                    value={dateTime(data.publishedAt)}
                />
            </div>
            <form action={path} className={ui.form}>
                <label className={ui.label}>
                    搜尋詞彙
                    <input className={ui.input}
                        type="search"
                        name="q"
                        defaultValue={first(search.q) || ""}
                        placeholder="搜尋人物、地點或議題"
                    />
                </label>
                <button type="submit" className={ui.primary}>
                    搜尋
                </button>
            </form>
            {data.rows.length ? (
                <TableScroller label="共同詞彙表格，可左右捲動">
                    <table className={"w-full text-left text-sm " + table.nowrap}>
                        <thead className="bg-(--table-head-bg) text-xs text-zinc-600 dark:text-zinc-400">
                            <tr>
                                <th className={table.leadHead}>內容詞彙</th>
                                <th className={table.num}>新聞文章數</th>
                                <th className={table.cell}>排行顯示</th>
                                <th className={table.cell}>觀測媒體</th>
                                <th className={table.cell}>跨平台探索</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                            {data.rows.map((term) => (
                                <tr className={table.row} key={term.key}>
                                    <td className={table.lead}>
                                        <div className={table.leadBox}>
                                            <strong className={table.leadText + " block sm:max-w-xs"} title={term.term}>{term.term}</strong>
                                        </div>
                                    </td>
                                    <td className={table.num}>
                                        {count(term.articleCount)}
                                    </td>
                                    <td className={table.cell + (term.displayExclusion ? " text-amber-800 dark:text-amber-300" : " text-zinc-600 dark:text-zinc-400")}>
                                        {term.rankingEligibility?<><span className="block">過去24小時：{displayExclusionLabel(term.rankingEligibility.today)}</span><span className="block">近七日：{displayExclusionLabel(term.rankingEligibility.week)}</span></>:displayExclusionLabel(term.displayExclusion)}
                                    </td>
                                    <td className={table.cell}>
                                        <div className="flex items-center gap-1.5">
                                            {term.media
                                                .slice(0, 6)
                                                .map((name) => (
                                                    <span
                                                        className={ui.tag}
                                                        key={name}
                                                    >
                                                        {name}
                                                    </span>
                                                ))}
                                            {term.media.length > 6 && (
                                                <span className={ui.tag}>
                                                    另 {term.media.length - 6}{" "}
                                                    個
                                                </span>
                                            )}
                                        </div>
                                    </td>
                                    <td className={table.cell}>
                                        <div className="flex items-center gap-3"><FollowButton kind="tag" target={term.term}/>
                                            <Link
                                                className={ui.link}
                                                href={`/keywords/${encodeURIComponent(term.term)}/videos`}
                                            >
                                                搜尋影片 →
                                            </Link>
                                            <Link
                                                className={ui.link}
                                                href={`/boards?${new URLSearchParams({ keyword: term.term })}`}
                                            >
                                                建立觀測看板 →
                                            </Link>
                                            <a
                                                className={ui.link}
                                                href={`https://tag.observe.tw/tag/${encodeURIComponent(term.term)}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                            >
                                                新聞來源 ↗
                                            </a>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </TableScroller>
            ) : (
                <Empty
                    title="尚無符合條件的共同詞彙"
                    description={
                        data.version
                            ? "請調整搜尋條件。"
                            : "尚未完成共同詞彙同步；不使用排行榜前幾名代替完整的觀測時間窗。"
                    }
                />
            )}
            <Pagination collection={data} search={search} path={path} />
            <PageMethod>
                <VocabularyMethod />
                <PageNotes notes={[
                    "沿用新文易數持續維護的新聞標籤，作為跨平台探索的共同詞彙；這裡列出完整的原始詞彙池，包含不列入熱門標籤排行的詞，排除只影響排行顯示，詞彙與比對證據不會刪除。",
                    data.coverage === "all-current-indexed-article-tags"
                        ? "範圍：上游目前已索引文章的標籤，不代表全部可能詞彙或完整人工分類詞典。"
                        : `範圍：上游文章時間窗${data.window ? `（${dateTime(data.window.since)} 至 ${dateTime(data.window.until)}）` : ""}內已觀測到的標籤，不是新文易數全部歷史文章的完整標籤庫。`,
                    data.upstreamSnapshotConsistent ? "上游提供版本固定的快照。" : "上游讀取不保證同一時間的完整快照，同步期間的上游資料可能更新。",
                    ...(data.sourceQuality ? [`上游標籤正規化：保留 ${count(data.sourceQuality.normalizedTags)} 個、捨棄 ${count(data.sourceQuality.rejectedTags)} 個格式不符的標籤（涉及 ${count(data.sourceQuality.articlesWithRejectedTags)} 篇文章）。`] : []),
                    `同步版本：${data.version || "尚未同步"}`,
                    ...metaNotes(meta),
                ]} />
                <SourceMethod />
            </PageMethod>
        </>
    );
}
// Display only: about 20 characters either side of the match; the full snippet stays in the title.
const EVIDENCE_CONTEXT = 20;
const clipStart = (text: string) => { const chars = [...text]; return chars.length > EVIDENCE_CONTEXT ? "…" + chars.slice(-EVIDENCE_CONTEXT).join("") : text; };
const clipEnd = (text: string) => { const chars = [...text]; return chars.length > EVIDENCE_CONTEXT ? chars.slice(0, EVIDENCE_CONTEXT).join("") + "…" : text; };
const evidenceFields: Record<string, string> = { title: "影片標題", description: "影片說明", caption: "字幕" };
/** 共同標籤 on a video page: the matched tags as chips, then where each matched (比對依據)
 * behind a disclosure. Keyword pages link here with #keyword-evidence, which opens it. */
export async function VideoTagEvidence({ videoId }: { videoId: string }) {
    // Optional beside the video's own data: a missing or malformed tag payload keeps the
    // note below; transient failures throw in ISR rather than caching this note.
    const result = await api<VideoTagEvidenceData>(
        `videos/${encodeURIComponent(videoId)}/tags`,
        {},
        { optional: true },
    );
    if (!result.ok || !tagEvidenceRenderable(result.response.data))
        return (
            <section id="keyword-evidence" className="scroll-mt-20">
                <SectionHeading title="共同標籤" />
                <p className={ui.note}>共同標籤的比對證據暫時無法讀取。</p>
            </section>
        );
    const { data } = result.response;
    const statuses = {
        "not-synchronized": "共同詞彙尚未同步",
        "not-matched": "這支影片尚未比對共同詞彙",
        matched: "已比對共同詞彙",
        stale: "影片內容或詞彙版本已更新，以下是前次比對結果",
    };
    // One chip per tag, in first-match order; a tag matched several times is still one tag.
    const terms = [...new Set(data.rows.map((row) => row.term))];
    return (
        <section id="keyword-evidence" className="scroll-mt-20">
            <SectionHeading title="共同標籤" />
            <div className={ui.panel}>
                <p className="text-xs text-zinc-600 dark:text-zinc-400">
                    {statuses[data.status] ?? "比對狀態尚未確認"}
                    {terms.length > 0 && ` · ${count(terms.length)} 個標籤`}
                    {data.matchedAt && ` · 比對時間 ${dateTime(data.matchedAt)}`}
                </p>
                {terms.length ? (
                    <ul className="mt-3 flex flex-wrap gap-2" aria-label="共同標籤">
                        {terms.map((term) => (
                            <li key={term}>
                                <Link className={ui.tag + " hover:bg-zinc-200 dark:hover:bg-zinc-700"} href={`/keywords/${encodeURIComponent(term)}/videos`}>{term}</Link>
                            </li>
                        ))}
                    </ul>
                ) : (
                    data.status === "matched" && <p className="mt-2 text-sm">本次沒有精確文字命中。</p>
                )}
                {data.rows.length > 0 && (
                    <EvidenceDisclosure anchor="keyword-evidence" open={data.rows.length <= 5} summary={`比對依據（${count(data.rows.length)} 處）`}>
                        <ol className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
                            {data.rows.map((evidence, index) => {
                                const parts = splitEvidence(evidence);
                                return (
                                    <li key={`${evidence.key}-${index}`} className="py-2" style={{ overflowWrap: "anywhere" }}>
                                        <span className="mr-2 font-medium">{evidence.term}</span>
                                        <span className="mr-2 text-xs text-zinc-500 dark:text-zinc-400">{evidenceFields[evidence.field] ?? "來源文字"}</span>
                                        <span className="text-zinc-700 dark:text-zinc-300" title={evidence.snippet}>
                                            {parts.match ? clipStart(parts.before) : parts.before}
                                            <mark style={{ background: "var(--tint)", color: "var(--accent)" }}>{parts.match}</mark>
                                            {clipEnd(parts.after)}
                                        </span>
                                    </li>
                                );
                            })}
                        </ol>
                    </EvidenceDisclosure>
                )}
                <details className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    <summary className="cursor-pointer py-1">比對版本</summary>
                    <p style={{ overflowWrap: "anywhere" }}>{data.version || "尚無版本"}</p>
                </details>
            </div>
        </section>
    );
}
