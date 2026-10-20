import Link from "next/link";
import SectionTabs from "@/components/SectionTabs";
import {Heading,DataNotice,Unavailable,Tabs,Metric} from "@/components/ReportUI";
import {ReportMethod} from "@/components/ReportMethod";
import {AI_DAILY_CONDITIONS} from "@/components/AiDailyBoard";
import {familyTabs} from "@/lib/report-navigation";
import {api,type Search} from "@/lib/api";
import {reportStyle as ui} from "@/lib/report-styles";
import {count,dateTime} from "@/lib/format";
import {blockedReason,omittedReason,promptCondition,promptFilters,promptHref,promptPeriod,promptPeriodHref,shiftDay,type OmittedMedia,type PromptMedia} from "@/lib/ai-day-prompt-preview";
import {taipeiToday} from "@/lib/ai-hours-board";
/** The site filter box (Filters.tsx), without its outer margin inside this stacked column. */
const FORM=ui.form.replace("my-4 ","");

interface DayPrompt {title:string;promptVersion:string;prompt:string;schema:unknown;sourceCount:number;sourceLimit:number;omitted:number;bounds?:{min:number;max:number};blocked:string|null;period?:{from:string;to:string};media?:PromptMedia[];omittedMedia?:OmittedMedia[];notes:string[]}
const conditionLabel=(key:string)=>AI_DAILY_CONDITIONS.find(([k])=>k===key)?.[1]??key;

function MediaTitle({channelId,title,videos}:{channelId:number;title:string;videos:number}){
    return <h3 className="flex flex-wrap items-baseline gap-x-2 text-base font-semibold leading-snug">
        <Link className="hover:text-brand-700 hover:underline dark:hover:text-brand-400" href={`/channels/${channelId}`}>{title}</Link>
        <span className="text-xs font-normal tabular-nums text-zinc-500">影片 {count(videos)}</span>
    </h3>;
}
function Media({media}:{media:PromptMedia}){
    return <article className={ui.panel}>
        <MediaTitle channelId={media.channelId} title={media.title} videos={media.videoCount}/>
        <ul className="mt-2 divide-y divide-zinc-200 text-sm leading-relaxed dark:divide-zinc-800">
            {media.events.map((e,i)=><li className="py-2" key={`${e.event}-${i}`}>
                <div className="font-medium text-zinc-900 dark:text-zinc-100">{e.event}</div>
                {e.description&&<p className="mt-0.5 text-zinc-700 dark:text-zinc-300">{e.description}</p>}
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-zinc-500">
                    <span className="tabular-nums">新聞數 {count(e.videoCount)}</span>
                    {e.keywords.slice(0,8).map(k=><Link key={k} className={ui.tag+" hover:bg-zinc-200 dark:hover:bg-zinc-700"} href={`/keywords/${encodeURIComponent(k)}/videos`}>{k}</Link>)}
                </div>
            </li>)}
        </ul>
    </article>;
}

function Omitted({media}:{media:OmittedMedia}){
    return <article className={ui.panel}>
        <MediaTitle channelId={media.channelId} title={media.title??`頻道 ${media.channelId}`} videos={0}/>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{omittedReason(media.reason)}</p>
    </article>;
}

/** The Laravel /ai/days prompt preview (date and condition switchers, filter chips, prompt stats,
 * custom from/to period, the readonly prompt and each media's source events), drawn with the site's own tabs, cards and tags. */
