import Link from "next/link";
import {notFound} from "next/navigation";
import SectionTabs from "@/components/SectionTabs";
import TableScroller from "@/components/TableScroller";
import {AI_DAILY_CONDITIONS} from "@/components/AiDailyBoard";
import {ReportMethod} from "@/components/ReportMethod";
import {DataNotice,Heading,Metric,Pagination,Tabs,Unavailable} from "@/components/ReportUI";
import {rejectMalformedPayload,type Search} from "@/lib/api";
import {familyTabs} from "@/lib/report-navigation";
import {reportLinkPrefetch} from "@/lib/report-contract";
import {reportStyle as ui} from "@/lib/report-styles";
import {table as cell} from "@/lib/table-styles";
import {count} from "@/lib/format";
import {readAiReportPages} from "@/lib/ai-hours-pages";
import {pageHref} from "@/lib/ai-hours-board";
import {aiPeriodsTitle,periodStats,periodTopics,rangeDays,recentMonths,type PeriodTopic} from "@/lib/ai-periods-board";

/** The Laravel /ai/periods content and order (condition and month switchers, the filter line,
 * the event count, then the numbered 期間事件 table), drawn with the site's tabs, cards and tables. */
const conditionLabel=(key:string)=>AI_DAILY_CONDITIONS.find(([k])=>k===key)?.[1]??key;
const COLUMNS=["編號","事件","日期","媒體事件數","影片數","關鍵字數","最重要人","次數","最重要事","次數"];
const NUMERIC=new Set([0,3,4,5,7,9]);
function Row({topic,index}:{topic:PeriodTopic;index:number}){
    return <tr className={cell.row+" align-top"}>
        <td className={cell.num+" text-zinc-500"}>{index+1}</td>
        <td className={cell.cell+" min-w-64"}>{topic.href?<Link className={ui.link} href={topic.href} prefetch={reportLinkPrefetch(topic.href)}>{topic.event}</Link>:topic.event}</td>
        <td className={cell.cell+" whitespace-nowrap tabular-nums"}>{topic.date}</td>
        <td className={cell.num}>{count(topic.channels)}</td>
        <td className={cell.num}>{count(topic.videos)}</td>
        <td className={cell.num}>{count(topic.keywordCount)}</td>
        <td className={cell.cell+" whitespace-nowrap"}>{topic.topPerson||"—"}</td>
        <td className={cell.num}>{count(topic.topPersonCount)}</td>
        <td className={cell.cell+" whitespace-nowrap"}>{topic.topKeyword||"—"}</td>
        <td className={cell.num}>{count(topic.topKeywordCount)}</td>
    </tr>;
}
export async function AiPeriodsBoard({apiPath,path,search,title,filterPath}:{apiPath:string;path:string;search:Search;title:string;family:string;filterPath?:string}){
    const result=await readAiReportPages(apiPath,search);
    if(!result.ok){
        if(result.status===404)notFound();
        return <Unavailable status={result.status} title={title}/>;
    }
    const {data,meta}=result.response;
    if(!Array.isArray(data.rows)){rejectMalformedPayload();return <Unavailable status={502} title={title}/>;}
    const filter=(key:string)=>{const v=data.filters?.find(f=>f.key===key)?.value;return typeof v==="string"?v:"";};
    const from=filter("from"),to=filter("to"),month=filter("month")||null,condition=filter("condition")||"all",type=filter("type");
    const topics=periodTopics(data.rows),stats=periodStats(topics),days=rangeDays(from,to);
    return <>
        <Heading title={aiPeriodsTitle({from,to,month},condition)} lead={`${from} – ${to} · ${count(data.total)} 個事件`} meta={meta}/>
        <DataNotice meta={meta}/>
        <Tabs items={familyTabs(path,search,meta.coverage)} active={path}/>
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
                <SectionTabs label="條件" tabs={AI_DAILY_CONDITIONS.map(([key,label])=>({href:pageHref(path,search,{condition:key==="all"?null:key}),label,current:condition===key}))}/>
                <SectionTabs label="月份" tabs={recentMonths().map(m=>({href:pageHref(path,search,{month:m,from:null,to:null}),label:m,current:month===m}))}/>
            </div>
            <form className="flex flex-wrap items-end gap-3 text-sm" action={filterPath||path}>
                {condition!=="all"&&<input type="hidden" name="condition" value={condition}/>}
                {type&&<input type="hidden" name="type" value={type}/>}
                <label className={ui.label}>起日<input className={ui.input} type="date" name="from" defaultValue={from}/></label>
                <label className={ui.label}>迄日<input className={ui.input} type="date" name="to" defaultValue={to}/></label>
                <button className={ui.button}>套用期間</button>
            </form>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">條件：{conditionLabel(condition)} · 期間：{from} – {to}{month&&<> · 月份：{month}</>}{type&&<> · 資料類型：{type}</>}</p>
            <section className="grid grid-cols-1 gap-3 sm:grid-cols-2" aria-label="期間統計">
                <Metric label="事件" value={count(data.total)} unit="個" detail={`${count(stats.dates)} / ${count(days)} 天有每日議題`}/>
                <Metric label="彙整統計" value={count(stats.stored)} unit="個事件" detail={`其餘 ${count(topics.length-stats.stored)} 個只有原始每日議題`}/>
            </section>
            <h2 className="text-lg font-semibold">期間事件</h2>
            {topics.length?<TableScroller card label="期間事件表格，可左右捲動">
                <table className="w-full min-w-[960px] text-left text-sm">
                    <thead className="bg-(--table-head-bg) text-xs text-zinc-600 dark:text-zinc-400"><tr>
                        {COLUMNS.map((label,i)=><th key={i} scope="col" className={(NUMERIC.has(i)?cell.num:cell.cell)+" whitespace-nowrap"}>{label}</th>)}
                    </tr></thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">{topics.map((topic,index)=><Row key={index} topic={topic} index={data.offset+index}/>)}</tbody>
                </table>
            </TableScroller>
                :<div className="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">這個期間目前沒有可用的每日 AI 議題。</div>}
        </div>
        <Pagination collection={data} search={search} path={path}/>
        <ReportMethod path={path} meta={meta} notes={[
            "事件依日期由新到舊、同日依每日議題順序排列；事件連到該日的議題分析。",
            "媒體事件數是議題涵蓋的頻道數。影片數、關鍵字數、最重要人與最重要事來自已儲存的彙整統計；只有原始每日議題時顯示「—」，不以零代替。",
            "最重要人排除「無」；最重要事是排除人物名稱後被提及最多的關鍵字，次數為該詞的記錄數。",
            ...(data.notes??[]),
        ]}/>
    </>;
}
