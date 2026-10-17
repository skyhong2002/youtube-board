import Link from "next/link";
import {notFound} from "next/navigation";
import {api,rejectMalformedPayload,type AiEventPeopleFields,type Search} from "@/lib/api";
import type {ReportData} from "@/lib/report-contract";
import {eventTabs} from "@/lib/report-navigation";
import {reportStyle as ui} from "@/lib/report-styles";
import {count} from "@/lib/format";
import {aiEventTitle} from "@/lib/ai-event-board";
import {mediaSections,peopleSections,type MediaCard,type PersonCard,type Section} from "@/lib/ai-event-people-cards";
import {Heading,DataNotice,Unavailable,Tabs} from "@/components/ReportUI";
import {ReportMethod} from "@/components/ReportMethod";
import {ChannelAvatar} from "@/components/ChannelAvatar";

const NOTES=[
    "版面沿用舊版人物觀點頁：先列人物分析的主體，再依 AI 分類分為支持者、反對者與其他觀點，每位人物一張卡片，列出角色、觀點、強度、描述與引用影片；接著以相同方式列出媒體分析。",
    "引用影片只在識別碼格式有效且屬於生成時來源時連到 YouTube；其他引用保留原始識別碼並標示引用來源狀態。",
];
const Chips=({items}:{items:string[]})=>items.some(Boolean)?<div className="mt-2 flex flex-wrap gap-1.5">{items.filter(Boolean).map((item,i)=><span className={ui.tag} key={i}>{item}</span>)}</div>:null;
const Description=({text}:{text:string})=>text?<p className="mt-2 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">{text}</p>:null;
function Person({row}:{row:PersonCard}){
    return <article className={ui.panel}>
        <h4 className="text-base font-semibold leading-snug">{row.person}</h4>
        <Chips items={[row.role,row.stance,row.strength&&`強度 ${row.strength}`]}/>
        <Description text={row.description}/>
        {row.videos.length>0&&<ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5 text-xs" aria-label="引用影片">{row.videos.map((v,i)=><li className="flex min-w-0 items-center gap-1.5" key={i}>
            <ChannelAvatar avatar={v.source?.channelAvatar} title={v.media} size={16}/>
            {v.videoId?<a className={ui.link} href={`https://www.youtube.com/watch?v=${v.videoId}`} target="_blank" rel="noopener noreferrer">{v.media||"YouTube"} · {v.videoId}</a>
                :<span className="text-zinc-500 dark:text-zinc-400">{v.media||"YouTube"} · {v.rawId}{v.status&&`（${v.status}）`}</span>}
        </li>)}</ul>}
    </article>;
}
function Media({row}:{row:MediaCard}){
    const id=row.source?.channelId;
    return <article className={ui.panel}>
        <h4 className="flex items-center gap-2 text-base font-semibold leading-snug">
            <ChannelAvatar className="shrink-0" avatar={row.source?.channelAvatar} title={row.media} size={20}/>
            {id?<Link className="hover:text-brand-700 hover:underline dark:hover:text-brand-400" href={`/channels/${id}`}>{row.media}</Link>:<span>{row.media}</span>}
        </h4>
        <Chips items={[row.stance,row.strength&&`強度 ${row.strength}`]}/>
        <Description text={row.description}/>
    </article>;
}
function Group<T>({title,subject,sections,card}:{title:string;subject:string;sections:Section<T>[];card:(row:T,i:number)=>React.ReactNode}){
    return <section className="space-y-4" aria-label={title}>
        <h2 className="text-lg font-semibold">{title}{subject&&<span className="ml-2 text-sm font-normal text-zinc-500 dark:text-zinc-400">主體：{subject}</span>}</h2>
        {sections.map(s=><div className="space-y-3" key={s.kind}>
            <h3 className="text-base font-semibold">{s.label}<span className="ml-2 text-xs font-normal tabular-nums text-zinc-500">{count(s.rows.length)}</span></h3>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{s.rows.map(card)}</div>
        </div>)}
    </section>;
}
const emptyBox="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400";

/** The Laravel /ai/events/{id}/people layout (main subject, person cards by stance with their
 * cited videos, then media cards by stance), from the people report's structured blocks. The
 * paged person/video rows are not drawn, so one row is requested. */
export async function AiEventPeopleBoard({apiPath,path,search,title}:{apiPath:string;path:string;search:Search;title:string;family:string;filterPath?:string}){
    const {offset:_offset,limit:_limit,...rest}=search;
    const result=await api<ReportData&AiEventPeopleFields>(apiPath,{...rest,limit:"1"});
    if(!result.ok){if(result.status===404)notFound();return <Unavailable status={result.status} title={title}/>;}
    const {data,meta}=result.response;
    if(!Array.isArray(data.rows)||data.people===undefined||data.media===undefined){rejectMalformedPayload();return <Unavailable status={502} title={title}/>;}
    const people=peopleSections(data.people),media=mediaSections(data.media);
    return <>
        <Heading title={`${aiEventTitle(data.event||title,data.date)} 人物觀點`} meta={meta} lead={`每日來源 #${data.dailyId}`}/>
        <DataNotice meta={meta}/>
        <Tabs items={eventTabs(path,search)} active={path}/>
        <div className="space-y-8">
            {data.people
                ?<Group title="人物" subject={data.people.mainSubject} sections={people} card={(row,i)=><Person row={row} key={i}/>}/>
                :<div className={emptyBox}>目前沒有這個事件的人物觀點分析。</div>}
            {data.media&&<Group title="媒體" subject={data.media.mainSubject} sections={media} card={(row,i)=><Media row={row} key={i}/>}/>}
        </div>
        <ReportMethod path={path} description={data.description} meta={meta} notes={[...NOTES,...data.notes??[]]}/>
    </>;
}
