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
import {aiStack} from "@/lib/ai-table-stack";
import {count} from "@/lib/format";
import {readAiReportPages} from "@/lib/ai-hours-pages";
import {pageHref} from "@/lib/ai-hours-board";
import {aiPeriodsTitle,periodStats,periodTopics,rangeDays,recentMonths,type PeriodTopic} from "@/lib/ai-periods-board";
/** The site filter box (Filters.tsx), without its outer margin inside this stacked column. */
const FORM=ui.form.replace("my-4 ","");

/** The Laravel /ai/periods content and order (condition and month switchers, the filter line,
 * the event count, then the numbered 期間事件 table), drawn with the site's tabs, cards and tables. */
const conditionLabel=(key:string)=>AI_DAILY_CONDITIONS.find(([k])=>k===key)?.[1]??key;
// 最重要人 / 最重要事 carry their own count beside the name, so no two columns are both headed 「次數」.
const COLUMNS=["編號","事件","日期","媒體事件數","影片數","關鍵字數","最重要人（次數）","最重要事（次數）"];
const NUMERIC=new Set([0,3,4,5]);
const none=<span className="text-zinc-400">—</span>;
function Top({term,n}:{term:string;n:number|null}){
    return term?<>{term}<span className="ml-1.5 tabular-nums text-zinc-500 dark:text-zinc-400">{count(n)}</span></>:none;
}
// Event titles read like the other AI lists (dark, red on hover), not a column of red links.
const eventLink="font-medium text-zinc-900 hover:text-brand-700 hover:underline dark:text-zinc-100 dark:hover:text-brand-400";
function Row({topic,index}:{topic:PeriodTopic;index:number}){
    const field=(i:number,empty=false)=>({className:(NUMERIC.has(i)?cell.num:cell.cell+" whitespace-nowrap")+" "+aiStack.field+(empty?" "+aiStack.empty:""),"data-label":COLUMNS[i]});
    return <tr className={cell.row+" align-top "+aiStack.row}>
        <td className={cell.num+" text-zinc-500 "+aiStack.index}>{index+1}</td>
        <td className={cell.cell+" min-w-64 "+aiStack.lead}>{topic.href?<Link className={eventLink} href={topic.href} prefetch={reportLinkPrefetch(topic.href)}>{topic.event}</Link>:topic.event}</td>
        <td {...field(2)}><span className="tabular-nums">{topic.date}</span></td>
        <td {...field(3)}>{count(topic.channels)}</td>
        <td {...field(4)}>{count(topic.videos)}</td>
        <td {...field(5)}>{count(topic.keywordCount)}</td>
        <td {...field(6,!topic.topPerson)}><Top term={topic.topPerson} n={topic.topPersonCount}/></td>
        <td {...field(7,!topic.topKeyword)}><Top term={topic.topKeyword} n={topic.topKeywordCount}/></td>
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
        <Heading title={aiPeriodsTitle({from,to,month},condition)} lead={`${month?`${from} – ${to} · `:""}${count(data.total)} 個事件${type?` · 資料類型 ${type}`:""}`} meta={meta}/>
        <DataNotice meta={meta}/>
        <Tabs items={familyTabs(path,search,meta.coverage)} active={path}/>
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
                <SectionTabs label="條件" tabs={AI_DAILY_CONDITIONS.map(([key,label])=>({href:pageHref(path,search,{condition:key==="all"?null:key}),label,current:condition===key}))}/>
                <SectionTabs label="月份" tabs={recentMonths().map(m=>({href:pageHref(path,search,{month:m,from:null,to:null}),label:m,current:month===m}))}/>
            </div>
            <form className={FORM} method="get" action={filterPath||path}>
                {condition!=="all"&&<input type="hidden" name="condition" value={condition}/>}
                {type&&<input type="hidden" name="type" value={type}/>}
                <label className={ui.label}>開始日期<input className={ui.input} type="date" name="from" defaultValue={from}/></label>
                <label className={ui.label}>結束日期<input className={ui.input} type="date" name="to" defaultValue={to}/></label>
                <button className={ui.primary} type="submit">套用期間</button>
            </form>
            <section className="grid grid-cols-2 gap-2 sm:gap-3" aria-label="期間統計">
                <Metric label="事件" value={count(data.total)} unit="個" detail={`${count(stats.dates)} / ${count(days)} 天有每日議題`}/>
                <Metric label="彙整統計" value={count(stats.stored)} unit="個事件" detail={`其餘 ${count(topics.length-stats.stored)} 個只有原始每日議題`}/>
            </section>
            <h2 className="text-lg font-semibold">期間事件</h2>
            {topics.length?<TableScroller card label="期間事件表格，可左右捲動">
                <table className={"w-full text-left text-sm sm:min-w-[960px] "+aiStack.table}>
                    <thead className={"bg-(--table-head-bg) text-xs text-zinc-600 dark:text-zinc-400 "+aiStack.head}><tr>
                        {COLUMNS.map((label,i)=><th key={i} scope="col" className={(NUMERIC.has(i)?cell.num:cell.cell)+" whitespace-nowrap"}>{label}</th>)}
                    </tr></thead>
                    <tbody className={"divide-y divide-zinc-100 dark:divide-zinc-800 "+aiStack.body}>{topics.map((topic,index)=><Row key={index} topic={topic} index={data.offset+index}/>)}</tbody>
                </table>
            </TableScroller>
                :<div className="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400" role="status">
                    <p>{from} – {to}{condition==="all"?"":`「${conditionLabel(condition)}」條件`}目前沒有可用的每日 AI 議題。</p>
                    {condition!=="all"&&<p className="mt-3"><Link className={ui.link} href={pageHref(path,search,{condition:null})}>改看全部媒體</Link></p>}
                </div>}
        </div>
        <Pagination collection={data} search={search} path={path}/>
        <ReportMethod path={path} meta={meta} notes={[
            "事件依日期由新到舊、同日依每日議題順序排列；事件連到該日的議題分析。",
            "有彙整統計的事件，媒體事件數、影片數、關鍵字數、最重要人與最重要事取自彙整統計。只有原始每日議題的事件，媒體事件數是議題列出的頻道數，影片數是各頻道媒體事件筆數的加總（事件引用數，不是不重複影片數），關鍵字數為 0，最重要人與最重要事顯示「—」（舊版期間報表顯示「-」與次數 0）。",
            "最重要人排除「無」；最重要事是排除人物名稱後被提及最多的關鍵字，次數為該詞的記錄數。",
            ...(data.notes??[]),
        ]}/>
    </>;
}
