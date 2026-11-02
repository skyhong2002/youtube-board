import Link from "next/link";
import {api,type RelatedVideo,type Search,type TopicRelatedData} from "@/lib/api";
import {reportStyle as ui} from "@/lib/report-styles";
import {count,shortDateTime} from "@/lib/format";
import {queryString} from "@/lib/query-string";
import {relatedPage} from "@/lib/topic-coverage";
import {SectionHeading} from "@/components/ReportUI";
import {VideoThumbnail} from "@/components/VideoThumbnail";

const empty="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400";
const chip="inline-flex rounded bg-zinc-100 px-1.5 text-[11px] leading-5 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400";

function VideoList({rows}:{rows:RelatedVideo[]}){
    return <ol className="divide-y divide-zinc-200 dark:divide-zinc-800">{rows.map(v=><li className="flex gap-3 py-2.5" key={v.videoId}>
        <Link href={`/videos/${encodeURIComponent(v.videoId)}`} tabIndex={-1} aria-hidden="true" className="shrink-0"><VideoThumbnail videoId={v.videoId} width={96} height={54}/></Link>
        <div className="min-w-0 space-y-1 text-sm">
            <Link className="line-clamp-2 font-medium leading-snug hover:underline" href={`/videos/${encodeURIComponent(v.videoId)}`}>{v.title}</Link>
            <p className="flex flex-wrap gap-x-2 text-xs text-zinc-600 dark:text-zinc-400">
                <Link className={ui.link} href={`/channels/${v.channelId}`}>{v.channelTitle}</Link>
                <span className="tabular-nums">{v.views===null?"觀看 —":`觀看 ${count(v.views)}`}</span>
                <span className="tabular-nums">{shortDateTime(v.publishedAt)}</span>
            </p>
            <p className="flex flex-wrap items-center gap-1" aria-label="比對到的詞"><span className="text-[11px] text-zinc-500">比對</span>{v.matchedTerms.map(t=><span className={chip} key={t}>{t}</span>)}</p>
        </div>
    </li>)}</ol>;
}

/** The event page's「其他頻道相關影片」: rule-matched videos of every channel that day, kept apart from the AI citations. */
export async function TopicRelatedVideos({dailyId,title,path,search}:{dailyId:number;title:string;path:string;search:Search}){
    const page=relatedPage(search.relatedPage);
    const result=await api<TopicRelatedData>(`ai/days/${dailyId}/events/related`,{event:title,page:String(page)},{optional:true});
    if(!result.ok)return result.status===404?null:<section aria-label="其他頻道相關影片"><SectionHeading title="其他頻道相關影片"/><p className={empty}>相關影片暫時無法讀取。</p></section>;
    const d=result.response.data,c=d.coverage;
    if(c.status!=="ready")return <section aria-label="其他頻道相關影片"><SectionHeading title="其他頻道相關影片"/><p className={empty}>這一天的影片太多，相關影片沒有計算。</p></section>;
    const pages=Math.ceil(c.videos/d.pageSize),href=(p:number)=>`${path}${queryString({...search,relatedPage:p>1?String(p):undefined})}#related`;
    return <section id="related" className="scroll-mt-20" aria-label="其他頻道相關影片">
        <SectionHeading title="其他頻道相關影片"/>
        <div className={ui.panel+" space-y-3"}>
            <p className="text-sm"><strong className="text-brand-700 dark:text-brand-400">{count(c.channels)} 個頻道在談</strong>
                <span className="text-zinc-600 dark:text-zinc-400">（AI 引用 {count(c.aiChannels)} 個頻道{c.networks!==null&&<>，共 {count(c.networks)} 個媒體集團</>}）· 另有 {count(c.videos)} 支相關影片，依觀看排序</span></p>
            <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                規則比對 {d.date} 全部頻道的影片：標題同時出現議題人物與事件詞才算（沒有具名人物的議題需兩個事件詞）。這不是 AI 判讀，可能有誤判；AI 已引用的影片不重複列出。
                {d.terms.people.length>0&&<> 人物：{d.terms.people.join("、")}。</>}{d.terms.events.length>0&&<> 事件詞：{d.terms.events.join("、")}。</>}
            </p>
            {d.rows.length?<VideoList rows={d.rows}/>:<p className={empty}>{page>1?"這一頁沒有資料。":"除了 AI 引用的影片，沒有其他頻道的影片符合比對條件。"}</p>}
            {pages>1&&<nav className="flex flex-wrap items-center justify-between gap-3 text-sm" aria-label="相關影片頁碼">
                <span className="text-zinc-600 dark:text-zinc-400">第 {count(page)} / {count(pages)} 頁</span>
                <span className="flex gap-5">{page>1&&<Link className={ui.link} href={href(page-1)} scroll={false}>← 上一頁</Link>}{page<pages&&<Link className={ui.link} href={href(page+1)} scroll={false}>下一頁 →</Link>}</span>
            </nav>}
            {d.possibleTotal>0&&<details className="rounded-lg border border-dashed border-zinc-300 px-3 py-2 dark:border-zinc-700">
                <summary className="cursor-pointer text-sm text-zinc-600 dark:text-zinc-400">也可能相關 {count(d.possibleTotal)} 支（同樣接近當天其他議題，不計入數字）</summary>
                <VideoList rows={d.possible}/>
                {d.possibleTotal>d.possible.length&&<p className="py-2 text-xs text-zinc-500">只列出觀看最高的 {count(d.possible.length)} 支。</p>}
            </details>}
        </div>
    </section>;
}
