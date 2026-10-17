import "server-only";
import {api,type AiDaysData,type Collection,type ChannelRow} from "./api";
import type {ReportData} from "./report-contract";
import type {ChannelAiEvent} from "./ai-daily-summary";

const text=(value:unknown)=>typeof value==="string"?value:"";
/** Channel ids under a channel tag, read from the existing /tags/:id/channels listing. */
async function tagged(tag:number):Promise<Set<number>>{
    const ids=new Set<number>();
    for(let offset=0;offset<2000;offset+=200){
        const result=await api<Collection<ChannelRow>>(`tags/${tag}/channels`,{limit:"200",offset:String(offset)},{optional:true});
        if(!result.ok)break;
        for(const row of result.response.data.rows)ids.add(row.id);
        if(offset+200>=result.response.data.total)break;
    }
    return ids;
}
/** Everything the Laravel layout needs beyond /ai/days, from existing public endpoints:
 * each cited channel's AI rows for that day (角度／陣營) and the 泛綠 [4] / 泛藍 [3] tag lists.
 * Missing reads leave the matching counts at zero instead of failing the page. */
export async function aiDailySources(data:AiDaysData){
    const ids=[...new Set(data.rows.flatMap(t=>t.evidence.map(e=>e.channelId)))];
    const [green,blue,...channels]=await Promise.all([tagged(4),tagged(3),...ids.map(id=>data.date
        ?api<ReportData>(`channels/${id}/ai/days`,{date:data.date,limit:"200"},{optional:true})
        :Promise.resolve(null))]);
    const events=new Map<number,ChannelAiEvent[]>();
    channels.forEach((result,i)=>{
        if(!result?.ok)return;
        events.set(ids[i]!,result.response.data.rows.filter(row=>row.date===data.date).map(row=>({title:text(row.title),angle:text(row.angle),camp:text(row.camp),videos:typeof row.videos==="number"?row.videos:0})));
    });
    return {green,blue,events};
}
