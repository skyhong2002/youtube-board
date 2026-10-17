import Link from "next/link";
import {notFound} from "next/navigation";
import SectionTabs from "@/components/SectionTabs";
import TableScroller from "@/components/TableScroller";
import {ChannelAvatar} from "@/components/ChannelAvatar";
import {ReportMethod} from "@/components/ReportMethod";
import {Heading,DataNotice,Unavailable,Tabs,Pagination} from "@/components/ReportUI";
import {api,rejectMalformedPayload,type Search} from "@/lib/api";
import {count} from "@/lib/format";
import {familyTabs} from "@/lib/report-navigation";
import {reportStyle as ui} from "@/lib/report-styles";
import {table as tableStyle} from "@/lib/table-styles";
import {reportLinkPrefetch,safeReportHref,type ReportData} from "@/lib/report-contract";
import {AI_ASPECT_COLUMNS,AI_ASPECT_CONDITIONS,aspectConditionHref,aspectFilterChips,aspectFilters,aspectRows,aspectTitle,type AspectRow} from "@/lib/ai-aspects-board";
import {aiAspectsSources} from "@/lib/ai-aspects-sources";
import type {ChannelTag} from "@/lib/api";

const NOTES=[
    "條件切換沿用原報表的分類對應：泛藍＝分類「泛藍」、泛綠＝分類「泛綠」、財經＝分類「財經」、國際＝分類「台灣國際」；中立＝排除泛藍、泛綠、泛紅、泛白、財經、台灣國際。切換條件會取代網址中的 tagid / or / not 分類篩選。",
    "最右欄「傾向」是上述排序公式的結果（泛綠度＋泛白度－泛藍度－泛紅度＋台灣立場－中國立場）；缺少的分數以 0 計入並標上 *，六項皆缺則留空。",
    "分數格的滑鼠提示是模型對該項目的描述；「分析 #編號」連到該頻道完整的 AI 分析紀錄。",
    "頻道下方的分類標籤只列原報表顯示的社論、政治人物、泛藍、泛綠、泛紅、泛白、反共、韓粉、台灣立場、中國立場與廣播，取自頻道目錄的分類資料。",
];

function Channel({row,tags}:{row:AspectRow;tags:ChannelTag[]}){
    const href=safeReportHref(row.href??undefined),source=safeReportHref(row.source?.href);
    return <div className={tableStyle.leadBox+" flex items-center gap-2.5 sm:min-w-64 sm:whitespace-normal"}>
        <ChannelAvatar avatar={row.avatar} title={row.title} size={32}/>
        <div className="min-w-0">
            {href?<Link className={tableStyle.leadText+" block font-medium text-zinc-900 hover:text-brand-700 hover:underline dark:text-zinc-100 dark:hover:text-brand-400"} href={href} prefetch={reportLinkPrefetch(href)}>{row.title}</Link>:<span className={tableStyle.leadText+" block font-medium"}>{row.title}</span>}
            <div className={tableStyle.leadWide+" mt-1 flex flex-wrap items-center gap-1"}>
                {tags.map(t=><span key={t.id} className={ui.tag}>{t.name}</span>)}
                {source&&<Link className="text-xs text-zinc-500 hover:text-brand-700 hover:underline dark:text-zinc-400 dark:hover:text-brand-400" href={source} prefetch={reportLinkPrefetch(source)}>分析 {row.source!.label}</Link>}
            </div>
        </div>
    </div>;
}

/** The Laravel /ai/aspects page (condition switcher, active filters, one table of channels with
 * their visible tags, six aspect scores and the 傾向 balance), drawn with the site's tabs,
 * avatars, tag chips and table scroller. */
export async function AiAspectsBoard({apiPath,path,search,title}:{apiPath:string;path:string;search:Search;title:string;family:string;filterPath?:string}){
    const filters=aspectFilters(search);
    const [result,sources]=await Promise.all([api<ReportData>(apiPath,search),aiAspectsSources(filters)]);
    if(!result.ok){
        if(result.status===404)notFound();
        return <Unavailable status={result.status} title={title}/>;
    }
    const {data,meta}=result.response;
    if(!Array.isArray(data.rows)){
        rejectMalformedPayload();
        return <Unavailable status={502} title={title}/>;
    }
    const rows=aspectRows(data),chips=aspectFilterChips(filters,sources.names),active=filters.condition??"all";
    return <>
        <Heading title={aspectTitle(filters,sources.names)} lead={`${count(data.total)} 個頻道`} meta={meta}/>
        <DataNotice meta={meta}/>
        <Tabs items={familyTabs(path,search,meta.coverage)} active={path}/>
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
                <SectionTabs label="條件" tabs={AI_ASPECT_CONDITIONS.map(([key,label])=>({href:aspectConditionHref(path,search,key),label,current:active===key}))}/>
                {chips.length>0&&<ul className="flex flex-wrap gap-1.5 text-xs" aria-label="目前篩選">
                    {chips.map(c=><li key={c.label} className={ui.tag}><span className="mr-1 text-zinc-500 dark:text-zinc-400">{c.label}</span>{c.value}</li>)}
                </ul>}
            </div>
            {rows.length?<TableScroller card label="立場分布表，可左右捲動">
                <table className={"w-full text-left text-sm "+tableStyle.nowrap}>
                    <thead className="bg-(--table-head-bg) text-xs text-zinc-600 dark:text-zinc-400"><tr>
                        <th scope="col" className={tableStyle.leadHead}>頻道</th>
                        {AI_ASPECT_COLUMNS.map(([key,label])=><th key={key} scope="col" className={tableStyle.num}>{label}</th>)}
                        <th scope="col" className={tableStyle.num}>傾向</th>
                    </tr></thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                        {rows.map((row,i)=><tr key={`${row.channelId??row.title}-${i}`} className={tableStyle.row}>
                            <th scope="row" className={tableStyle.lead+" font-normal"}><Channel row={row} tags={row.channelId===null?[]:sources.channelTags.get(row.channelId)??[]}/></th>
                            {AI_ASPECT_COLUMNS.map(([key])=>{const s=row.scores[key];return <td key={key} className={tableStyle.num} title={s.detail||undefined}>{s.value===null?<span className="text-zinc-400">—</span>:count(s.value)}</td>;})}
                            <td className={tableStyle.num+" font-semibold"} title={row.partial?"部分分數缺值，以 0 計入":undefined}>{count(row.balance)}{row.partial&&<span className="text-zinc-400">*</span>}</td>
                        </tr>)}
                    </tbody>
                </table>
            </TableScroller>
            :<div className="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">目前沒有符合條件的立場資料。</div>}
            {rows.length>0&&!sources.tagsComplete&&<p className="text-xs text-zinc-500 dark:text-zinc-400">頻道分類標籤暫時無法完整讀取，部分頻道可能未列出標籤。</p>}
        </div>
        <Pagination collection={data} search={search} path={path}/>
        <ReportMethod path={path} description={data.description} meta={meta} notes={[...(data.notes??[]),...NOTES]}/>
    </>;
}
