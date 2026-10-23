import {FilterPicker} from './FilterPicker';
import type {FilterPickerMode} from './FilterPickerInput';
import {reportStyle as ui} from '@/lib/report-styles';
import {VIDEO_LIST_MAX} from '../../../shared/video-listing';
import { CHANNEL_SORTS, type ChannelRanking } from '../../../shared/channel-ranking';
import type { Search } from "@/lib/api";
import { first } from "@/lib/format";

const TAXONOMY:[string,string][]=[["or","任一分類"],["tagid","同時符合"],["not","排除"]];
// One taxonomy picker writes either list: or = any of the chosen tags, tagid = all of them.
const TAXONOMY_MODES:FilterPickerMode[]=[{name:'or',label:'符合任一',description:'頻道有其中任何一個分類就列出。'},{name:'tagid',label:'全部符合',description:'頻道要同時有所有選取的分類才列出。'}];
/** Start-time presets of /live/current (hours since actualStartTime); a custom stored value stays selectable. */
const HOURS:[string,string][]=[["","不限"],["6","6 小時內"],["24","24 小時內"],["72","3 天內"],["168","7 天內"]];
const hourChoices=(current:string)=>HOURS.some(([v])=>v===current)?HOURS:[...HOURS,[current,`${current} 小時內`] as [string,string]];
export function ReportFilters({
    search,
    mode,
    path,
    channelRanking,
}: {
    search: Search;
    mode: "live" | "channels" | "videos" | "ai";
    path: string;
    channelRanking?: ChannelRanking;
}) {
    // channelId is one urt_channel.u_id; channelIds is the independent legacy u_id list.
    const keywordVideos=mode==='videos'&&path.startsWith('/keywords/'),channelVideos=mode==='videos'&&/^\/channels\/\d+\/videos$/.test(path),maxLimit=mode==='videos'?VIDEO_LIST_MAX:200;
    const taxonomyPicker = mode === "channels" || mode === "live" || (mode === "videos" && !channelVideos);
    const exactWindow=keywordVideos&&!!first(search.since)&&!!first(search.until);
    const requestedLimit = first(search.limit) || "50";
    const selectedLimit = /^\d+$/.test(requestedLimit) && Number(requestedLimit) >= 1 && Number(requestedLimit) <= maxLimit ? requestedLimit : "50";
    const hidden=<>
            {exactWindow&&['since','until','rankingPool'].filter(key=>first(search[key])!==undefined).map(key=><input key={key} type="hidden" name={key} value={first(search[key])}/>)}
            {['tagid','or','not','channelIds','days'].filter(key=>!(taxonomyPicker&&['tagid','or','not'].includes(key))&&!(keywordVideos&&key==='days')).flatMap(key => {
                const value = search[key]; return (Array.isArray(value) ? value : value === undefined ? [] : [value]).map((value,index) => <input key={`${key}-${index}`} type="hidden" name={key} value={value} />);
            })}
            {mode === "ai" && first(search.condition) && <input type="hidden" name="condition" value={first(search.condition)}/>}
    </>;
    const placeholder=mode === "channels" ? "頻道名稱或 YouTube ID" : mode === "videos" ? "影片標題或描述" : "標題或頻道";
    const searchInput=(className:string)=><input className={className} type="search" maxLength={100} name="q" aria-label="搜尋" placeholder={'搜尋'+placeholder} defaultValue={first(search.q) || ""}/>;
    const limitOptions=<>
        {!["20","50","100","200",...(mode==="videos"?["500","1000"]:[])].includes(selectedLimit) && <option value={selectedLimit}>{selectedLimit} 筆</option>}
        <option value="20">20 筆</option><option value="50">50 筆</option><option value="100">100 筆</option><option value="200">200 筆</option>
        {mode==="videos"&&<><option value="500">500 筆</option><option value="1000">1000 筆</option></>}
    </>;
    const hours=first(search.hours)||'';
    // Mode-specific conditions besides taxonomy and the live start window.
    const extras=<>
        {mode === "channels" && channelRanking && (<>
            <label className={ui.label}>排序<select className={ui.input} name="column" defaultValue={channelRanking.column}>{CHANNEL_SORTS.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
            <label className={ui.label}>{channelRanking.minMetric==='views'?'至少累計觀看':'至少訂閱人數'}<input className={ui.input} name="min" type="number" min="0" max="9007199254740991" defaultValue={channelRanking.min??''} placeholder={channelRanking.scope==='tag'?'預設 0（排除缺值）':'不限'} /></label>
        </>)}
        {mode === "videos" && (<>
            {keywordVideos&&!exactWindow&&<label className={ui.label}>關鍵字往前日數<input className={ui.input} name="days" type="number" min="1" max="90" defaultValue={first(search.days)||''} placeholder="不限；7 表示含今天共 8 個日曆日" /></label>}
            <label className={ui.label}>排序<select className={ui.input} name="column" defaultValue={first(search.column)||'publishedAt'}><option value="publishedAt">最新發布</option><option value="viewCount">觀看數</option><option value="likeCount">喜歡數</option><option value="commentCount">留言數</option></select></label>
            {!exactWindow&&<label className={ui.label}>最近幾小時<input className={ui.input} name="hours" type="number" min="1" max="8760" defaultValue={first(search.hours)||''} placeholder="不限期間" /></label>}
            <label className={ui.label}>至少觀看數<input className={ui.input} name="min" type="number" min="0" max="9007199254740991" defaultValue={first(search.min)||''} placeholder="不限" /></label>
            {!exactWindow&&<><label className={ui.label}>開始日期<input className={ui.input} name="from" type="date" defaultValue={first(search.from)||''}/></label>
            <label className={ui.label}>結束日期<input className={ui.input} name="to" type="date" defaultValue={first(search.to)||''}/></label></>}
            {exactWindow&&<p className={ui.label}>保留排行的精確發布時間窗；「清除」後可另選日期。</p>}
            {!channelVideos&&<FilterPicker name="channelId" label="指定頻道" kind="channels" value={search.channelId??''} multiple={false}/>}
        </>)}
    </>;
    const hasExtras=mode==='channels'||mode==='videos';
    const buttons=(primary:string)=><span className="flex items-center gap-3"><button className={primary} type="submit">套用</button><a className="text-sm text-zinc-600 underline-offset-2 hover:underline dark:text-zinc-400" href={path}>清除</a></span>;
    if(mode==='ai')return <form key={JSON.stringify([path,search])} className={ui.form} action={path} method="get">{hidden}<label className={ui.label}>分析日期<input className={ui.input} type="date" name="date" defaultValue={first(search.date) || ""}/></label><span className="flex gap-3"><button className={ui.primary} type="submit">套用篩選</button><a className={ui.button} href={path}>清除</a></span></form>;
    const formKey=JSON.stringify([path,search]);
    const present=(key:string)=>{const value=search[key];return Array.isArray(value)?value.some(v=>v!==''):value!==undefined&&value!=='';};
    // One row of pills (chosen 2026-10-24); the live list scrolls for more rows, so only the other lists keep a row count.
    const pill='min-h-10 rounded-full border border-zinc-300 bg-white px-3.5 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300';
    return <form key={formKey} className="my-4 flex flex-wrap items-center gap-2 rounded-xl border border-zinc-300 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900" action={path} method="get">
        {hidden}
        {searchInput(`${pill} w-full sm:w-64`)}
        {taxonomyPicker&&(present('or')&&present('tagid')
            // A legacy link may carry both lists; keep them apart rather than drop one.
            ?TAXONOMY.map(([key,short])=><FilterPicker key={key} name={key} label={short} kind="tags" value={search[key]??''} layout="pill"/>)
            :<><FilterPicker name={present('tagid')?'tagid':'or'} label="分類" kind="tags" value={search[present('tagid')?'tagid':'or']??''} layout="pill" modes={TAXONOMY_MODES}/><FilterPicker name="not" label="排除" kind="tags" value={search.not??''} layout="pill"/></>)}
        {mode==='live'&&<label className="contents"><span className="sr-only">開播時間</span><select className={`${pill} ${hours?'border-brand-700 bg-brand-50 text-brand-800 dark:bg-brand-950 dark:text-brand-300':''}`} name="hours" defaultValue={hours}>{hourChoices(hours).map(([value,label])=><option key={value} value={value}>{value?`開播：${label}`:'開播：不限'}</option>)}</select></label>}
        {mode!=='live'&&<label className="contents"><span className="sr-only">顯示筆數</span><select className={pill} name="limit" defaultValue={selectedLimit}>{limitOptions}</select></label>}
        {hasExtras&&<details className="group w-fit open:basis-full"><summary className={`${pill} inline-flex cursor-pointer list-none items-center gap-1.5 [&::-webkit-details-marker]:hidden`}>更多條件<span aria-hidden="true" className="text-xs">▾</span></summary><div className="mt-2 flex flex-wrap items-end gap-3 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-950/60">{extras}</div></details>}
        <span className="ml-auto">{buttons('inline-flex min-h-10 items-center rounded-full bg-brand-700 px-4 text-sm font-medium text-white hover:bg-brand-800 dark:bg-brand-600')}</span>
    </form>;
}
