import Link from "next/link";
import {notFound} from "next/navigation";
import SectionTabs from "@/components/SectionTabs";
import TableScroller from "@/components/TableScroller";
import {ChannelAvatar} from "@/components/ChannelAvatar";
import {VideoThumbnail} from "@/components/VideoThumbnail";
import {AI_DAILY_CONDITIONS} from "@/components/AiDailyBoard";
import {ReportMethod} from "@/components/ReportMethod";
import {DataNotice,Heading,Pagination,Tabs,Unavailable} from "@/components/ReportUI";
import {rejectMalformedPayload,type Search} from "@/lib/api";
import {familyTabs} from "@/lib/report-navigation";
import {table as cell} from "@/lib/table-styles";
import {count} from "@/lib/format";
import {readAiReportPages} from "@/lib/ai-hours-pages";
import {aiHoursTitle,hourGroups,pageHref,shiftDate,taipeiToday,type HourGroup,type HourTopic} from "@/lib/ai-hours-board";

/** The Laravel /ai/hours content and order (date and condition switchers, the filter line,
 * then one numbered topic table per analysed hour), drawn with the site's tabs, tags and tables. */
const chip="inline-block rounded-md bg-zinc-100 px-2 py-0.5 text-xs leading-relaxed text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
const none=<span className="text-zinc-400">-</span>;
const conditionLabel=(key:string)=>AI_DAILY_CONDITIONS.find(([k])=>k===key)?.[1]??key;
function Chips({items,link}:{items:string[];link?:boolean}){
    if(!items.length)return none;
    return <span className="flex flex-wrap gap-1">{items.map(item=>link
        ?<Link key={item} className={chip+" hover:bg-zinc-200 dark:hover:bg-zinc-700"} href={`/keywords/${encodeURIComponent(item)}/videos`}>{item}</Link>
        :<span key={item} className={chip}>{item}</span>)}</span>;
}
function Row({topic,index}:{topic:HourTopic;index:number}){
    const v=topic.first;
    return <tr className={cell.row+" align-top"}>
        <td className={cell.num+" text-zinc-500"}>{index+1}</td>
        <td className={cell.cell+" min-w-64"}>
            <strong className="block font-semibold leading-snug text-zinc-900 dark:text-zinc-100">{topic.event}</strong>
            {topic.description&&<p className="mt-1 leading-relaxed text-zinc-600 dark:text-zinc-400">{topic.description}</p>}
        </td>
        <td className={cell.num}>{count(topic.videos)}</td>
        <td className={cell.cell+" whitespace-nowrap"}>{topic.category||none}</td>
        <td className={cell.cell+" min-w-40"}>{topic.angle||topic.camp?<span className="flex flex-col items-start gap-1">{topic.angle&&<span className={chip}>{topic.angle}</span>}{topic.camp&&<span className={chip}>{topic.camp}</span>}</span>:none}</td>
        <td className={cell.cell+" min-w-40"}><Chips items={topic.keywords} link/></td>
        <td className={cell.cell+" min-w-36"}><Chips items={topic.names}/></td>
        <td className={cell.cell}>{v?<a className="flex w-[154px] flex-col gap-1 text-xs text-zinc-600 hover:underline dark:text-zinc-400" href={`https://www.youtube.com/watch?v=${v.videoId}`} target="_blank" rel="noopener noreferrer">
            <VideoThumbnail videoId={v.videoId} title={topic.event} width={154} height={87}/>
            <span className="flex min-w-0 items-center gap-1.5">{v.channelTitle&&<ChannelAvatar avatar={v.channelAvatar} title={v.channelTitle} size={16}/>}<span className="truncate">{v.channelTitle||v.videoId}</span></span>
        </a>:none}</td>
    </tr>;
}
function Hour({group,duplicate}:{group:HourGroup;duplicate:boolean}){
    const heading=`${group.date} ${Number(group.hour)}時`;
    return <section className="space-y-2" aria-label={heading}>
        <h2 className="scroll-mt-20 text-lg font-semibold" id={`hour-${group.hour}${duplicate?"-"+group.dataType:""}`}>{heading}{duplicate&&group.dataType&&<span className="ml-2 text-sm font-normal text-zinc-500">{group.dataType}</span>}<span className="ml-2 text-sm font-normal tabular-nums text-zinc-500">{count(group.topics.length)} 個議題</span></h2>
        <TableScroller card label={`${heading}議題表格，可左右捲動`}>
            <table className="w-full min-w-[1040px] text-left text-sm">
                <thead className="bg-(--table-head-bg) text-xs text-zinc-600 dark:text-zinc-400"><tr>
                    {["編號","事件","影片數","分類","角度 / 陣營","關鍵字","人物 / 地名","影片"].map((label,i)=><th key={label} scope="col" className={(i===0||i===2?cell.num:cell.cell)+" whitespace-nowrap"}>{label}</th>)}
                </tr></thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">{group.topics.map((topic,index)=><Row key={index} topic={topic} index={index}/>)}</tbody>
            </table>
        </TableScroller>
    </section>;
}
export async function AiHoursBoard({apiPath,path,search,title}:{apiPath:string;path:string;search:Search;title:string;family:string;filterPath?:string}){
    const result=await readAiReportPages(apiPath,search);
    if(!result.ok){
        if(result.status===404)notFound();
        return <Unavailable status={result.status} title={title}/>;
    }
    const {data,meta}=result.response;
    if(!Array.isArray(data.rows)){rejectMalformedPayload();return <Unavailable status={502} title={title}/>;}
    const filter=(key:string)=>{const v=data.filters?.find(f=>f.key===key)?.value;return typeof v==="string"?v:"";};
    const date=filter("date")||null,condition=filter("condition")||"all",type=filter("type");
    const groups=hourGroups(data.rows,data.sections?.[0]?.rows??[]),topics=groups.reduce((n,g)=>n+g.topics.length,0);
    const hourCounts=groups.reduce((m,g)=>m.set(g.hour,(m.get(g.hour)??0)+1),new Map<string,number>());
    const anchor=date??taipeiToday(),prev=shiftDate(anchor,-1),next=shiftDate(anchor,1);
    const dateHref=(d:string)=>pageHref(path,search,{date:d});
    return <>
        <Heading title={aiHoursTitle(date,condition)} lead={`${count(topics)} 個議題 · ${count(groups.length)} 個時段`} meta={meta}/>
        <DataNotice meta={meta}/>
        <Tabs items={familyTabs(path,search,meta.coverage)} active={path}/>
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
                <SectionTabs label="日期" tabs={[
                    {href:dateHref(prev),label:`← ${prev}`},
                    ...(date?[{href:dateHref(date),label:date,current:true}]:[]),
                    ...(next<=taipeiToday()?[{href:dateHref(next),label:`${next} →`}]:[]),
                ]}/>
                <SectionTabs label="條件" tabs={AI_DAILY_CONDITIONS.map(([key,label])=>({href:pageHref(path,search,{condition:key==="all"?null:key}),label,current:condition===key}))}/>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">條件：{conditionLabel(condition)}{date&&<> · 日期：{date}</>}{type&&<> · 資料類型：{type}</>}</p>
            {groups.length?groups.map(group=><Hour key={group.sourceId} group={group} duplicate={(hourCounts.get(group.hour)??0)>1}/>)
                :<div className="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">目前沒有符合條件的每小時 AI 摘要。</div>}
        </div>
        <Pagination collection={data} search={search} path={path}/>
        <ReportMethod path={path} meta={meta} notes={[
            "每個分析時段一張表，依時段由新到舊排列；編號是該時段內的議題順序。",
            "關鍵字最多列 8 個；人物與地名合併後最多列 8 個。影片欄是該議題引用的第一支來源影片，影片數是議題引用的影片總數。",
            ...(data.notes??[]),
        ]}/>
    </>;
}
