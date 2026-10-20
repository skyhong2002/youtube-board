import Link from "next/link";
import {notFound} from "next/navigation";
import {api,type AiEventData,type EventCitation,type Search} from "@/lib/api";
import type {ReportData} from "@/lib/report-contract";
import {reportLinkPrefetch} from "@/lib/report-contract";
import {reportStyle as ui} from "@/lib/report-styles";
import {eventTabs} from "@/lib/report-navigation";
import {count} from "@/lib/format";
import {aiEventTitle,citationVideo,historyDays,peopleGroups,type HistoryDay} from "@/lib/ai-event-board";
import {Heading,DataNotice,Tabs,Unavailable,SectionHeading} from "@/components/ReportUI";
import {ReportMethod} from "@/components/ReportMethod";
import {eventAnalysisNotes} from "@/components/EventAnalysis";
import {ChannelSourceLabel,unresolvedSource} from "@/components/ChannelSource";

/** The Laravel /ai/events/{id} content and order (逐日事件線, then each summary event with its
 * facts and opinions, then 人物觀點 by supporting/opposing/other), drawn with the site's cards and tags. */
const hot="inline-flex rounded-full bg-brand-50 px-2.5 py-0.5 text-xs text-brand-800 hover:bg-brand-100 dark:bg-brand-950/60 dark:text-brand-300 dark:hover:bg-brand-950";
const empty="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400";
const h3="text-sm font-semibold text-zinc-900 dark:text-zinc-100";