export async function AiDayPromptBoard({apiPath,search,path}:{apiPath:string;search:Search;path:string}){
    const result=await api<DayPrompt>(apiPath,search);if(!result.ok)return <Unavailable status={result.status} title="提示詞預覽"/>;
    const {data,meta}=result.response,condition=promptCondition(path,search),period=promptPeriod(data.period);
    const media=data.media??null,omitted=data.omittedMedia??[],events=media?.reduce((n,m)=>n+m.events.length,0)??0,videos=media?.reduce((n,m)=>n+m.videoCount,0)??0;
    const scope=condition==="all"?"":" "+conditionLabel(condition);
    const title=!period?data.title:period.custom?`${period.from} – ${period.to}${scope} 彙整提示詞預覽`:`${period.from}${scope} 每日彙整提示詞預覽`;
    const href=(key:string)=>period?.custom?promptPeriodHref(period.from,period.to,key,search):promptHref(period!.from,key,search);
    return <>
        <Heading title={title} meta={meta} lead={<>{period?`${period.from} 00:00:00 – ${period.to} 23:59:59`:"—"} · 產生於 {dateTime(meta.requestedAt)}</>}/>
        <DataNotice meta={meta}/>
        <Tabs items={familyTabs(path,search,meta.coverage)} active={path}/>
        <div className="space-y-4">
            {period&&<>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
                    <SectionTabs label="日期" tabs={[
                        {href:promptHref(shiftDay(period.from,-1),condition,search),label:`← ${shiftDay(period.from,-1)}`},
                        {href:href(condition),label:period.custom?`${period.from} – ${period.to}`:period.from,current:true},
                        ...(shiftDay(period.to,1)<=taipeiToday()?[{href:promptHref(shiftDay(period.to,1),condition,search),label:`${shiftDay(period.to,1)} →`}]:[]),
                    ]}/>
                    <SectionTabs label="條件" tabs={AI_DAILY_CONDITIONS.map(([key,label])=>({href:href(key),label,current:condition===key}))}/>
                </div>
                <form className={FORM} method="get" action="/ai/days/prompt">
                    {condition!=="all"&&<input type="hidden" name="condition" value={condition}/>}
                    {(["type","limit"] as const).map(key=>{const value=[search[key]].flat()[0];return value?<input key={key} type="hidden" name={key} value={value}/>:null;})}
                    <label className={ui.label}>開始日期<input className={ui.input} type="date" name="from" required defaultValue={period.from}/></label>
                    <label className={ui.label}>結束日期<input className={ui.input} type="date" name="to" required defaultValue={period.to}/></label>
                    <button className={ui.primary} type="submit">套用期間</button>
                </form>
            </>}
            <ul className="flex flex-wrap gap-1.5" aria-label="來源條件">
                {promptFilters(condition,search,data.sourceLimit).map(([k,v])=><li className={ui.tag+" font-mono"} key={k}>{k}={v}</li>)}
                <li className={ui.tag+" font-mono"}>prompt={data.promptVersion}</li>
            </ul>
            <section className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label="提示詞統計">
                <Metric label="媒體" value={media?count(media.length):"—"} unit="個" detail={`${count(data.sourceCount)} 個頻道有${period?.custom?"期間":"當日"}摘要 · 未納入 ${count(data.omitted)}`}/>
                <Metric label="來源事件" value={media?count(events):"—"} unit="個" detail={`引用 ${count(videos)} 則影片`}/>
                <Metric label="輸出事件數" value={data.bounds?`${data.bounds.min} – ${data.bounds.max}`:"—"} unit="個" detail="要求模型輸出的事件數範圍"/>
            </section>
            {data.blocked&&<p className={ui.note} role="status">這份來源目前不能執行生成：{blockedReason(data.blocked)}</p>}
            {media&&media.length===0&&omitted.length===0?<div className="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">這個日期與條件目前沒有可用的每日 AI 提示詞來源資料。</div>:<>
                <section aria-labelledby="prompt-text">
                    <h2 className="mb-2 text-base font-semibold" id="prompt-text">提示詞</h2>
                    <textarea className="min-h-[420px] w-full resize-y rounded-xl border border-zinc-300 bg-white p-3 font-mono text-[13px] leading-relaxed text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100" readOnly defaultValue={data.prompt} aria-labelledby="prompt-text"/>
                    <details className="mt-2 text-sm">
                        <summary className="cursor-pointer text-zinc-600 dark:text-zinc-400">輸出資料格式</summary>
                        <pre className="mt-2 overflow-x-auto rounded-lg bg-zinc-50 p-3 font-mono text-xs leading-relaxed dark:bg-zinc-950/60">{JSON.stringify(data.schema,null,2)}</pre>
                    </details>
                </section>
                {media&&<section className="space-y-3" aria-labelledby="prompt-media">
                    <h2 className="text-base font-semibold" id="prompt-media">媒體事件來源</h2>
                    {media.map(m=><Media key={`${m.channelId}-${m.sourcePk}`} media={m}/>)}
                    {omitted.map(m=><Omitted key={`${m.channelId}-${m.sourcePk}`} media={m}/>)}
                </section>}
            </>}
        </div>
        <ReportMethod path={path} meta={meta} notes={[
            ...data.notes,
            "媒體事件來源是提示詞內附的來源資料：媒體依各事件引用影片數合計由多到少排列，新聞數為該事件引用的影片數，關鍵字最多列 8 個。",
            "「全部」條件只納入引用 2 則以上影片的事件；其他條件納入至少 1 則。沒有符合事件、名稱重複或摘要無法解析的媒體不列入提示詞，列在媒體事件來源最後並註明原因，計入「未納入」；超過來源上限而未讀取的媒體只計數、不列出。",
            "日期以台北時間計。填入開始日期與結束日期可預覽自訂期間（最多 31 天），讀取區間正好是開始日期 00:00:00 至結束日期 23:59:59 的頻道摘要（週或累計等資料類型）；前後日切換回到單日並保留目前條件。",
        ]}/>
    </>;
}
