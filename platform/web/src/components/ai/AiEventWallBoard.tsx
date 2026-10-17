import Link from "next/link";
import {notFound} from "next/navigation";
import {api,rejectMalformedPayload,type AiEventData,type Search} from "@/lib/api";
import {eventTabs} from "@/lib/report-navigation";
import {reportStyle as ui} from "@/lib/report-styles";
import {count} from "@/lib/format";
import {OTHER_VIDEO_LIMIT,WALL_KIND_LABELS,wallVideos,type WallVideo} from "@/lib/ai-event-wall-videos";
import {Heading,DataNotice,Unavailable,Tabs,SectionHeading} from "@/components/ReportUI";
import {ReportMethod} from "@/components/ReportMethod";
import {ChannelAvatar} from "@/components/ChannelAvatar";
import {VideoThumbnail} from "@/components/VideoThumbnail";
import {eventAnalysisNotes} from "@/components/EventAnalysis";

const TITLE="議題來源影片牆";
function Card({video}:{video:WallVideo}){
    const href=`https://www.youtube.com/watch?v=${video.videoId}`,id=video.source?.channelId;
    return <article className="overflow-hidden rounded-xl border border-zinc-300 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <a className="relative block aspect-video bg-zinc-100 dark:bg-zinc-800" href={href} target="_blank" rel="noopener noreferrer" tabIndex={-1} aria-hidden="true">
            <VideoThumbnail videoId={video.videoId} title={video.title??video.label} fill sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw" className="rounded-none"/>
        </a>
        <div className="space-y-2 p-3">
            <h2 className="text-sm font-semibold leading-snug"><a className="hover:text-brand-700 hover:underline dark:hover:text-brand-400" href={href} target="_blank" rel="noopener noreferrer" title={video.title??undefined}>{video.label}</a></h2>
            <div className="flex min-w-0 items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
                <ChannelAvatar className="shrink-0" avatar={video.source?.channelAvatar} title={video.media} size={16}/>
                {id?<Link className="truncate hover:underline" href={`/channels/${id}`}>{video.media}</Link>:<span className="truncate">{video.media||"YouTube"}</span>}
            </div>
            <span className={ui.tag}>{WALL_KIND_LABELS[video.kind]}</span>
        </div>
    </article>;
}
const Grid=({videos,label}:{videos:WallVideo[];label:string})=><section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label={label}>{videos.map(v=><Card key={v.videoId} video={v}/>)}</section>;

/** The Laravel /ai/events/{id}/wall layout: a thumbnail grid of the videos the event's AI
 * analyses cite, labelled with the cited headline, opinion or person and its source kind.
 * Read from the existing event report, which carries those labels; the wall report does not. */
export async function AiEventWallBoard({apiPath,search,path}:{apiPath:string;search:Search;path:string}){
    const result=await api<AiEventData>(apiPath.replace(/\/wall$/,""),search);
    if(!result.ok){if(result.status===404)notFound();return <Unavailable status={result.status} title={TITLE}/>;}
    const {data,meta}=result.response;
    if(!Array.isArray(data.videos)||!Array.isArray(data.presentation?.summaries)){rejectMalformedPayload();return <Unavailable status={502} title={TITLE}/>;}
    const wall=wallVideos(data),c=data.evidenceCoverage,skipped=Number(c.invalidCitations??0)+Number(c.outsideSnapshotCitations??0);
    const lead=[data.date,`每日來源 #${data.dailyId}`,`${count(wall.cited.length+wall.othersTotal)} 部影片`].filter(Boolean).join(" · ");
    return <>
        <Heading title={`${data.title}：來源影片牆`} meta={meta} lead={lead}/>
        <DataNotice meta={meta}/>
        <Tabs items={eventTabs(path,search)} active={path}/>
        <div className="space-y-6">
            {wall.cited.length?<Grid videos={wall.cited} label="AI 分析引用影片"/>
                :<div className="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">目前沒有 AI 事件分析引用的影片。</div>}
            {wall.others.length>0&&<div>
                <SectionHeading title={`其他來源影片（${count(wall.othersTotal)}）`}/>
                <Grid videos={wall.others} label="其他來源影片"/>
                {wall.othersTotal>wall.others.length&&<p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">另有 {count(wall.othersTotal-wall.others.length)} 部來源影片未列出，可在議題分析頁的來源影片表查看。</p>}
            </div>}
        </div>
        <ReportMethod path={path} meta={meta} notes={[
            "版面沿用舊版影片牆：先依序列出 AI 事件分析引用的影片，包括摘要分析的事實與觀點引用，以及人物分析中支持者、反對者與其他觀點人物的引用影片；同一部影片只列第一次出現的位置。",
            "卡片標題是 AI 分析寫下的事實標題、觀點內容或人物名稱，不是影片原標題；影片引用不代表已人工查證。",
            `其他來源影片是每日彙整分組與分析來源中未被 AI 分析引用的本地影片，依發布時間由新到舊，最多列 ${OTHER_VIDEO_LIMIT} 部。`,
            `來源每日資料 #${data.dailyId}；可呈現的分析 ${count(data.analyses.length)} 筆。`,
            ...(skipped>0?[`${count(skipped)} 筆引用的影片識別碼格式無效或不屬於生成時來源，未列入影片牆。`]:[]),
            ...eventAnalysisNotes(data),
        ]}/>
    </>;
}
