import Link from "next/link";
import {
    AiMethod,
    BoardsMethod,
    ChannelMethod,
    CloudMethod,
    CommentMethod,
    CompareTitlesMethod,
    EventsMethod,
    GroupMethod,
    HomeMethod,
    KeywordMethod,
    KeywordRankingMethod,
    LiveMethod,
    MayorMethod,
    SourceMethod,
    TagMethod,
    VideoMethod,
    VocabularyMethod,
} from "@/components/MethodNotes";
import { inlineLink } from "@/components/method/styles";
import { pageMetadata } from "@/lib/seo";
export const metadata = pageMetadata({ title: "資料來源與計算方式", description: "有影儀表板的資料來源、觀測範圍與計算方式：頻道、影片、直播、AI 議題、頻道分類與共同標籤的每個數字怎麼來、有哪些限制。", path: "/about" });

// Every method block in one place, grouped by the page it explains (tag.observe.tw
// /method/); each page's 本頁的資料來源與計算方式 shows only its own blocks.
const GROUPS: Array<{ id: string; title: string; pages?: Array<[string, string]>; body: React.ReactNode }> = [
    { id: "source", title: "資料來源（全站）", pages: [["/channels", "頻道觀測"]], body: <SourceMethod /> },
    { id: "home", title: "首頁", pages: [["/", "首頁"]], body: <HomeMethod /> },
    { id: "keywords", title: "熱門標籤與共同標籤", pages: [["/keywords", "熱門標籤排行"], ["/vocabulary", "共同標籤詞彙"]], body: <><KeywordRankingMethod /><KeywordMethod /><VocabularyMethod /></> },
    { id: "channels", title: "頻道", pages: [["/channels", "頻道觀測"]], body: <ChannelMethod /> },
    { id: "videos", title: "影片", pages: [["/videos", "影片觀測"], ["/compare/titles", "標題用語比較"]], body: <><VideoMethod /><CompareTitlesMethod /></> },
    { id: "live", title: "直播", pages: [["/live/current", "即時直播"], ["/live/walls/news", "四窗直播"]], body: <LiveMethod /> },
    { id: "ai", title: "AI 議題", pages: [["/ai/days", "每日公共議題"]], body: <AiMethod /> },
    { id: "tags", title: "頻道分類", pages: [["/tags", "頻道分類"]], body: <><TagMethod /><CloudMethod /></> },
    { id: "groups", title: "頻道群組", pages: [["/groups", "頻道群組"]], body: <GroupMethod /> },
    { id: "mayor", title: "地方選戰", pages: [["/mayor", "選戰"]], body: <MayorMethod /> },
    { id: "comments", title: "留言", body: <CommentMethod /> },
    { id: "events", title: "事件時間軸", pages: [["/events", "事件時間軸"]], body: <EventsMethod /> },
    { id: "boards", title: "自訂看板", pages: [["/boards", "我的看板"]], body: <BoardsMethod /> },
    {
        id: "about",
        title: "關於有影儀表板",
        pages: [["/about/brand", "標誌"]],
        body: <p>本站延續 youtube.board.tw 的「有影儀表板」，以 YouTube 影片與頻道為觀測來源。操作與版面沿用<a href="https://tag.observe.tw" className={inlineLink}>新文易數</a>，標誌保留舊站播放箭頭穿過橢圓環的意象。</p>,
    },
];

const link = "text-brand-700 hover:underline dark:text-brand-400";

export default function About() {
    return (
        <div data-method-page="" className="lg:grid lg:grid-cols-[minmax(0,48rem)_13rem] lg:justify-between lg:gap-12">
            <article className="min-w-0">
                <h1 className="text-2xl font-semibold tracking-tight">資料來源與計算方式</h1>
                {/* Narrow screens: the groups up top. Wide screens use the side outline instead. */}
                <nav aria-label="目錄" className="mt-5 rounded-lg border border-zinc-200 p-4 text-sm lg:hidden dark:border-zinc-800">
                    <h2 className="text-xs font-medium text-zinc-500 dark:text-zinc-400">目錄</h2>
                    <ol className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
                        {GROUPS.map((group) => <li key={group.id}><a href={`#${group.id}`} className={link}>{group.title}</a></li>)}
                    </ol>
                </nav>
                {GROUPS.map((group) => (
                    <section key={group.id} aria-labelledby={group.id} className="mt-10">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-zinc-200 pb-2 dark:border-zinc-800">
                            <h2 id={group.id} className="scroll-mt-24 text-lg font-semibold tracking-tight">{group.title}</h2>
                            {group.pages && (
                                <p className="flex flex-wrap gap-x-3 text-xs">
                                    {group.pages.map(([href, label]) => <Link key={href} href={href} className={link}>{label} →</Link>)}
                                </p>
                            )}
                        </div>
                        <div className="mt-4 space-y-3 text-sm leading-[1.9] text-zinc-700 dark:text-zinc-300 [&_h3]:scroll-mt-24 [&_h3]:pt-4 [&_h3]:text-[15px] [&_h3]:first:pt-0">
                            {group.body}
                        </div>
                    </section>
                ))}
            </article>
            <nav aria-label="本頁大綱" className="hidden lg:block">
                <ol className="sticky top-24 space-y-1.5 border-l border-zinc-200 pl-4 text-sm dark:border-zinc-800">
                    {GROUPS.map((group) => <li key={group.id}><a href={`#${group.id}`} className="text-zinc-600 hover:text-brand-700 dark:text-zinc-400 dark:hover:text-brand-400">{group.title}</a></li>)}
                </ol>
            </nav>
        </div>
    );
}
