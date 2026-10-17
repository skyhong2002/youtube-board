import type {Search} from "./api";

/** One media block of Laravel's 媒體事件來源 as the preview API returns it (media ordered by cited videos). */
export interface PromptEvent { event:string; description:string; videoCount:number; keywords:string[] }
export interface PromptMedia { channelId:number; title:string; sourcePk:string; videoCount:number; events:PromptEvent[] }
/** A media whose source row was read but left out of the prompt (Laravel media_without_events). */
export interface OmittedMedia { channelId:number; title:string|null; sourcePk:string; reason:string }

const scalar=(value:string|string[]|undefined)=>Array.isArray(value)?value[0]:value;

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

const carried=(search:Search)=>{const query=new URLSearchParams();for(const key of ["type","limit"]){const value=scalar(search[key]);if(value)query.set(key,value);}return query;};
/** Switcher target on the TS URLs; date/condition move into the path, the planner's type and limit carry over. */
export function promptHref(date:string,condition:string,search:Search={}):string{
    const query=carried(search);
    return `/ai/days/${date}${condition==="all"?"":"/"+encodeURIComponent(condition)}/prompt${query.size?"?"+query:""}`;
}
/** Custom from/to period target; a period has no dated route, so the condition stays a query value. */
export function promptPeriodHref(from:string,to:string,condition:string,search:Search={}):string{
    const query=new URLSearchParams({from,to});if(condition!=="all")query.set("condition",condition);
    for(const [key,value] of carried(search))query.set(key,value);
    return `/ai/days/prompt?${query}`;
}
/** Taipei calendar days of the preview period; a custom period is more than one day. */
export function promptPeriod(period:{from:string;to:string}|undefined):{from:string;to:string;custom:boolean}|null{
    const from=taipeiDay(period?.from),to=taipeiDay(period?.to);
    return from&&to?{from,to,custom:from!==to}:null;
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
const OMITTED:Record<string,string>={
    no_qualifying_events:"這個媒體沒有符合 legacy prompt 條件的事件。",
    duplicate_title:"這個媒體名稱與其他媒體重複，未納入提示詞。",
    missing_title:"這個媒體沒有名稱，未納入提示詞。",
    invalid_result:"這個媒體的 AI 摘要無法解析，未納入提示詞。",
};
export const omittedReason=(reason:string)=>OMITTED[reason]??`未納入提示詞（${reason}）。`;
