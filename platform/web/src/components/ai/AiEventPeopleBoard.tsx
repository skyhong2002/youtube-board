import Link from "next/link";
import {notFound} from "next/navigation";
import {api,rejectMalformedPayload,type Search} from "@/lib/api";
import type {ReportData} from "@/lib/report-contract";
import {eventTabs} from "@/lib/report-navigation";
import {reportStyle as ui} from "@/lib/report-styles";
import {count} from "@/lib/format";
import {analysisSubjects,mediaSections,peopleSections,type MediaCard,type PersonCard,type Section} from "@/lib/ai-event-people-cards";
import {Heading,DataNotice,Unavailable,Tabs} from "@/components/ReportUI";
import {ReportMethod} from "@/components/ReportMethod";
import {ChannelAvatar} from "@/components/ChannelAvatar";

const PAGE=200,MAX_ROWS=2000;
const NOTES=[
    "版面沿用舊版人物觀點頁：先列人物分析的主體，再依 AI 分類分為支持者、反對者與其他觀點，每位人物一張卡片，列出角色、觀點、強度、描述與引用影片；接著以相同方式列出媒體分析。",
    "引用影片只在識別碼格式有效且有來源連結時連到 YouTube；其他引用保留原始識別碼並標示引用來源狀態。",
];
/** The people report is one row per (person, cited video), paged at most 200 rows; the cards need every row. */
async function readAll(apiPath:string,search:Search){
    const {offset:_offset,limit:_limit,...rest}=search;
    const first=await api<ReportData>(apiPath,{...rest,limit:String(PAGE),offset:"0"});
    if(!first.ok||!Array.isArray(first.response.data.rows))return {first,rows:[],complete:false};
    const rows=[...first.response.data.rows],total=first.response.data.total;
    for(let offset=PAGE;offset<Math.min(total,MAX_ROWS);offset+=PAGE){
        const next=await api<ReportData>(apiPath,{...rest,limit:String(PAGE),offset:String(offset)},{optional:true});
        if(!next.ok||!Array.isArray(next.response.data.rows))break;
        rows.push(...next.response.data.rows);
    }
    return {first,rows,complete:rows.length>=total};
}
const Chips=({items}:{items:string[]})=>items.some(Boolean)?<div className="mt-2 flex flex-wrap gap-1.5">{items.filter(Boolean).map((item,i)=><span className={ui.tag} key={i}>{item}</span>)}</div>:null;
const Description=({text}:{text:string})=>text?<p className="mt-2 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">{text}</p>:null;
function Person({row}:{row:PersonCard}){
    return <article className={ui.panel}>
        <h4 className="text-base font-semibold leading-snug">{row.person}</h4>
        <Chips items={[row.role,row.stance,row.strength&&`強度 ${row.strength}`]}/>
        <Description text={row.description}/>
        {row.videos.length>0&&<ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5 text-xs" aria-label="引用影片">{row.videos.map(v=><li className="flex min-w-0 items-center gap-1.5" key={v.rawId+v.media}>
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
function Group<T>({title,subject,sections,card}:{title:string;subject:string|null;sections:Section<T>[];card:(row:T,i:number)=>React.ReactNode}){
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
 * cited videos, then media cards by stance), read from the existing people report. */
export async function AiEventPeopleBoard({apiPath,path,search,title}:{apiPath:string;path:string;search:Search;title:string;family:string;filterPath?:string}){
    const {first,rows,complete}=await readAll(apiPath,search);
    if(!first.ok){if(first.status===404)notFound();return <Unavailable status={first.status} title={title}/>;}
    const {data,meta}=first.response;
    if(!Array.isArray(data.rows)){rejectMalformedPayload();return <Unavailable status={502} title={title}/>;}
    const notes=data.notes??[],subjects=analysisSubjects(notes),people=peopleSections(rows),media=mediaSections(data.sections?.find(s=>s.key==="media")?.rows??[]);
    const dailyId=meta.coverage?.sourceDailyId,tabs=eventTabs(path,search);
    return <>
        <Heading title={data.title||title} meta={meta} lead={typeof dailyId==="number"?`每日來源 #${dailyId}`:undefined}/>
        <DataNotice meta={meta}/>
        <Tabs items={tabs} active={path}/>
        <div className="space-y-8">
            {!complete&&<p className={ui.note} role="status">人物引用共 {count(data.total)} 筆，目前只讀到 {count(rows.length)} 筆；以下卡片可能缺少部分人物或影片。</p>}
            {subjects.people!==null||people.length
                ?<Group title="人物" subject={subjects.people} sections={people} card={(row,i)=><Person row={row} key={i}/>}/>
                :<div className={emptyBox}>目前沒有這個事件的人物觀點分析。</div>}
            {(subjects.media!==null||media.length>0)&&<Group title="媒體" subject={subjects.media} sections={media} card={(row,i)=><Media row={row} key={i}/>}/>}
        </div>
        <ReportMethod path={path} description={data.description} meta={meta} notes={[...NOTES,...notes]}/>
    </>;
}
