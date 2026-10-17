import "server-only";
import {api,type Search} from "./api";
import type {ReportData} from "./report-contract";
import {PAGE_SIZE,pageOffsets} from "./ai-hours-board";

/** Reads /ai/hours or /ai/periods the way Laravel listed them, all topics of the range on
 * one page: the first page decides the page's status; later pages are optional, so a
 * failed read only shortens the list and leaves the next-page link to continue from it.
 * Returns the merged data with limit set to the rows actually shown. */
export async function readAiReportPages(apiPath:string,search:Search){
    const explicit=typeof search.limit==="string"&&search.limit!=="";
    const offset=Math.max(0,Number(typeof search.offset==="string"?search.offset:0)||0);
    const first=await api<ReportData>(apiPath,explicit?search:{...search,limit:String(PAGE_SIZE),offset:String(offset)});
    if(!first.ok||explicit||!Array.isArray(first.response.data.rows))return first;
    const data=first.response.data,rest=await Promise.all(pageOffsets(data.total,offset).map(at=>api<ReportData>(apiPath,{...search,limit:String(PAGE_SIZE),offset:String(at)},{optional:true})));
    const rows=[...data.rows],sections=(data.sections??[]).map(s=>({...s,rows:[...s.rows]}));
    for(const page of rest){
        if(!page.ok||!Array.isArray(page.response.data.rows))break;
        rows.push(...page.response.data.rows);
        page.response.data.sections?.forEach((s,i)=>sections[i]?.rows.push(...s.rows));
    }
    return {...first,response:{...first.response,data:{...data,rows,sections,limit:Math.max(rows.length,1),offset}}};
}
