import Link from "next/link";
import SectionTabs from "@/components/SectionTabs";
import {ChannelAvatar} from "@/components/ChannelAvatar";
import {Metric} from "@/components/ReportUI";
import {YouTubeFacade} from "@/components/ai/YouTubeFacade";
import {reportLinkPrefetch} from "@/lib/report-contract";
import {reportStyle as ui} from "@/lib/report-styles";
import {count} from "@/lib/format";
import type {AiDaysData,TopicRow} from "@/lib/api";

/** The Laravel /ai/days content and order (date and condition switchers, coverage, numbered
 * topics with per-channel events, a summary box and up to three embedded videos), drawn with
 * the site's own cards, tabs, tags and avatars. */
/** Method-block notes for /ai/days; the order itself is computed by the API (rankByNetworks). */
export const AI_DAILY_NETWORK_NOTES = [
    "排序：同一媒體集團的多個頻道（例如三立的 LIVE 新聞、iNEWS、新聞網）只算一家。至少兩個媒體集團都報導的議題排在前面，再依「影片數 + 3 × 媒體集團數」排序。",
    "媒體集團：依頻道分類中的集團標籤（旺中、TVBS、三立、中央社⋯）判斷；沒有集團標籤的頻道自成一家。無法對應到頻道的報導不計入集團數。",
] as const;
export const AI_DAILY_CONDITIONS =[["all","全部"],["green","泛綠"],["blue","泛藍"],["neutral","較無偏"],["finance","財經"],["world","世界"]] as const;
export function aiDailyTitle(date:string|null,condition:string){
    if(!date)return "主要事件與各媒體報導";
    return ({green:`泛綠媒體在 ${date} 主要報導`,blue:`泛藍媒體在 ${date} 主要報導`,neutral:`較無偏媒體在 ${date} 主要報導`,world:`${date} 國際新聞報導`,finance:`${date} 財經新聞報導`} as Record<string,string>)[condition]??`${date} 主要事件與各媒體報導`;
}
function shiftDate(date:string,days:number){const d=new Date(date+"T00:00:00Z");d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
function taipeiToday(){return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei"}).format(new Date());}
const dayHref=(date:string,condition:string)=>`/ai/days/${date}${condition==="all"?"":"/"+encodeURIComponent(condition)}`;
const conditionLabel=(key:string)=>AI_DAILY_CONDITIONS.find(([k])=>k===key)?.[1]??key;

function Counts({rows,link}:{rows:{term:string;count:number}[];link?:boolean}){
    if(!rows.length)return <span className="text-zinc-400 dark:text-zinc-500">無</span>;
    return <span className="flex flex-wrap gap-1.5">{rows.map(r=>{const body=<>{r.term}<span className="ml-1 tabular-nums text-zinc-500">{count(r.count)}</span></>;
        return link?<Link key={r.term} className={ui.tag+" hover:bg-zinc-200 dark:hover:bg-zinc-700"} href={`/keywords/${encodeURIComponent(r.term)}/videos`}>{body}</Link>:<span key={r.term} className={ui.tag}>{body}</span>;})}</span>;
}
/** Zero sides are greyed so the topics where a camp, angle or party view does appear stand out. */
function Side({side:[label,n]}:{side:[string,number]}){return <span className={"whitespace-nowrap"+(n?"":" text-zinc-400 dark:text-zinc-500")}>{label} {count(n)} 則</span>;}
function Pair({a,b}:{a:[string,number];b:[string,number]}){
    return <span className="tabular-nums"><Side side={a}/><span className="mx-2 text-zinc-400">/</span><Side side={b}/></span>;
}
const EMPTY_SUMMARY:NonNullable<TopicRow["summary"]>={keywords:[],people:[],party:{green:0,blue:0},angle:{taiwan:0,china:0},camp:{dpp:0,kmt:0},videos:[]};
function Topic({topic,index}:{topic:TopicRow;index:number}){
    const s=topic.summary??EMPTY_SUMMARY,href=`/ai/days/${topic.dailyId}/events?event=${encodeURIComponent(topic.title)}`;
    const rows:[string,React.ReactNode][]=[
        ["媒體數",<span className="tabular-nums [&>span]:whitespace-nowrap" key="m" title={topic.networks?.join("、")}>{typeof topic.networkCount==="number"&&<><span>{count(topic.networkCount)} 個媒體集團</span> · </>}<span>{count(topic.channelCount)} 個頻道</span> · <span>{count(topic.videoCount)} 則影片</span></span>],
        ["關鍵字",<Counts rows={s.keywords} link key="k"/>],
        ["人物",<Counts rows={s.people} key="p"/>],
        ["媒體陣營",<Pair a={["泛綠媒體",s.party.green]} b={["泛藍媒體",s.party.blue]} key="g"/>],
        ["報導角度",<Pair a={["台灣角度",s.angle.taiwan]} b={["中國角度",s.angle.china]} key="a"/>],
        ["政黨觀點",<Pair a={["民進黨觀點",s.camp.dpp]} b={["國民黨觀點",s.camp.kmt]} key="c"/>],
    ];
    return <article className={ui.panel+" scroll-mt-20"} id={`topic-${topic.id}`}>
        <h2 className="flex gap-2 text-lg font-semibold leading-snug">
            <span className="shrink-0 tabular-nums text-zinc-400">{index+1}.</span>
            {topic.grouping?<span>{topic.title}</span>:<Link className="hover:text-brand-700 hover:underline dark:hover:text-brand-400" href={href} prefetch={reportLinkPrefetch(href)}>{topic.title}</Link>}
        </h2>
        <ul className="mt-3 space-y-1.5 text-sm leading-relaxed">
            {topic.evidence.map((e,i)=>{const videos=e.videoIds.length||e.withheldVideoReferenceCount||0;return <li className="flex gap-2" key={`${e.source.id}-${i}`}>
                <ChannelAvatar className="mt-0.5 shrink-0" avatar={e.channelAvatar} title={e.channelTitle} size={20}/>
                <span className="min-w-0"><Link className="font-medium text-zinc-900 hover:text-brand-700 hover:underline dark:text-zinc-100 dark:hover:text-brand-400" href={`/channels/${e.channelId}`}>{e.channelTitle}</Link><span className="mx-1.5 text-zinc-400">→</span><span className="text-zinc-700 dark:text-zinc-300">{e.event}</span>{videos>1&&<span className="ml-1.5 whitespace-nowrap text-xs tabular-nums text-zinc-500">{count(videos)} 則</span>}</span>
            </li>;})}
            {topic.unresolvedReferences.map((r,i)=><li className="flex gap-2 pl-7" key={`u-${i}`}><span className="min-w-0"><span className="font-medium">{r.channelTitle}</span><span className="mx-1.5 text-zinc-400">→</span><span className="text-zinc-700 dark:text-zinc-300">{r.event}</span></span></li>)}
        </ul>
        <div className="mt-4 rounded-lg bg-zinc-50 p-3 text-sm dark:bg-zinc-950/60">
            <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-2">
                {rows.map(([label,value])=><div className="contents" key={label}><dt className="pt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{label}</dt><dd className="min-w-0">{value}</dd></div>)}
            </dl>
            {/* Phones swipe the representative videos sideways instead of stacking three players per topic. */}
            {s.videos.length>0&&<div className="-mx-3 mt-3 flex snap-x gap-3 overflow-x-auto px-3 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 sm:pb-0" aria-label="代表影片">
                {s.videos.map(v=><figure className="relative w-[78%] min-w-0 shrink-0 snap-start sm:w-auto" key={v.videoId}>
                    <YouTubeFacade videoId={v.videoId} title={`${v.channelTitle} - ${v.event}`}/>
                    <figcaption className="mt-1 line-clamp-2 text-xs leading-snug text-zinc-600 dark:text-zinc-400"><a className="hover:underline" href={`https://www.youtube.com/watch?v=${v.videoId}`} target="_blank" rel="noopener noreferrer" title={`${v.channelTitle} · ${v.event}`}><span className="font-medium text-zinc-700 dark:text-zinc-300">{v.channelTitle}</span> · {v.event}<span className="sr-only">（另開視窗）</span></a></figcaption>
                </figure>)}
            </div>}
        </div>
    </article>;
}
export function AiDailyBoard({data,dated}:{data:AiDaysData;dated:boolean}){
    const condition=data.condition||"all",anchor=data.date??taipeiToday(),prev=shiftDate(anchor,-1),next=shiftDate(anchor,1),stats=data.sourceStats??{channels:data.sourceChannels,channelsWithEvents:0,eventRows:0,videoRefs:0};
    const summaryRefs=data.rows.reduce((n,t)=>n+t.videoCount,0);
    // The selected tabs already show the date and condition; the stored record stays beside its count.
    const record=data.dailyId?`紀錄 #${data.dailyId}${data.dataType?` · 資料類型 ${data.dataType}`:""}`:"由頻道摘要重新分組";
    const conditionHref=(key:string)=>dated&&data.date?dayHref(data.date,key):key==="all"?"/ai/days":`/ai/days?condition=${key}`;
    return <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <SectionTabs label="日期" tabs={[
                {href:dayHref(prev,condition),label:`← ${prev}`},
                ...(data.date?[{href:dayHref(data.date,condition),label:data.date,current:true}]:[]),
                ...(next<=taipeiToday()?[{href:dayHref(next,condition),label:`${next} →`}]:[]),
            ]}/>
            <SectionTabs label="條件" tabs={AI_DAILY_CONDITIONS.map(([key,label])=>({href:conditionHref(key),label,current:condition===key}))}/>
        </div>
        <section className="grid grid-cols-3 gap-2 sm:gap-3" aria-label="AI 涵蓋範圍">
            <Metric label="原始收錄" value={data.rawVideoRows===null?"—":count(data.rawVideoRows)} unit={data.rawVideoRows===null?undefined:"則"} detail="來源頻道當日影片"/>
            <Metric label="AI 來源" value={count(stats.videoRefs)} unit="則" detail={`${count(stats.channelsWithEvents)} / ${count(stats.channels)} 個頻道 · ${count(stats.eventRows)} 個事件`}/>
            <Metric label="每日彙整" value={count(summaryRefs)} unit="則" detail={`${count(data.rows.length)} 個議題 · ${record}`}/>
        </section>
        {data.rows.length?<div className="space-y-4">{data.rows.map((topic,index)=><Topic key={topic.id} topic={topic} index={index}/>)}</div>
            :<div className="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400" role="status">
                <p>{data.date??"這一天"}{condition==="all"?"":`「${conditionLabel(condition)}」條件`}目前沒有 AI 每日彙整。</p>
                <p className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-2"><Link className={ui.link} href={dayHref(prev,condition)}>← 看 {prev}</Link>{condition!=="all"&&<Link className={ui.link} href={conditionHref("all")}>改看全部媒體</Link>}</p>
            </div>}
    </div>;
}
