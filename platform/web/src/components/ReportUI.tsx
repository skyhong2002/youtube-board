import SectionTabs from './SectionTabs';
import {currentTab} from '@/lib/report-navigation';
import {ChannelArchiveNotice} from './ChannelArchiveNotice';
import Link from 'next/link';
import type {ReportMeta,Search,Collection} from '@/lib/api';
import {queryString} from '@/lib/api';
import {dateTime,count} from '@/lib/format';
import {reportStyle as ui} from '@/lib/report-styles';
export function Heading({title,description,eyebrow,meta}:{title:string;description?:string;eyebrow?:string;meta?:ReportMeta}){
 return <header className="mb-5 flex flex-wrap items-end justify-between gap-3"><div className="min-w-0 space-y-1">{eyebrow&&<p className="text-xs text-zinc-500">{eyebrow}</p>}<h1 className="text-2xl font-semibold tracking-tight">{title}</h1>{description&&<p className="max-w-4xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{description}</p>}{meta&&<p className="text-sm text-zinc-600 dark:text-zinc-400">更新於 {dateTime(meta.updatedAt)} · 台北時間</p>}</div></header>;
}
export function DataNotice({meta}:{meta:ReportMeta}){
 const warnings=meta.warnings.filter(w=>meta.dataset!=='fixture'||w!=='此環境使用合成範例 YouTube 資料。');
 return <><ChannelArchiveNotice coverage={meta.coverage}/>{meta.dataset==='fixture'&&<aside className="my-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">這是開發驗證資料，僅供確認頁面與計算流程，並非目前的 YouTube 觀測結果。</aside>}{warnings.length>0&&<aside className={ui.note}><p>資料範圍提醒：{warnings.join('；')}</p></aside>}</>;
}
export function Unavailable({status,title}:{status:number;title:string}){
 const pending=status===501,invalid=status===400||status===422,conflict=status===409;
 return <><Heading title={title}/><section className="rounded-lg border border-dashed border-zinc-300 p-8 text-center dark:border-zinc-700" role="status"><h2 className="text-base font-semibold">{invalid?'篩選條件無效':conflict?'來源資料無法唯一對應':pending?'這份報表正在移轉':'資料來源暫時無法讀取'}</h2><p className="mx-auto my-3 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">{invalid?'請檢查日期、頻道與篩選條件後重新查詢。':conflict?'來源名稱對應多筆紀錄，或來源版本已變動。請回到原始來源重新選擇。':pending?'這個新版頁面尚未完成資料與行為驗證；目前不顯示未經驗證的統計。':'目前無法確認觀測結果，請稍後重新讀取。無法讀取不代表影片、頻道或觀看數為零。'}</p><Link className={ui.link} href="/">← 回到總覽</Link></section></>;
}
export function Empty({title='這個範圍尚無資料',description='請調整日期或篩選條件。未收錄不代表來源沒有發布內容。'}:{title?:string;description?:string}){return <section className="my-4 rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"><h2 className="text-base font-medium text-zinc-800 dark:text-zinc-200">{title}</h2><p className="mt-2">{description}</p></section>;}
export function Metric({label,value,unit,detail}:{label:string;value:React.ReactNode;unit?:string;detail?:string}){return <div className="rounded-xl border border-zinc-300 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900"><div className="text-xs text-zinc-600 dark:text-zinc-400">{label}</div><div className={`mt-1 font-semibold tabular-nums leading-tight ${typeof value==='string'&&(value.length>10||/^\d{4}[-/]\d{2}/.test(value))?'text-base':'text-xl'}`}>{value}{unit&&<span className="ml-1 text-sm font-normal text-zinc-500">{unit}</span>}</div>{detail&&<div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{detail}</div>}</div>;}
export function SectionHeading({title,href,label='查看全部 →'}:{title:string;href?:string;label?:string}){return <div className="mb-3 mt-6 flex flex-wrap items-end justify-between gap-3"><h2 className="scroll-mt-20 text-base font-semibold">{title}</h2>{href&&<Link className={'text-sm '+ui.link} href={href}>{label}</Link>}</div>;}
/** Same interaction and classes as mother SectionTabs; preserve URL query state in callers. */
export function Tabs({items,active,label='報表選單'}:{items:{href:string;label:string;active?:boolean}[];active:string;label?:string}){if(!items.length)return null;return <SectionTabs label={label} className="mb-4" tabs={items.map(item=>({href:item.href,label:item.label,current:currentTab(item.href,active,item.active)}))}/>;}
export function Pagination({collection,search,path}:{collection:Pick<Collection<unknown>,'total'|'limit'|'offset'>;search:Search;path:string}){const {total,limit,offset}=collection;if(total<=limit&&offset===0)return null;return <nav className="my-4 flex flex-wrap items-center justify-between gap-3 text-sm" aria-label="頁碼"><p className="text-zinc-600 dark:text-zinc-400">共 {count(total)} 筆{offset<total?` · 第 ${count(offset+1)}–${count(Math.min(offset+limit,total))} 筆`:' · 目前頁面沒有資料'}</p><div className="flex gap-5">{offset>0&&<Link className={ui.link} href={`${path}${queryString({...search,offset:String(Math.max(0,offset-limit))})}`} scroll={false}>← 上一頁</Link>}{offset+limit<total&&<Link className={ui.link} href={`${path}${queryString({...search,offset:String(offset+limit)})}`} scroll={false}>下一頁 →</Link>}</div></nav>;}
