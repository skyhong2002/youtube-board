import {readKeywordMetadata} from './keyword-metadata-server';
import {filterOptionsMatch,type FilterOptions} from '../../../shared/filter-options';
import {ChannelProfile} from '@/components/ChannelProfile';
import {VideoSearchReadHint} from '@/components/VideoSearchReadHint';
import {KeywordProfile} from '@/components/KeywordProfile';
import {VideoThumbnail} from '@/components/VideoThumbnail';
import {ObservationChart,observedPoints,SINGLE_OBSERVATION_NOTE} from '@/components/ObservationChart';
import {ChannelSourceLabel,hasSource} from '@/components/ChannelSource';
import SaveButton from '@/components/reader/SaveButton';
import {familyTabs} from '@/lib/report-navigation';
import {liveCoverageNotes} from '@/components/LiveCoverageNotice';
import { VideoCommentSummary } from '@/components/VideoCommentSummary';
import { COMMENTS_PUBLISHED } from '@/lib/comments-launch';
import { TagFilters } from '@/components/TagFilters';
import { VideoAnalytics } from '@/components/VideoAnalytics';
import { PromptPreview } from '@/components/PromptPreview';
import { LiveWall } from '@/components/LiveWall';
import { AiDailyBoard, aiDailyTitle, AI_DAILY_NETWORK_NOTES } from '@/components/AiDailyBoard';
import { AiHoursBoard } from '@/components/ai/AiHoursBoard';
import { AiPeriodsBoard } from '@/components/ai/AiPeriodsBoard';
import { AiAspectsBoard } from '@/components/ai/AiAspectsBoard';
import { AiEventPeopleBoard } from '@/components/ai/AiEventPeopleBoard';
import { AiDayPromptBoard } from '@/components/ai/AiDayPromptBoard';
import { AiEventWallBoard } from '@/components/ai/AiEventWallBoard';
import { AiEventBoard } from '@/components/ai/AiEventBoard';
import Link from "next/link";
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
    type TagRow,
    type KeywordRow,
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
import { ReportMethod } from "@/components/ReportMethod";
import { ChannelContext } from "@/components/ChannelContext";
function Failure({ status, title }: { status: number; title: string }) {
    if (status === 404) notFound();
    return <Unavailable status={status} title={title} />;
}
export async function ReportPage(props: {
    route: ReportRoute;
    search: Search;
    path: string;
}) {
    // A channel's sub-reports carry generic titles (「頻道影片」), so name the channel above them.
    const channelId = props.path.match(/^\/channels\/(\d+)\/.+$/)?.[1];
    return channelId ? <><ChannelContext id={channelId} /><ReportBody {...props} /></> : <ReportBody {...props} />;
}
async function ReportBody({
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
    if (route.kind === "prompt-preview") return path.startsWith("/ai/days")?<AiDayPromptBoard apiPath={route.apiPath} search={search} path={path} />:<PromptPreview apiPath={route.apiPath} search={search} path={path} />;
    if (route.kind === "live-wall") return /^\/ai\/events\/\d+\/wall$/.test(path)?<AiEventWallBoard apiPath={route.apiPath} search={search} path={path} />:<LiveWall apiPath={route.apiPath} search={search} path={path} />;
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
                    meta={meta}
                />
                <DataNotice meta={meta} />
                <Tabs items={familyTabs(path,search,meta.coverage)} active={path} />
                <ReportFilters mode="channels" search={search} path={path} channelRanking={data.ranking} />
                <ChannelTable rows={data.rows} offset={data.offset} ranking={data.ranking} responsive/>
                <Pagination collection={data} search={search} path={path} />
                <ReportMethod path={path} description={route.description} meta={meta} notes={data.ranking.min!==null?[`目前門檻：${data.ranking.minMetric==='views'?'累計觀看':'訂閱人數'}至少 ${count(data.ranking.min)}。`]:[]}/>
            </>
        );
    }
    if (
        ["videos", "channel-videos", "tag-videos", "keyword-videos"].includes(
            route.kind,
        )
    ) {
        const categoryId=route.kind==='tag-videos'?route.id:undefined;
        const [result,metadata,categoryMetadata] = await Promise.all([
            api<VideoCollection>(route.apiPath, search),
            route.kind==='keyword-videos'&&route.id?readKeywordMetadata(route.id):Promise.resolve(undefined),
            categoryId?api<FilterOptions>('filter-options/tags',{ids:categoryId},{optional:true}):Promise.resolve(undefined),
        ]);
        const categoryName=categoryId&&categoryMetadata?.ok&&filterOptionsMatch(categoryMetadata.response.data,{kind:'tags',ids:[categoryId],limit:20})?categoryMetadata.response.data.rows.find(row=>row.id===categoryId)?.label:null;
        if (!result.ok)
            return <><Failure status={result.status} title={route.title} />{result.status===503&&first(search.q)?.trim()&&<><VideoSearchReadHint/><ReportFilters mode="videos" search={search} path={path}/></>}</>;
        const { data, meta } = result.response;
        if(route.kind==='keyword-videos'&&route.id)return <KeywordProfile metadata={metadata} keyword={route.id} description={route.description} data={data} meta={meta}
            period={{from:first(search.from)??null,to:first(search.to)??null,days:first(search.days)??null,since:first(search.since)??null,until:first(search.until)??null}}
            notice={<DataNotice meta={meta}/>}
            tabs={<Tabs items={familyTabs(path,search,meta.coverage)} active={path}/>}
            filters={<ReportFilters mode="videos" search={search} path={path}/>}
            pagination={<Pagination collection={data} search={search} path={path}/>}/>;
        return (
            <>
                <Heading
                    title={categoryId?`${categoryName||`分類 #${categoryId}`}的影片`:route.title}
                    meta={meta}
                />
                <DataNotice meta={meta} />
                <Tabs items={familyTabs(path,search,meta.coverage)} active={path} />
                <ReportFilters mode="videos" search={search} path={path} />
                <VideoTable rows={data.rows} responsive/>
                <Pagination collection={data} search={search} path={path} />
                <ReportMethod path={path} description={route.description} meta={meta}/>
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
                    meta={meta}
                />
                <DataNotice meta={meta} />
                <Tabs items={familyTabs(path,search,meta.coverage)} active={path} />
                <RefreshControl />
                <ReportFilters mode="live" search={search} path={path} />
                <div className="metrics">
                    <Metric
                        label="符合篩選的直播"
                        value={count(data.total)}
                        unit="場"
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
                        detail="同一觀眾可能重複計入"
                    />
                </div>
                <LiveTable rows={data.rows} offset={data.offset} />
                <Pagination collection={data} search={search} path={path} />
                <ReportMethod path={path} description={route.description} meta={meta} notes={liveCoverageNotes(meta.coverage)}/>
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
                    title={aiDailyTitle(data.date,data.condition)}
                    lead={`${count(data.rows.length)} 個議題 · ${count(data.channels)} 個頻道`}
                    meta={meta}
                />
                <DataNotice meta={meta} />
                <Tabs items={familyTabs(path,search,meta.coverage)} active={path} />
                <AiDailyBoard data={data} dated={Boolean(route.id)} />
                <ReportMethod path={path} description={route.description} meta={meta} notes={AI_DAILY_NETWORK_NOTES}/>
            </>
        );
    }
    if (route.kind === "ai-event") {
        return <AiEventBoard apiPath={route.apiPath} title={route.title} description={route.description} path={path} search={search} />;
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
        const views = data.history.map((item) => ({ time: item.date, value: item.views }));
        const live = data.liveHistory.map((item) => ({ time: item.time, value: item.viewers }));
        // The heading's 更新於 is the page's latest record; the video's own record time is named
        // only when it differs (e.g. a newer comment batch), never as a second identical line.
        const recorded = dateTime(v.updatedAt), updated = meta.updatedAt ? dateTime(meta.updatedAt) : null;
        const source = { channelId: v.channelId, channelTitle: v.channelTitle, channelAvatar: v.channelAvatar ?? null };
        const action = "inline-flex min-h-11 items-center rounded-md border border-zinc-300 px-3 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800";
        return (
            <>
                <Heading
                    title={v.title || "影片標題尚未取得"}
                    meta={meta}
                    lead={<>{hasSource(source) ? <ChannelSourceLabel source={source} size={20} /> : "頻道名稱尚未取得"} · 發布於 {dateTime(v.publishedAt)}{v.updatedAt && recorded !== updated && <> · 資料最後記錄 {recorded}</>}</>}
                />
                <DataNotice meta={meta} />
                <Tabs items={[{href:`/videos/${encodeURIComponent(v.id)}`,label:'影片概覽'},{href:`/videos/${encodeURIComponent(v.id)}/analytics`,label:'觀測分析'}]} active={path}/>
                <div className="my-4 grid gap-4 sm:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
                    <a className="block aspect-video w-full" href={youtubeUrl(v.youtubeUrl)} target="_blank" rel="noopener noreferrer" aria-label="在 YouTube 開啟原始影片"><VideoThumbnail videoId={v.id} fill priority sizes="(max-width: 640px) 100vw, 320px"/></a>
                    <div className="flex min-w-0 flex-col gap-3">
                        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                            <Metric label="觀看數" value={compact(v.views)} unit="次" />
                            <Metric label="喜歡" value={count(v.likes)} unit="次" />
                            <Metric label="YouTube 留言總數" value={count(v.comments)} unit="則" />
                            <Metric label="長度" value={data.durationSeconds === null ? "—" : `${Math.floor(data.durationSeconds / 60)}:${String(data.durationSeconds % 60).padStart(2, "0")}`} detail={data.captionAvailable ? "來源提供字幕" : "字幕狀態未確認"} />
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <a className={action} href={youtubeUrl(v.youtubeUrl)} target="_blank" rel="noopener noreferrer">YouTube 原始影片 ↗</a>
                            <Link className={action} href={`/compare/titles?left=${encodeURIComponent(v.id)}`}>比較影片標題用語</Link>
                            <SaveButton kind="video" target={v.id}/>
                        </div>
                    </div>
                </div>
                {COMMENTS_PUBLISHED && <VideoCommentSummary summary={data.commentSummary} id={v.id} />}
                {observedPoints(live).length > 0 && (
                    <>
                        <SectionHeading title="直播同時在線觀測" />
                        <ObservationChart points={live} label="直播同時在線觀測" unit="人" />
                    </>
                )}
                <SectionHeading title="觀看數觀測" />
                {data.history.length ? (
                    <ObservationChart points={views} label="影片累計觀看數觀測" unit="次" />
                ) : (
                    <Empty title="尚無歷史觀測" description="本站尚未儲存這部影片的歷史觀測，無法據以建立歷史時間序列。" />
                )}
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
                <ReportMethod path={path} description={route.description} meta={meta} notes={observedPoints(views).length === 1 ? [SINGLE_OBSERVATION_NOTE] : []}/>
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
                    meta={meta}
                />
                <DataNotice meta={meta} />
                <TagFilters search={search} path={path} />
                <TagCards rows={data.rows} />
                <Pagination collection={data} search={search} path={path} />
                <ReportMethod path={path} description={route.description} meta={meta}/>
            </>
        );
    }

    // /ai pages restored to their Laravel content and layout (see components/ai).
    const AiBoard = path === "/ai/hours" ? AiHoursBoard : path === "/ai/periods" ? AiPeriodsBoard : path === "/ai/aspects" ? AiAspectsBoard : /^\/ai\/events\/\d+\/people$/.test(path) ? AiEventPeopleBoard : null;
    if (AiBoard) return <AiBoard apiPath={route.apiPath} path={path} search={search} title={route.title} family={route.family} filterPath={reportFilterPath(path,route)} />;
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
