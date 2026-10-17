import Link from "next/link";
import {reportLinkPrefetch} from "@/lib/report-contract";
import {count} from "@/lib/format";
import type {AiDaysData,TopicRow} from "@/lib/api";

/** The Laravel /ai/days layout: date and condition switchers, coverage cards, numbered topics
 * with per-channel events, a summary box and up to three embedded representative videos. */
export const AI_DAILY_CONDITIONS = [["all","全部"],["green","泛綠"],["blue","泛藍"],["neutral","較無偏"],["finance","財經"],["world","世界"]] as const;
export function aiDailyTitle(date:string|null,condition:string){
    if(!date)return "主要事件與各媒體報導";
    return ({green:`泛綠媒體在 ${date} 主要報導`,blue:`泛藍媒體在 ${date} 主要報導`,neutral:`較無偏媒體在 ${date} 主要報導`,world:`${date} 國際新聞報導`,finance:`${date} 財經新聞報導`} as Record<string,string>)[condition]??`${date} 主要事件與各媒體報導`;
}
function shiftDate(date:string,days:number){const d=new Date(date+"T00:00:00Z");d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
function taipeiToday(){return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei"}).format(new Date());}
const dayHref=(date:string,condition:string)=>`/ai/days/${date}${condition==="all"?"":"/"+encodeURIComponent(condition)}`;
const chip="inline-flex min-h-7 items-center rounded-md border px-2 py-0.5 text-xs";
const idle=chip+" border-zinc-300 bg-white text-zinc-700 hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300";
const current=chip+" border-brand-300 bg-brand-50 font-bold text-brand-700 dark:border-brand-800 dark:bg-brand-950 dark:text-brand-300";
const counts=(rows:{term:string;count:number}[])=>rows.length?rows.map(r=>`${r.term}(${count(r.count)})`).join(", "):<span className="text-zinc-500">無</span>;

function Coverage({label,value,detail}:{label:string;value:string;detail:string}){
    return <div className="min-w-0 border border-zinc-300 bg-white px-2.5 py-2 dark:border-zinc-800 dark:bg-zinc-900"><div className="text-xs text-zinc-600 dark:text-zinc-400">{label}</div><div className="mt-0.5 text-lg font-bold leading-tight tabular-nums">{value}</div><div className="mt-0.5 text-xs leading-snug text-zinc-600 dark:text-zinc-400">{detail}</div></div>;
}
function Topic({topic,index}:{topic:TopicRow;index:number}){
    const s=topic.summary,href=`/ai/days/${topic.dailyId}/events?event=${encodeURIComponent(topic.title)}`;
    return <article className="mb-6 pb-1.5" id={`topic-${topic.id}`}>
        <h2 className="mb-3 text-xl font-semibold leading-snug sm:text-[23px]">{index+1}. {topic.grouping?topic.title:<Link className="text-brand-700 hover:underline dark:text-brand-400" href={href} prefetch={reportLinkPrefetch(href)}>{topic.title}</Link>}</h2>
        <ul className="mb-2.5 list-disc pl-5 leading-relaxed sm:ml-6">
            {topic.evidence.map((e,i)=>{const videos=e.videoIds.length||e.withheldVideoReferenceCount||0;return <li className="my-px" key={`${e.source.id}-${i}`}><Link className="font-bold text-brand-700 hover:underline dark:text-brand-400" href={`/channels/${e.channelId}`}>{e.channelTitle}</Link> =&gt; {e.event}{videos>1&&<span className="whitespace-nowrap text-zinc-500"> ({count(videos)} 則)</span>}</li>;})}
            {topic.unresolvedReferences.map((r,i)=><li className="my-px" key={`u-${i}`}><strong>{r.channelTitle}</strong> =&gt; {r.event}</li>)}
        </ul>
        {s&&<div className="mt-2.5 border border-zinc-400 bg-white px-3 pb-3 pt-2 sm:ml-6 dark:border-zinc-700 dark:bg-zinc-900">
            <ul className="mb-2.5 ml-4 list-disc leading-relaxed">
                <li>媒體數：{count(topic.channelCount)} 個 / 影片數：{count(topic.videoCount)} 則</li>
                <li>關鍵字：{counts(s.keywords)}</li>
                <li>人物：{counts(s.people)}</li>
                <li>泛綠媒體：{count(s.party.green)} 則 / 泛藍媒體：{count(s.party.blue)} 則</li>
                <li>台灣角度：{count(s.angle.taiwan)} 則 / 中國角度：{count(s.angle.china)} 則</li>
                <li>民進黨觀點：{count(s.camp.dpp)} 則 / 國民黨觀點：{count(s.camp.kmt)} 則</li>
            </ul>
            {s.videos.length>0&&<div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3" aria-label="代表影片">
                {s.videos.map(v=><div className="min-w-0" key={v.videoId}>
                    <iframe className="aspect-video w-full border-0 bg-slate-900" src={`https://www.youtube-nocookie.com/embed/${v.videoId}`} title={`${v.channelTitle} - ${v.event}`} loading="lazy" allow="encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin"/>
                    <a className="mt-1 block truncate text-xs text-zinc-700 hover:underline dark:text-zinc-300" href={`https://www.youtube.com/watch?v=${v.videoId}`} target="_blank" rel="noopener noreferrer">{v.channelTitle} · {v.event}</a>
                </div>)}
            </div>}
        </div>}
    </article>;
}
export function AiDailyBoard({data,dated}:{data:AiDaysData;dated:boolean}){
    const condition=data.condition||"all",anchor=data.date??taipeiToday(),prev=shiftDate(anchor,-1),next=shiftDate(anchor,1),stats=data.sourceStats;
    const summaryRefs=data.rows.reduce((n,t)=>n+t.videoCount,0);
    return <div className="max-w-[980px]">
        <nav className="mb-3 flex flex-wrap gap-2" aria-label="日期">
            <Link className={idle} href={dayHref(prev,condition)}>{prev}</Link>
            {data.date&&<Link className={current} aria-current="page" href={dayHref(data.date,condition)}>{data.date}</Link>}
            <Link className={idle} href={dayHref(next,condition)}>{next}</Link>
        </nav>
        <nav className="mb-3 flex flex-wrap gap-2" aria-label="條件">
            {AI_DAILY_CONDITIONS.map(([key,label])=>{const href=dated&&data.date?dayHref(data.date,key):key==="all"?"/ai/days":`/ai/days?condition=${key}`;return <Link key={key} className={condition===key?current:idle} aria-current={condition===key?"page":undefined} href={href}>{label}</Link>;})}
        </nav>
        <div className="mb-5 flex flex-wrap gap-2" aria-label="目前條件">
            {[`condition=${condition}`,...(data.date?[`date=${data.date}`]:[]),...(data.dailyId?[`pk=${data.dailyId}`,`type=${data.dataType??""}`]:[])].map(label=><span key={label} className={chip+" border-zinc-300 bg-white text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"}>{label}</span>)}
        </div>
        <section className="mb-5 grid grid-cols-1 gap-2.5 sm:grid-cols-3" aria-label="AI 涵蓋範圍">
            <Coverage label="Raw 收錄" value={data.rawVideoRows===null?"n/a":count(data.rawVideoRows)} detail="urt_video rows"/>
            <Coverage label="AI source" value={count(stats?.videoRefs??0)} detail={`${count(stats?.channelsWithEvents??0)} / ${count(stats?.channels??data.sourceChannels)} channels · ${count(stats?.eventRows??0)} events`}/>
            <Coverage label="Daily summary" value={count(summaryRefs)} detail={`${count(data.rows.length)} topics`}/>
        </section>
        {data.rows.length?data.rows.map((topic,index)=><Topic key={topic.id} topic={topic} index={index}/>)
            :<div className="border border-zinc-300 bg-white p-7 text-center text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">目前沒有符合條件的 AI daily summary。</div>}
    </div>;
}
