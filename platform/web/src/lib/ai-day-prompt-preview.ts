import type {Search} from "./api";

/** One media block of Laravel's 媒體事件來源, rebuilt from the source JSON the planner embeds as the prompt's last line. */
export interface PromptEvent { event:string; description:string; videoCount:number; keywords:string[] }
export interface PromptMedia { pk:string; channelId:number; title:string; videoCount:number; events:PromptEvent[] }

const text=(value:unknown)=>typeof value==="string"?value.trim():"";
const strings=(value:unknown)=>Array.isArray(value)?value.map(text).filter(Boolean):text(value)?[text(value)]:[];
const scalar=(value:string|string[]|undefined)=>Array.isArray(value)?value[0]:value;

/** The planner serialises its sources with JSON.stringify on the final line, so newlines inside descriptions stay escaped.
 * Media are ordered by their total event videos, as Laravel did; ties keep the planner's newest-first order. */
export function promptSources(prompt:string):PromptMedia[]|null{
    let payload:unknown;
    try{payload=JSON.parse(prompt.slice(prompt.lastIndexOf("\n")+1));}catch{return null;}
    if(!Array.isArray(payload))return null;
    const media=payload.flatMap((row):PromptMedia[]=>{
        if(!row||typeof row!=="object")return [];
        const r=row as Record<string,unknown>,title=text(r.title),channelId=Number(r.u_id);
        if(!title||!Number.isInteger(channelId))return [];
        const events=(Array.isArray(r.events)?r.events:[]).flatMap((e):PromptEvent[]=>{
            if(!e||typeof e!=="object")return [];
            const item=e as Record<string,unknown>,event=text(item["事件"]);
            return event?[{event,description:text(item["描述"]),videoCount:strings(item.videoId).length,keywords:strings(item["關鍵字"])}]:[];
        });
        return [{pk:text(String(r.pk??"")),channelId,title,events,videoCount:events.reduce((n,e)=>n+e.videoCount,0)}];
    });
    return media.map((m,i)=>[m,i] as const).sort((a,b)=>b[0].videoCount-a[0].videoCount||a[1]-b[1]).map(([m])=>m);
}

/** Calendar day in Taipei for the API's UTC period start. */
export function taipeiDay(iso:string|null|undefined):string|null{
    const date=iso?new Date(iso):null;
    return date&&Number.isFinite(date.getTime())?new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei"}).format(date):null;
}
export function shiftDay(date:string,days:number){const d=new Date(date+"T00:00:00Z");d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}

/** Condition from /ai/days/{date}/{condition}/prompt, else ?condition=, else all. */
export function promptCondition(path:string,search:Search):string{
    const routed=path.match(/^\/ai\/days\/\d{4}-\d{2}-\d{2}\/([^/]+)\/prompt\/?$/)?.[1];
    if(routed){try{return decodeURIComponent(routed);}catch{return routed;}}
    return scalar(search.condition)?.trim()||"all";
}

/** Switcher target on the TS URLs; date/condition move into the path, the planner's type and limit carry over. */
export function promptHref(date:string,condition:string,search:Search={}):string{
    const query=new URLSearchParams();
    for(const key of ["type","limit"]){const value=scalar(search[key]);if(value)query.set(key,value);}
    return `/ai/days/${date}${condition==="all"?"":"/"+encodeURIComponent(condition)}/prompt${query.size?"?"+query:""}`;
}

/** Laravel's filter chips (name=value), limited to what the new planner accepts. */
export function promptFilters(condition:string,search:Search,limit:number):[string,string][]{
    return [["condition",condition],["type",scalar(search.type)||"oneday"],["limit",String(limit)]];
}

const BLOCKED:Record<string,string>={
    daily_source_cap_exceeded:"來源媒體超過上限",
    no_source_events:"沒有符合條件的媒體事件",
    insufficient_source_for_contract:"來源事件不足以組成跨媒體事件",
    prompt_byte_budget_exceeded:"提示詞超過長度上限",
};
export const blockedReason=(code:string)=>BLOCKED[code]?`${BLOCKED[code]}（${code}）`:code;
