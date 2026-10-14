import { parseBoardRequest } from "./boards";
import { SEARCH_MAX_LENGTH } from "../../../shared/report-limits";
import { numericAiDailyEventId } from "./routes";

/** Validate before React streaming commits a successful HTTP status. */
export function reportRequestStatus(url: URL): { status: number; message: string; backHref?: "/ai/days" } | null {
    const dailyEventId = numericAiDailyEventId(url.pathname);
    if (dailyEventId !== null) {
        const events = url.searchParams.getAll("event");
        // Match the API's string/trim/UTF-16 length checks, rejecting duplicates too.
        if (!url.pathname.startsWith("/ai/") || !Number.isSafeInteger(Number(dailyEventId)) || Number(dailyEventId) < 1 ||
            events.length !== 1 || !events[0].trim() || events[0].length > 256)
            return { status: 400, message: "請從 AI 每日摘要選擇事件；事件名稱不可空白、重複或超過 256 字元。", backHref: "/ai/days" };
    }
    const videoList=/^\/(?:videos|tags(?:\/\d+)?\/videos|channels\/\d+\/videos|keywords\/[^/]+\/videos)\/?$/.test(url.pathname);
    if(videoList){
        const invalid=()=>({status:400,message:'影片篩選參數無效；顯示筆數須為 1 至 1000。'}),numeric:Record<string,[number,number]>={limit:[1,1000],offset:[0,100000],hours:[1,8760],min:[0,Number.MAX_SAFE_INTEGER],channelId:[1,Number.MAX_SAFE_INTEGER],...(url.pathname.startsWith('/keywords/')?{days:[1,90] as [number,number]}:{})};
        for(const [key,[min,max]]of Object.entries(numeric)){const values=url.searchParams.getAll(key);if(values.length>1)return invalid();const v=values[0];if(v===undefined||(v===''&&!['limit','offset'].includes(key)))continue;if(!/^\d+$/.test(v)||!Number.isSafeInteger(Number(v))||Number(v)<min||Number(v)>max)return invalid();}
        const one=(key:string)=>url.searchParams.getAll(key).length<=1;
        for(const key of ['column','from','to','q','tagid','or','not','channelIds'])if(!one(key))return invalid();
        const column=url.searchParams.get('column');if(column&&!['publishedAt','viewCount','likeCount','commentCount'].includes(column))return invalid();
        const from=url.searchParams.get('from'),to=url.searchParams.get('to');for(const d of [from,to])if(d&&(!/^\d{4}-\d{2}-\d{2}$/.test(d)||!Number.isFinite(Date.parse(d))||new Date(d).toISOString().slice(0,10)!==d))return invalid();if(from&&to&&from>to)return invalid();
        if((url.searchParams.get('q')||'').length>SEARCH_MAX_LENGTH)return invalid();
        for(const key of ['tagid','or','not','channelIds']){const v=url.searchParams.get(key);if(v&&(v.length>256||v.split(',').some(n=>!/^\d+$/.test(n)||!Number.isSafeInteger(Number(n))||Number(n)<1)||(key==='channelIds'&&new Set(v.split(',')).size>20)))return invalid();}
    }
    if (/^\/videos\/[^/]+\/analytics\/?$/.test(url.pathname)) {
        const id = url.pathname.split('/')[2];
        const limits = url.searchParams.getAll('limit');
        if (!/^[A-Za-z0-9_-]{1,32}$/.test(id) || limits.length > 1 ||
            (limits.length === 1 && (!/^\d+$/.test(limits[0]) || Number(limits[0]) < 1 || Number(limits[0]) > 200)))
            return { status: 400, message: "影片識別碼或顯示筆數無效，筆數須為 1 至 200。" };
    }
    if (/^\/boards(?:\/view)?\/?$/.test(url.pathname) && !parseBoardRequest(url.searchParams))
        return { status: 400, message: "看板篩選條件無效；請確認分類、日期先後與文字長度，且不要重複參數。" };
    return null;
}
