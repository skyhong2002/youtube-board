import {FilterPicker} from './FilterPicker';
import {reportStyle as ui} from '@/lib/report-styles';
import {VIDEO_LIST_MAX} from '../../../shared/video-listing';
import { CHANNEL_SORTS, type ChannelRanking } from '../../../shared/channel-ranking';
import type { Search } from "@/lib/api";
import { first } from "@/lib/format";
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
    const advancedOpen=['tagid','or','not','channelId','channelIds','column','min','hours','from','to',...(keywordVideos&&!exactWindow?['days']:[])].some(key=>{
        const value=search[key];return Array.isArray(value)?value.some(v=>v!==''):value!==undefined&&value!=='';
    });
    return (
        <form key={JSON.stringify([path,search])} className={ui.form} action={path} method="get">
            {exactWindow&&['since','until','rankingPool'].filter(key=>first(search[key])!==undefined).map(key=><input key={key} type="hidden" name={key} value={first(search[key])}/>)}
            {['tagid','or','not','channelIds','days'].filter(key=>!(taxonomyPicker&&['tagid','or','not'].includes(key))&&!(keywordVideos&&key==='days')).flatMap(key => {
                const value = search[key]; return (Array.isArray(value) ? value : value === undefined ? [] : [value]).map((value,index) => <input key={`${key}-${index}`} type="hidden" name={key} value={value} />);
            })}
            {mode === "ai" ? (
                <label className={ui.label}>
                    分析日期
                    <input className={ui.input}
                        type="date"
                        name="date"
                        defaultValue={first(search.date) || ""}
                    />
                </label>
            ) : (
                <>
                    <label className={ui.label}>
                        搜尋
                        <input className={ui.input}
                            type="search"
                            maxLength={100}
                            name="q"
                            placeholder={
                                mode === "channels" ? "頻道名稱或 YouTube ID" : mode === "videos" ? "影片標題或描述" : "標題或頻道"
                            }
                            defaultValue={first(search.q) || ""}
                        />
                    </label>
                    <label className={ui.label}>
                        顯示筆數
                        <select className={ui.input}
                            name="limit"
                            defaultValue={selectedLimit}
                        >
                            {!["20","50","100","200",...(mode==="videos"?["500","1000"]:[])].includes(selectedLimit) && <option value={selectedLimit}>{selectedLimit} 筆</option>}
                            <option value="20">20 筆</option>
                            <option value="50">50 筆</option>
                            <option value="100">100 筆</option>
                            <option value="200">200 筆</option>
                            {mode==="videos"&&<><option value="500">500 筆</option><option value="1000">1000 筆</option></>}
                        </select>
                    </label>
                    <details className="w-full rounded-lg border border-zinc-200 px-3 dark:border-zinc-700">
                    <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-zinc-700 dark:text-zinc-300">進階篩選（分類、日期與門檻）{advancedOpen?' · 已套用條件':''}</summary>
                    <div className="flex flex-wrap items-end gap-3 pb-3">
                    {mode === "channels" && channelRanking && (<>
                        <label className={ui.label}>排序<select className={ui.input} name="column" defaultValue={channelRanking.column}>{CHANNEL_SORTS.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
                        <label className={ui.label}>{channelRanking.minMetric==='views'?'至少累計觀看':'至少訂閱人數'}<input className={ui.input} name="min" type="number" min="0" max="9007199254740991" defaultValue={channelRanking.min??''} placeholder={channelRanking.scope==='tag'?'預設 0（排除缺值）':'不限'} /></label>
                    </>)}
                    {taxonomyPicker && [["tagid","同時符合分類"],["or","符合任一分類"],["not","排除分類"]].map(([key,label])=><FilterPicker key={key} name={key!} label={label!} kind="tags" value={search[key!]??''}/>)}
                    {mode === "live" && (<>
                        <label className={ui.label}>最近開始直播（小時）<input className={ui.input} name="hours" type="number" min="1" max="168" defaultValue={first(search.hours)||''} placeholder="不限開始時間" /></label>
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
                    </div>
                    </details>
                </>
            )}
            {mode === "ai" && first(search.condition) && (
                <input className={ui.input}
                    type="hidden"
                    name="condition"
                    value={first(search.condition)}
                />
            )}
            <button className={ui.primary} type="submit">
                套用篩選
            </button>
            <a className={ui.button} href={path}>
                清除
            </a>
        </form>
    );
}
