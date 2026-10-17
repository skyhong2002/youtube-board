import Link from "next/link";
import SectionTabs from "@/components/SectionTabs";
import {ChannelAvatar} from "@/components/ChannelAvatar";
import {Metric} from "@/components/ReportUI";
import {reportLinkPrefetch} from "@/lib/report-contract";
import {reportStyle as ui} from "@/lib/report-styles";
import {count} from "@/lib/format";
import type {AiDaysData,TopicRow} from "@/lib/api";

/** The Laravel /ai/days content and order (date and condition switchers, coverage, numbered
 * topics with per-channel events, a summary box and up to three embedded videos), drawn with
 * the site's own cards, tabs, tags and avatars. */
export const AI_DAILY_CONDITIONS = [["all","全部"],["green","泛綠"],["blue","泛藍"],["neutral","較無偏"],["finance","財經"],["world","世界"]] as const;
export function aiDailyTitle(date:string|null,condition:string){
    if(!date)return "主要事件與各媒體報導";
    return ({green:`泛綠媒體在 ${date} 主要報導`,blue:`泛藍媒體在 ${date} 主要報導`,neutral:`較無偏媒體在 ${date} 主要報導`,world:`${date} 國際新聞報導`,finance:`${date} 財經新聞報導`} as Record<string,string>)[condition]??`${date} 主要事件與各媒體報導`;
}
function shiftDate(date:string,days:number){const d=new Date(date+"T00:00:00Z");d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
function taipeiToday(){return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei"}).format(new Date());}
const dayHref=(date:string,condition:string)=>`/ai/days/${date}${condition==="all"?"":"/"+encodeURIComponent(condition)}`;
const conditionLabel=(key:string)=>AI_DAILY_CONDITIONS.find(([k])=>k===key)?.[1]??key;

function Counts({rows,link}:{rows:{term:string;count:number}[];link?:boolean}){
    if(!rows.length)return <span className="text-zinc-500">無</span>;
    return <span className="flex flex-wrap gap-1.5">{rows.map(r=>{const body=<>{r.term}<span className="ml-1 tabular-nums text-zinc-500">{count(r.count)}</span></>;
        return link?<Link key={r.term} className={ui.tag+" hover:bg-zinc-200 dark:hover:bg-zinc-700"} href={`/keywords/${encodeURIComponent(r.term)}/videos`}>{body}</Link>:<span key={r.term} className={ui.tag}>{body}</span>;})}</span>;
}
function Pair({a,b}:{a:[string,number];b:[string,number]}){
    return <span className="tabular-nums">{a[0]} {count(a[1])} 則<span className="mx-2 text-zinc-400">/</span>{b[0]} {count(b[1])} 則</span>;
}
const EMPTY_SUMMARY:NonNullable<TopicRow["summary"]>={keywords:[],people:[],party:{green:0,blue:0},angle:{taiwan:0,china:0},camp:{dpp:0,kmt:0},videos:[]};
function Topic({topic,index}:{topic:TopicRow;index:number}){
    const s=topic.summary??EMPTY_SUMMARY,href=`/ai/days/${topic.dailyId}/events?event=${encodeURIComponent(topic.title)}`;
    const rows:[string,React.ReactNode][]=[
        ["媒體數",<span className="tabular-nums" key="m">{count(topic.channelCount)} 個媒體 · {count(topic.videoCount)} 則影片</span>],
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
            {s.videos.length>0&&<div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label="代表影片">
                {s.videos.map(v=><figure className="min-w-0" key={v.videoId}>
                    <iframe className="aspect-video w-full rounded-md border-0 bg-zinc-900" src={`https://www.youtube-nocookie.com/embed/${v.videoId}`} title={`${v.channelTitle} - ${v.event}`} loading="lazy" allow="encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin"/>
                    <figcaption className="mt-1 truncate text-xs text-zinc-600 dark:text-zinc-400"><a className="hover:underline" href={`https://www.youtube.com/watch?v=${v.videoId}`} target="_blank" rel="noopener noreferrer">{v.channelTitle} · {v.event}</a></figcaption>
                </figure>)}
            </div>}
        </div>
    </article>;
}
export function AiDailyBoard({data,dated}:{data:AiDaysData;dated:boolean}){
    const condition=data.condition||"all",anchor=data.date??taipeiToday(),prev=shiftDate(anchor,-1),next=shiftDate(anchor,1),stats=data.sourceStats??{channels:data.sourceChannels,channelsWithEvents:0,eventRows:0,videoRefs:0};
    const summaryRefs=data.rows.reduce((n,t)=>n+t.videoCount,0);
    const conditionHref=(key:string)=>dated&&data.date?dayHref(data.date,key):key==="all"?"/ai/days":`/ai/days?condition=${key}`;
    return <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <SectionTabs label="日期" tabs={[
                {href:dayHref(prev,condition),label:`← ${prev}`},
                ...(data.date?[{href:dayHref(data.date,condition),label:data.date,current:true}]:[]),
                {href:dayHref(next,condition),label:`${next} →`},
            ]}/>
            <SectionTabs label="條件" tabs={AI_DAILY_CONDITIONS.map(([key,label])=>({href:conditionHref(key),label,current:condition===key}))}/>
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">條件：{conditionLabel(condition)}{data.date&&<> · 日期：{data.date}</>}{data.dailyId?<> · 每日彙整 #{data.dailyId}{data.dataType&&<> · 資料類型：{data.dataType}</>}</>:<> · 由頻道摘要重新分組</>}</p>
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label="AI 涵蓋範圍">
            <Metric label="原始收錄" value={data.rawVideoRows===null?"—":count(data.rawVideoRows)} unit="則" detail="來源頻道當日影片"/>
            <Metric label="AI 來源" value={count(stats.videoRefs)} unit="則" detail={`${count(stats.channelsWithEvents)} / ${count(stats.channels)} 個頻道 · ${count(stats.eventRows)} 個事件`}/>
            <Metric label="每日彙整" value={count(summaryRefs)} unit="則" detail={`${count(data.rows.length)} 個議題`}/>
        </section>
        {data.rows.length?<div className="space-y-4">{data.rows.map((topic,index)=><Topic key={topic.id} topic={topic} index={index}/>)}</div>
            :<div className="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">目前沒有符合條件的 AI 每日彙整。</div>}
    </div>;
}
