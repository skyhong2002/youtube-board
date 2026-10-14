import {readKeywordMetadata} from './keyword-metadata-server';
import {reportLinkPrefetch} from "@/lib/report-contract";
import {EventHeader} from '@/components/EventHeader';
import {ChannelProfile} from '@/components/ChannelProfile';
import {VideoSearchReadHint} from '@/components/VideoSearchReadHint';
import {KeywordProfile} from '@/components/KeywordProfile';
import TableScroller from '@/components/TableScroller';
import {ChannelAvatar} from '@/components/ChannelAvatar';
import {VideoThumbnail} from '@/components/VideoThumbnail';
import {table as tableStyle} from '@/lib/table-styles';
import SaveButton from '@/components/reader/SaveButton';
import {familyTabs,eventTabs} from '@/lib/report-navigation';
import {EventAnalysis} from '@/components/EventAnalysis';
import {LiveCoverageNotice} from '@/components/LiveCoverageNotice';
import { VideoCommentSummary } from '@/components/VideoCommentSummary';
import { TagFilters } from '@/components/TagFilters';
import { VideoAnalytics } from '@/components/VideoAnalytics';
import { PromptPreview } from '@/components/PromptPreview';
import { LiveWall } from '@/components/LiveWall';
import Link from "next/link";
import { Fragment } from "react";
import { notFound } from "next/navigation";
import {
    api,
    type Search,
    type Collection,
    type ChannelRow,
    type ChannelData,
    type VideoRow,
    type VideoCollection,
    type VideoData,
    type LiveRow,
    type AiDaysData,
    type AiEventData,
    type TagRow,
    type KeywordRow,
    type TopicRow,
    type HomeData,
} from "./api";
import { KeywordRankingView } from "@/components/KeywordRanking";
import { keywordTabs } from "@/components/VocabularyReport";
import { first, compact, count, dateTime, youtubeUrl } from "./format";
import {reportFilterPath,type ReportRoute} from "./routes";
import {
    Heading,
    DataNotice,
    Empty,
    Unavailable,
    Metric,
    SectionHeading,
    Pagination,
    Tabs,
} from "@/components/ReportUI";
import {
    ChannelTable,
    VideoTable,
    LiveTable,
    TagCards,
} from "@/components/DataViews";
import { ReportFilters } from "@/components/Filters";
import { ExpandedReport } from "@/components/ExpandedReport";
import {
    VocabularyReport,
    VideoTagEvidence,
} from "@/components/VocabularyReport";
import { RefreshControl } from "@/components/RefreshControl";
import { TimeChart } from "@/components/Charts";
function Failure({ status, title }: { status: number; title: string }) {
    if (status === 404) notFound();
    return <Unavailable status={status} title={title} />;
}
function TopicEvidence({ topic }: { topic: TopicRow }) {
    return (
        <>
            <div className="tags">
                {topic.keywords.map((tag) => (
                    <Link
                        className="tag"
                        key={tag}
                        href={`/keywords/${encodeURIComponent(tag)}/videos`}
                    >
                        {tag}
                    </Link>
                ))}
            </div>
            <details>
                <summary
                    className="muted"
                    style={{ fontSize: 12, cursor: "pointer" }}
                >
                    查看分組依據 · {topic.evidence.length} 筆來源分析
                </summary>
                <TableScroller card className="mt-3" label="議題分組依據與影片引用">
                    <table className={"w-full text-left text-sm " + tableStyle.nowrap + " " + tableStyle.stack}>
                        <thead>
                            <tr>
                                <th className={tableStyle.cell}>頻道 / 來源議題</th>
                                <th className={tableStyle.cell}>影片證據</th>
                            </tr>
                        </thead>
                        <tbody>
                            {topic.evidence.map((item, index) => {
                                const unverified = (id: string) => !!item.resolvedVideoIds && !item.resolvedVideoIds.includes(id);
                                const notes = [
                                    item.withheldVideoReferenceCount ? `${count(item.withheldVideoReferenceCount)} 筆引用超過呈現範圍，請查看來源紀錄。` : "",
                                    item.invalidReferenceCount ? `${count(item.invalidReferenceCount)} 筆引用格式不符，未建立連結。` : "",
                                ].filter(Boolean);
                                // One line per cell: the source link comes before the free-text topic so it is never cut.
                                return (
                                <tr className={tableStyle.row} key={`${item.source.id}-${index}`}>
                                    <td data-label="頻道 / 來源議題" className={tableStyle.cell}>
                                        <span className={tableStyle.clip + " sm:max-w-md"} title={`${item.channelTitle} · ${item.event}`}>
                                            <Link
                                                className="hover:underline"
                                                href={`/channels/${item.channelId}`}
                                            >
                                                <ChannelAvatar className="mr-1.5" avatar={item.channelAvatar} title={item.channelTitle} size={20}/>{item.channelTitle}
                                            </Link>
                                            {" · "}
                                            {item.source.snapshotRunId?<small>生成快照來源 #{item.source.id}</small>:<Link className="hover:underline" href={`/channels/${item.channelId}/ai/days?pk=${item.source.id}`}>來源紀錄 #{item.source.id}{item.source.itemIndex===undefined?'':` · 第 ${item.source.itemIndex+1} 項`}</Link>}
                                            {" · "}
                                            <small>{item.event}</small>
                                        </span>
                                    </td>
                                    <td data-label="影片證據" className={tableStyle.cell}>
                                        <span className={tableStyle.clip + " sm:max-w-md"} title={[...notes, item.videoIds.map((id) => unverified(id) ? `${id}（本地來源未核對）` : id).join("、")].join(" ")}>
                                            {notes.map((note) => <small className="mr-1.5" key={note}>{note}</small>)}
                                            {item.videoIds.map((id, i) => <Fragment key={id}>{i > 0 && "、"}{unverified(id)?<span>{id}（本地來源未核對）</span>:(
                                                <Link
                                                    className="hover:underline"
                                                    href={`/videos/${encodeURIComponent(id)}`}
                                                >
                                                    {id}
                                                </Link>
                                            )}</Fragment>)}
                                        </span>
                                    </td>
                                </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </TableScroller>
            </details>
            {topic.unresolvedReferences.length > 0 && (
                <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
                    另有 {topic.unresolvedReferences.length}{" "}
                    筆來源連結尚未完成對應。
                </p>
            )}
        </>
    );
}
export async function ReportPage({
    route,
    search,
    path,
}: {
    route: ReportRoute;
    search: Search;
    path: string;
}) {
    search = { ...search, ...route.query };
    if (route.kind === "video-analytics") return <VideoAnalytics apiPath={route.apiPath} search={search} path={path} />;
    if (route.kind === "prompt-preview") return <PromptPreview apiPath={route.apiPath} search={search} path={path} />;
    if (route.kind === "live-wall") return <LiveWall apiPath={route.apiPath} search={search} path={path} />;
    if (route.kind === "vocabulary")
        return <VocabularyReport search={search} path={path} />;
    if (route.kind === "keyword-ranking") {
        // Same public `home` read as the homepage, so both share one revalidated cache entry.
        const result = await api<HomeData>("home");
        if (!result.ok)
            return <Failure status={result.status} title={route.title} />;
        const { data, meta } = result.response;
        return <KeywordRankingView exploration={data.exploration ?? {}} meta={meta}
            initial={first(search.window) === "today" ? "today" : "week"}
            notice={<DataNotice meta={meta} />}
            tabs={<Tabs active={path} items={keywordTabs} />} />;
    }
    if (["channels", "tag-channels"].includes(route.kind)) {
        const result = await api<import("@/lib/api").ChannelCollection>(route.apiPath, search);
        if (!result.ok)
            return <Failure status={result.status} title={route.title} />;
        const { data, meta } = result.response;
        return (
            <>
                <Heading
                    title={route.title}
                    description={route.description}
                    meta={meta}
                />
                <DataNotice meta={meta} />
                <Tabs items={familyTabs(path,search,meta.coverage)} active={path} />
                <ReportFilters mode="channels" search={search} path={path} channelRanking={data.ranking} />
                <p className="muted">近七日／近月增量取既有期間內可用觀測，並非日曆週月。估計值來自歷史觀測模型，差距為近月估計減去近月觀測增量；缺值顯示「—」。{data.ranking.min!==null?`目前門檻：${data.ranking.minMetric==='views'?'累計觀看':'訂閱人數'}至少 ${count(data.ranking.min)}。`:''}{data.ranking.scope==='tag'?' 分類排名清空門檻時使用 0，未記錄門檻數值的頻道不列入。':''}{data.ranking.minMetric==='views'?' OR 分類條件的門檻依累計觀看篩選。':''}</p>
                <ChannelTable rows={data.rows} offset={data.offset} ranking={data.ranking} />
                <Pagination collection={data} search={search} path={path} />
            </>
        );
    }
    if (
        ["videos", "channel-videos", "tag-videos", "keyword-videos"].includes(
            route.kind,
        )
    ) {
        const [result,metadata] = await Promise.all([
            api<VideoCollection>(route.apiPath, search),
            route.kind==='keyword-videos'&&route.id?readKeywordMetadata(route.id):Promise.resolve(undefined),
        ]);
        if (!result.ok)
            return <><Failure status={result.status} title={route.title} />{result.status===503&&first(search.q)?.trim()&&<><VideoSearchReadHint/><ReportFilters mode="videos" search={search} path={path}/></>}</>;
        const { data, meta } = result.response;
        if(route.kind==='keyword-videos'&&route.id)return <KeywordProfile metadata={metadata} keyword={route.id} description={route.description} data={data} meta={meta}
            period={{from:first(search.from)??null,to:first(search.to)??null,days:first(search.days)??null}}
            notice={<DataNotice meta={meta}/>}
            tabs={<Tabs items={familyTabs(path,search,meta.coverage)} active={path}/>}
            filters={<ReportFilters mode="videos" search={search} path={path}/>}
            pagination={<Pagination collection={data} search={search} path={path}/>}/>;
        return (
            <>
                <Heading
                    title={route.title}
                    description={route.description}
                    meta={meta}
                />
                <DataNotice meta={meta} />
                <Tabs items={familyTabs(path,search,meta.coverage)} active={path} />
                <ReportFilters mode="videos" search={search} path={path} />
                {route.kind==='channel-videos'&&<p className="muted">完整收錄時顯示本機留言數，否則顯示 YouTube 留言觀測；排序仍依 YouTube 原始統計。喜歡占互動＝喜歡 ÷（喜歡＋不喜歡＋顯示留言），任一來源缺值時不估算。作者、回覆與留言獲讚僅呈現完整批次。</p>}
                <VideoTable rows={data.rows} />
                <Pagination collection={data} search={search} path={path} />
            </>
        );
    }
    if (route.kind === "live") {
        const result = await api<Collection<LiveRow>>(route.apiPath, search);
        if (!result.ok)
            return <Failure status={result.status} title={route.title} />;
        const { data, meta } = result.response;
        return (
            <>
                <Heading
                    title={route.title}
                    description={route.description}
                    meta={meta}
                />
                <DataNotice meta={meta} />
                <LiveCoverageNotice coverage={meta.coverage}/>
                <Tabs items={familyTabs(path,search,meta.coverage)} active={path} />
                <RefreshControl />
                <ReportFilters mode="live" search={search} path={path} />
                <div className="metrics">
                    <Metric
                        label="符合篩選的直播"
                        value={count(data.total)}
                        unit="場"
                        detail="名單持續更新，分頁總數可能短暫不同步"
                    />
                    <Metric
                        label="本頁同時在線加總"
                        value={compact(
                            data.rows.reduce(
                                (sum, row) => sum + row.currentViewers,
                                0,
                            ),
                        )}
                        unit="人"
                        detail="不同直播的觀眾可能重複"
                    />
                </div>
                <LiveTable rows={data.rows} offset={data.offset} />
                <Pagination collection={data} search={search} path={path} />
            </>
        );
    }
    if (route.kind === "ai-days") {
        search = {
            ...search,
            ...(route.id ? { date: route.id } : {}),
            ...(route.condition ? { condition: route.condition } : {}),
        };
        const result = await api<AiDaysData>(route.apiPath, search);
        if (!result.ok)
            return <Failure status={result.status} title={route.title} />;
        const { data, meta } = result.response;
        return (
            <>
                <Heading
                    title={route.title}
                    description={route.description}
                    meta={meta}
                />
                <DataNotice meta={meta} />
                <Tabs items={familyTabs(path,search,meta.coverage)} active={path} />
                <ReportFilters
                    mode="ai"
                    search={{
                        ...search,
                        date: first(search.date) || data.date || "",
                    }}
                    path="/ai/days"
                />
                <div className="metrics">
                    <Metric label="分析日期" value={data.date || "—"} />
                    <Metric
                        label="已整理議題"
                        value={count(data.rows.length)}
                        unit="個"
                    />
                    <Metric
                        label="來源頻道"
                        value={count(data.channels)}
                        unit="個"
                    />
                </div>
                <aside className="notice">
                    <p>
                        排序採影片數與來源頻道數的組合分數；分組依據可展開查閱，並非新聞熱度或民意比例。
                    </p>
                </aside>
                {data.rows.length ? (
                    <div className="board-list">
                        {data.rows.map((topic, index) => (
                            <article
                                className="panel"
                                id={`topic-${topic.id}`}
                                key={topic.id}
                            >
                                <span className="card-number">
                                    TOPIC {String(index + 1).padStart(2, "0")}
                                </span>
                                <h2>
                                    {topic.grouping?topic.title:<Link href={`/ai/days/${topic.dailyId}/events?event=${encodeURIComponent(topic.title)}`} prefetch={reportLinkPrefetch(`/ai/days/${topic.dailyId}/events?event=${encodeURIComponent(topic.title)}`)}>{topic.title}</Link>}
                                </h2>
                                <div className="card-meta">
                                    <span>
                                        {count(topic.channelCount)} 個頻道
                                    </span>
                                    <span>
                                        {count(topic.videoCount)} {topic.grouping?'支引用影片（去重）':'筆影片引用'}
                                    </span>
                                    <span>分組分數 {count(topic.score)}</span>
                                </div>
                                <TopicEvidence topic={topic} />
                            </article>
                        ))}
                    </div>
                ) : (
                    <Empty title="這一天尚無已整理的議題" />
                )}
            </>
        );
    }
    if (route.kind === "ai-event") {
        const result = await api<AiEventData>(route.apiPath, search);
        if (!result.ok)
            return <Failure status={result.status} title={route.title} />;
        const { data, meta } = result.response;
        const topics=data.topics?.length?data.topics:data.topic?[data.topic]:[],cover=data.videos.find(v=>/^[A-Za-z0-9_-]{11}$/.test(v.id));
        return <div className="space-y-8">
            <EventHeader title={data.title||route.title} breadcrumb={<><Link href="/ai/days" className="hover:underline">AI 議題</Link> / {data.idKind==='daily'?'每日彙整':'儲存分析'} #{data.id}</>} description={`分析日期：${data.date||"未記錄"}。請搭配來源影片閱讀 AI 整理結果；來源分組不代表已證實為同一事件。`} updatedAt={meta.updatedAt}
                cover={cover?{videoId:cover.id,title:cover.title,channelTitle:cover.channelTitle,channel:{channelId:cover.channelId,channelTitle:cover.channelTitle,channelAvatar:cover.channelAvatar??null}}:null}
                tags={[...new Set(topics.flatMap(t=>t.keywords))].slice(0,12)}
                stats={[{label:'本地來源影片',value:count(data.videos.length)},{label:'來源分組',value:count(topics.length)},{label:'可呈現分析',value:count(data.analyses.length)}]}
                jumps={[["source-evidence","分組依據"],["source-videos","來源影片"],["stored-analysis","儲存分析"]]}/>
            <DataNotice meta={meta}/><Tabs items={eventTabs(path,search)} active={eventTabs(path,search)[0]?.href||path}/>
            <section id="source-evidence" className="scroll-mt-20 space-y-3"><SectionHeading title="分組依據"/>{topics.length>1&&<aside className="rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">同一名稱對應 {topics.length} 個來源分組，以下分開保留各組的比對依據。</aside>}{topics.map((topic,index)=><section className="rounded-xl border border-zinc-300 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900" key={`${topic.id}-${index}`}>{topics.length>1&&<h3 className="mb-2 text-sm font-semibold">來源分組 {index+1}</h3>}<TopicEvidence topic={topic}/></section>)}{!topics.length&&<Empty title="尚無可呈現的分組依據" description="儲存分析與本地來源影片仍分別列示，未推定它們屬於相同分組。"/>}</section>
            <section id="source-videos" className="scroll-mt-20 space-y-3"><SectionHeading title="目前本地影片資料"/><p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">以下為目前本地儲存的影片資料；生成時的來源標題另保留在分析來源快照。</p><VideoTable rows={data.videos}/></section>
            <section id="stored-analysis" className="scroll-mt-20"><SectionHeading title="儲存的事件分析"/><EventAnalysis data={data}/></section>
        </div>;
    }
    if (route.kind === "channel") {
        const result = await api<ChannelData>(route.apiPath, search);
        if (!result.ok)
            return <Failure status={result.status} title={route.title} />;
        const { data, meta } = result.response;
        return <ChannelProfile data={data} meta={meta} path={path} search={search}/>;
    }
    if (route.kind === "video") {
        const result = await api<VideoData>(
            `videos/${encodeURIComponent(route.id!)}`,
            search,
        );
        if (!result.ok)
            return <Failure status={result.status} title={route.title} />;
        const { data, meta } = result.response;
        const v = data.video;
        return (
            <>
                <Heading
                    title={v.title || "影片標題尚未取得"}
                    description={route.description}
                    meta={meta}
                />
                <div className="my-3"><SaveButton kind="video" target={v.id}/></div>
                <DataNotice meta={meta} />
                <Tabs items={[{href:`/videos/${encodeURIComponent(v.id)}`,label:'影片概覽'},{href:`/videos/${encodeURIComponent(v.id)}/analytics`,label:'觀測分析'}]} active={path}/>
                <div className="card-meta">
                    <Link className="inline-flex items-center gap-2" href={`/channels/${v.channelId}`}>
                        <ChannelAvatar avatar={v.channelAvatar} title={v.channelTitle} size={24}/>{v.channelTitle || "頻道名稱尚未取得"}
                    </Link>
                    <span>發布於 {dateTime(v.publishedAt)}</span>
                    <a
                        className="external-link"
                        href={youtubeUrl(v.youtubeUrl)}
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        YouTube 原始影片 ↗
                    </a>
                </div>
                <div className="metrics">
                    <Metric label="觀看數" value={compact(v.views)} unit="次" />
                    <Metric label="喜歡" value={count(v.likes)} unit="次" />
                    <Metric label="YouTube 留言總數" value={count(v.comments)} unit="則" detail="來源公開統計，不等同本站收錄數" />
                    <Metric
                        label="長度"
                        value={
                            data.durationSeconds === null
                                ? "—"
                                : `${Math.floor(data.durationSeconds / 60)}:${String(data.durationSeconds % 60).padStart(2, "0")}`
                        }
                        detail={
                            data.captionAvailable
                                ? "來源提供字幕（尚未擷取逐字稿）"
                                : "字幕狀態未確認"
                        }
                    />
                </div>
                <a className="my-4 block aspect-video w-full max-w-80" href={youtubeUrl(v.youtubeUrl)} target="_blank" rel="noopener noreferrer" aria-label="在 YouTube 開啟原始影片"><VideoThumbnail videoId={v.id} fill sizes="(max-width: 360px) 100vw, 320px"/></a>
                <VideoCommentSummary summary={data.commentSummary} id={v.id} />
                <SectionHeading title="觀看數觀測" />
                {data.history.length ? (
                    <section className="panel">
                        <TimeChart
                            points={data.history.map((item) => ({
                                time: item.date,
                                value: item.views,
                            }))}
                            label="影片累計觀看數觀測"
                            unit="觀看數"
                        />
                        <p style={{ marginTop: 15, marginBottom: 0 }}>
                            每個點代表實際儲存的觀測；連線僅方便閱讀，不代表中間時間的測量值。
                        </p>
                    </section>
                ) : (
                    <Empty title="尚無歷史觀測" description="本站尚未儲存這部影片的歷史觀測。上方為目前統計，無法據以建立歷史時間序列。" />
                )}
                {data.liveHistory.length > 0 && (
                    <>
                        <SectionHeading title="直播同時在線觀測" />
                        <section className="panel">
                            <TimeChart
                                points={data.liveHistory.map((item) => ({
                                    time: item.time,
                                    value: item.viewers,
                                }))}
                                label="直播同時在線觀測"
                                unit="人"
                            />
                        </section>
                    </>
                )}
                <p style={{ marginTop: 20 }}>
                    <Link
                        className="button"
                        href={`/compare/titles?left=${encodeURIComponent(v.id)}`}
                    >
                        比較影片標題用語
                    </Link>
                </p>
                <SectionHeading title="共同標籤" />
                <VideoTagEvidence videoId={v.id} />
                <SectionHeading title="影片說明" />
                <section className="panel">
                    <p
                        style={{
                            whiteSpace: "pre-wrap",
                            overflowWrap: "anywhere",
                        }}
                    >
                        {v.description || "來源尚未提供影片說明。"}
                    </p>
                </section>
            </>
        );
    }
    if (route.kind === "tags") {
        const result = await api<Collection<TagRow>>(route.apiPath, search);
        if (!result.ok)
            return <Failure status={result.status} title={route.title} />;
        const { data, meta } = result.response;
        return (
            <>
                <Heading
                    title={route.title}
                    description={route.description}
                    meta={meta}
                />
                <DataNotice meta={meta} />
                <TagFilters search={search} path={path} />
                <p className="muted">各分類可包含相同頻道；觀看增量不宜跨分類相加。</p>
                <TagCards rows={data.rows} />
                <Pagination collection={data} search={search} path={path} />
            </>
        );
    }

    return (
        <ExpandedReport
            apiPath={route.apiPath}
            path={path}
            search={search}
            title={route.title}
            family={route.family}
            filterPath={reportFilterPath(path,route)}
        />
    );
}
function AnalysisContent({ value }: { value: unknown }) {
    if (typeof value === "string")
        return <p style={{ whiteSpace: "pre-wrap" }}>{value}</p>;
    if (Array.isArray(value))
        return (
            <div>
                {value.map((item, index) => (
                    <AnalysisContent key={index} value={item} />
                ))}
            </div>
        );
    if (value && typeof value === "object")
        return (
            <dl>
                {Object.entries(value).map(([key, item]) => (
                    <div key={key}>
                        <dt style={{ fontSize: 12, fontWeight: 700 }}>{key}</dt>
                        <dd style={{ margin: 0 }}>
                            <AnalysisContent value={item} />
                        </dd>
                    </div>
                ))}
            </dl>
        );
    return value === null || value === undefined ? null : (
        <p>{String(value)}</p>
    );
}
