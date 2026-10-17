import type {EventCitation,EventPresentation} from "../../../api/src/contracts";
import type {ReportCell,ReportValue} from "../../../api/src/report-contracts";
import {safeReportHref} from "./report-contract";

/** Laravel's page title: "{event} 到 {date} 的相關報導". */
export function aiEventTitle(event:string,date:string|null){
    if(event&&date)return `${event} 到 ${date} 的相關報導`;
    return event?`${event} 相關報導`:"事件分析";
}
export interface HistoryDay { date: string; dailyId: number|null; href: string|null; events: {title: string; href: string|null}[] }
const cell=(v:ReportValue|ReportCell|undefined):ReportCell=>v!==null&&typeof v==="object"?v:{value:v??null};
/** Laravel's 逐日事件線: the stored cross-day rows grouped by date in response order (newest
 * first), each date linking its daily record through its first event. */
export function historyDays(rows:Record<string,ReportValue|ReportCell>[]):HistoryDay[]{
    const days:HistoryDay[]=[];
    for(const row of rows){
        const date=String(cell(row.date).value??""),event=cell(row.event),title=String(event.value??"").trim(),id=cell(row.dailyId).value;
        if(!date||!title)continue;
        const href=safeReportHref(event.href)??null;
        let day=days.find(d=>d.date===date);
        if(!day)days.push(day={date,dailyId:typeof id==="number"?id:null,href,events:[]});
        if(!day.events.some(e=>e.title===title))day.events.push({title,href});
    }
    return days;
}
/** A cited video: linked only when the API verified it; otherwise its raw ID and why it has no link. */
export function citationVideo(c:EventCitation):{href:string|null;label:string;state:string|null}{
    const href=safeReportHref(c.href??undefined)??null;
    const state=href?null:c.verification==="outside-snapshot"?"不屬於原始快照":c.verification==="invalid"?"影片識別格式無效":null;
    return {href,label:c.rawId,state};
}
export const PEOPLE_LABELS={supporting:"支持者",opposing:"反對者",other:"其他"} as const;
/** Laravel's 人物觀點 order (supporting, opposing, other), skipping empty groups. */
export function peopleGroups(people:EventPresentation["people"]){
    if(!people)return [];
    return (["supporting","opposing","other"] as const).map(kind=>({kind,label:PEOPLE_LABELS[kind],rows:people.groups.filter(g=>g.kind===kind).flatMap(g=>g.rows)})).filter(g=>g.rows.length);
}