function Byline({citation,children}:{citation:EventCitation;children?:React.ReactNode}){
    const v=citationVideo(citation),source=citation.sourceChannel??(citation.media?unresolvedSource(citation.media):null);
    return <span className="inline-flex flex-wrap items-center gap-x-1.5 text-xs text-zinc-600 dark:text-zinc-400">
        {source&&<ChannelSourceLabel source={source}/>}
        {children}
        {v.label&&<><span aria-hidden="true">·</span>{v.href
            ?<a className={ui.link+" tabular-nums"} href={v.href} target="_blank" rel="noopener noreferrer">{v.label}<span className="sr-only">（另開視窗）</span> ↗</a>
            :<span className="tabular-nums">{v.label}{v.state&&`（${v.state}）`}</span>}</>}
    </span>;
}
function History({days,href}:{days:HistoryDay[];href?:string}){
    if(days.length<2)return <p className={empty}>尚無前一日的跨日對應。{href&&<> <Link className={ui.link} href={href} prefetch={reportLinkPrefetch(href)}>查看跨日來源脈絡</Link></>}</p>;
    return <ol className="space-y-2">{days.map(d=><li className="rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm dark:border-zinc-800 dark:bg-zinc-900" key={d.date}>
        <div className="flex flex-wrap items-baseline gap-x-3"><strong className="tabular-nums">{d.date}</strong>
            {d.dailyId!==null&&(d.href?<Link className={ui.link+" text-xs tabular-nums"} href={d.href} prefetch={reportLinkPrefetch(d.href)}>每日彙整 #{d.dailyId}</Link>:<span className="text-xs tabular-nums text-zinc-500">每日彙整 #{d.dailyId}</span>)}</div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">{d.events.map(e=>e.href
            ?<Link className={ui.tag+" hover:bg-zinc-200 dark:hover:bg-zinc-700"} key={e.title} href={e.href} prefetch={reportLinkPrefetch(e.href)}>{e.title}</Link>
            :<span className={ui.tag} key={e.title}>{e.title}</span>)}</div>
    </li>)}</ol>;
}
function Summary({s}:{s:AiEventData["presentation"]["summaries"][number]}){
    return <article className={ui.panel+" space-y-3"}>
        <h3 className="text-lg font-semibold leading-snug">{s.title}</h3>
        {s.description&&<p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{s.description}</p>}
        {/* Keywords (links) and the reporting media (labels) are two lists, each named, not one row of look-alike chips. */}
        {s.keywords.length>0&&<div className="flex flex-wrap items-center gap-1.5"><span className="mr-1 text-xs text-zinc-500 dark:text-zinc-400">關鍵字</span>
            {s.keywords.map(k=><Link className={hot} key={`k-${k}`} href={`/keywords/${encodeURIComponent(k)}/videos`}>{k}</Link>)}
        </div>}
        {s.media.length>0&&<div className="flex flex-wrap items-center gap-1.5"><span className="mr-1 text-xs text-zinc-500 dark:text-zinc-400">報導媒體</span>
            {s.media.map(m=><span className={ui.tag} key={`m-${m}`}>{m}</span>)}
        </div>}
        {s.facts.length>0&&<section className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-950/60"><h4 className={h3}>事實</h4>
            <ul className="mt-2 space-y-2.5 text-sm leading-relaxed">{s.facts.map((f,i)=><li key={i}><p>{f.headline}</p><Byline citation={f.citation}/></li>)}</ul>
        </section>}
        {s.opinions.length>0&&<section className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-950/60"><h4 className={h3}>觀點</h4>
            <ul className="mt-2 space-y-2.5 text-sm leading-relaxed">{s.opinions.map((o,i)=><li key={i}><p>{o.content}</p>
                <Byline citation={o.citation}>{(o.stance||o.intensity)&&<><span aria-hidden="true">·</span><span>角度：{o.stance||"—"}</span><span aria-hidden="true">·</span><span>強度：{o.intensity||"—"}</span></>}</Byline>
            </li>)}</ul>
        </section>}
    </article>;
}
function People({people}:{people:NonNullable<AiEventData["presentation"]["people"]>}){
    const groups=peopleGroups(people);
    return <section className="space-y-3" aria-label="人物觀點">
        <div className="mb-3 mt-6 flex flex-wrap items-baseline gap-x-3"><h2 className="text-base font-semibold">人物觀點</h2>{people.mainSubject&&<span className="text-sm text-zinc-600 dark:text-zinc-400">主體角色：{people.mainSubject}</span>}</div>
        {groups.length?groups.map(g=><section key={g.kind}><h3 className={h3+" mb-2"}>{g.label}<span className="ml-1.5 text-xs font-normal tabular-nums text-zinc-500">{count(g.rows.length)} 人</span></h3>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{g.rows.map((r,i)=>{const first=r.citations[0];return <article className={ui.panel+" space-y-1.5 text-sm"} key={`${r.person}-${i}`}>
                <h4 className="font-semibold">{r.person}</h4>
                {[r.role,r.stance,r.strength].some(Boolean)&&<p className="text-xs text-zinc-600 dark:text-zinc-400">{[r.role,r.stance,r.strength].filter(Boolean).join(" · ")}</p>}
                {r.description&&<p className="leading-relaxed">{r.description}</p>}
                {first&&<Byline citation={first}>{r.citations.length>1&&<span className="tabular-nums">另 {count(r.citations.length-1)} 則</span>}</Byline>}
            </article>;})}</div>
        </section>):<p className={empty}>人物觀點分析沒有列出人物。</p>}
    </section>;
}
export async function AiEventBoard({apiPath,title,description,path,search}:{apiPath:string;title:string;description?:string|null;path:string;search:Search}){
    const result=await api<AiEventData>(apiPath,search);
    if(!result.ok){if(result.status===404)notFound();return <Unavailable status={result.status} title={title}/>;}
    const {data,meta}=result.response,p=data.presentation,tabs=eventTabs(path,search);
    // The history reader takes the resolved daily record and canonical title, whichever route form was used.
    const history=data.title?await api<ReportData>(`ai/days/${data.dailyId}/events/history`,{event:data.title,limit:"200"},{optional:true}):null;
    const days=history?.ok?historyDays(history.response.data.rows):[],hasAi=p.summaries.length>0||!!p.people||!!p.media;
    const dayHref=data.date?`/ai/days/${data.date}`:"/ai/days";
    const historyFailed=!!history&&!history.ok&&history.status!==404;
    return <>
        <Heading title={aiEventTitle(data.title||title,data.date)} meta={meta}
            lead={<Link className="hover:underline" href={dayHref}>{data.date?`${data.date} `:""}每日彙整 #{data.dailyId}</Link>}/>
        <DataNotice meta={meta}/>
        <Tabs items={tabs} active={tabs[0]?.href||path}/>
        {/* Nothing to draw: one empty state with the ways out, instead of a status note and two empty sections. */}
        {!hasAi&&days.length<2&&!historyFailed?<div className={empty+" space-y-3"} role="status">
            <p>這個議題還沒有 AI 事件分析，也沒有前一日的跨日對應。</p>
            <p className="flex flex-wrap justify-center gap-x-4 gap-y-2">
                <Link className={ui.link} href={dayHref} prefetch={reportLinkPrefetch(dayHref)}>← 回到{data.date?` ${data.date} `:""}每日議題</Link>
                {tabs.slice(1).filter(t=>!t.href.includes("/people")).map(t=><Link className={ui.link} key={t.href} href={t.href} prefetch={reportLinkPrefetch(t.href)}>{t.label}</Link>)}
            </p>
        </div>:<div className="space-y-4">
            <section aria-label="逐日事件線"><SectionHeading title="逐日事件線"/>{historyFailed?<p className={empty}>逐日事件線暫時無法讀取。</p>:<History days={days} href={tabs[1]?.href}/>}</section>
            <section className="space-y-4" aria-label="事件分析"><SectionHeading title="事件分析"/>
                {p.summaries.length?p.summaries.map((s,i)=><Summary s={s} key={`${s.analysisId}-${i}`}/>):<p className={empty}>{hasAi?"目前沒有事件摘要分析。":"這個議題還沒有 AI 事件分析。"}</p>}
            </section>
            {p.people&&<People people={p.people}/>}
        </div>}
        <ReportMethod path={path} description={description} meta={meta} notes={[
            ...eventAnalysisNotes(data),
            "事件摘要、事實與觀點的分類、人物立場與強度都是 AI 對來源影片的歸納，不是編輯查證的結論；事實與觀點後面列出 AI 引用的影片，僅連結本站已核對的影片。",
            "人物觀點卡片列出第一則引用影片，其餘以則數表示；完整引用與媒體觀點見「人物觀點」分頁，所有引用影片見「來源影片牆」。",
            ...(history?.ok?history.response.data.notes??[]:[]),
        ]}/>
    </>;
}
