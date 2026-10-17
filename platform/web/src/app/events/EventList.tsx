import Link from 'next/link';
import {api,type Search} from '@/lib/api';
import {Heading,DataNotice,Empty,Unavailable} from '@/components/ReportUI';
import {reportStyle as ui} from '@/lib/report-styles';
import {dateTime} from '@/lib/format';
import {ReportMethod} from '@/components/ReportMethod';
import {EventsMethod} from '@/components/MethodNotes';
/** Shared by the query-free ISR entry (/render-isr/events/current) and the dynamic `/events?…` page. */
export default async function EventList({search}:{search:Search}){
 const result=await api<{events:{id:string;title:string;version:number;updated_at:string}[];page:number}>('editorial/events',search);
 if(!result.ok)return <Unavailable status={result.status} title="事件時間軸"/>;
 const {data,meta}=result.response,q=typeof search.q==='string'?search.q:'';
 return <div className="space-y-5"><Heading title="事件時間軸" meta={meta}/><DataNotice meta={meta}/><form className={ui.form}><label className={ui.label}>搜尋事件<input className={ui.input} name="q" maxLength={100} defaultValue={q} placeholder="搜尋事件名稱"/></label><button className={ui.primary}>搜尋</button></form><p className="text-sm text-zinc-600 dark:text-zinc-400">第 {data.page} 頁 · 本頁 {data.events.length} 個事件</p>{data.events.length?<div className="divide-y divide-zinc-200 rounded-xl border border-zinc-300 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">{data.events.map(e=><article className="px-4 py-4 sm:px-5" key={e.id}><h2 className="text-base font-semibold"><Link className="hover:text-brand-700 hover:underline dark:hover:text-brand-400" href={'/events/'+e.id}>{e.title}</Link></h2><p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">第 {e.version} 版 · 更新 {dateTime(e.updated_at)}</p></article>)}</div>:<Empty title="尚未建立符合條件的事件" description="可修改或清除上方的事件搜尋字詞後重新搜尋。這裡只列出經編輯建立的事件；未收錄不代表現實中沒有相關事件。"/>}<nav aria-label="事件分頁" className="flex justify-between text-sm">{data.page>1?<Link className={ui.link} scroll={false} href={'?'+new URLSearchParams({q,page:String(data.page-1)})}>← 上一頁</Link>:<span/>}{data.events.length===25&&data.page<100&&<Link className={ui.link} scroll={false} href={'?'+new URLSearchParams({q,page:String(data.page+1)})}>下一頁 →</Link>}</nav><ReportMethod path="/events" meta={meta}><EventsMethod/></ReportMethod></div>;
}
