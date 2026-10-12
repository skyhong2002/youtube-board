import {EventHeader} from '@/components/EventHeader';
import FollowButton from '@/components/reader/FollowButton';
import {VideoThumbnail} from '@/components/VideoThumbnail';
import {ChannelSourceLabel,hasSource} from '@/components/ChannelSource';
import type {ChannelSource} from '../../../../../shared/media-assets';
import SaveButton from '@/components/reader/SaveButton';
import Link from 'next/link';
import {notFound,redirect} from 'next/navigation';
import {api,enablePublicRevalidation} from '@/lib/api';
import {uuid} from '../../../../../shared/editorial/contracts';
import {DataNotice,SectionHeading,Empty,Unavailable} from '@/components/ReportUI';
import TableScroller from '@/components/TableScroller';
import {table} from '@/lib/table-styles';
import {reportStyle as ui} from '@/lib/report-styles';
import {count} from '@/lib/format';
import {renameHistory} from '@/lib/editorial-history';
import {safeReportHref} from '@/lib/report-contract';
import {PublicDataError} from '@/lib/public-data';
import {breadcrumbJsonLd,eventBreadcrumbs,eventMetadata} from '@/lib/seo';
import JsonLd from '@/components/JsonLd';
// Params-only public ISR (proxy marks bare /events/{uuid} as `event`). Follow/Save state
// is fetched client-side; a query string never changes this page.
export const revalidate=60;
export const dynamicParams=true;
export async function generateStaticParams(){return [];}
// The same read as the page (shared ISR cache entry); a 404 there is a 404 here.
export async function generateMetadata({params}:{params:Promise<{id:string}>}){
 const {id}=await params;if(!uuid(id))notFound();
 enablePublicRevalidation();
 try{const result=await api<Data>('editorial/events/'+encodeURIComponent(id));if(result.ok){const {data}=result.response;return eventMetadata({canonicalId:data.canonicalId,title:data.event.title,sourceCount:data.sources.length});}}
 catch(error){if(!(error instanceof PublicDataError))throw error;}
 return {title:'事件來源與時間軸'};
}
/** `sourceChannel` exists only for video sources whose captured channel matches; article publishers stay text. */
type Source={id:string;kind:string;source_id:string;headline:string;url:string|null;thumbnail?:string|null;sourceChannel?:ChannelSource|null;published_at:string|null;observed_at:string;source_sha256:string;provenance:{source:string;sourceVersion?:string;publisher?:string;headlineEvidence:string;tags?:string[]}};
type Data={canonicalId:string;event:{title:string;version:number};sources:Source[];history:{action:string;at:string;before:{id:string;title:string}[];after:{id:string;title:string}[]}[]};
const labels:Record<string,string>={video:'YouTube 影片',daily:'每日分析',event:'事件分析',story:'推播故事',article:'新聞報導',create:'建立',rename:'重新命名',attach:'加入來源',refresh:'更新來源快照',merge:'合併',split:'拆分'};
const time=(value:string|null)=>value?new Date(value).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'}):'時間未提供';
export default async function EventPage({params}:{params:Promise<{id:string}>}){
 enablePublicRevalidation();
 // The API answers 400 for non-UUID ids; settle that here so ISR renders 404, not 500.
 const {id}=await params;if(!uuid(id))notFound();
 const result=await api<Data>('editorial/events/'+encodeURIComponent(id));if(!result.ok){if(result.status===404||result.status===400)notFound();return <Unavailable status={result.status} title="事件來源"/>;}
 const {data,meta}=result.response;if(data.canonicalId!==id)redirect('/events/'+data.canonicalId);
 const kinds=new Map<string,number>();for(const s of data.sources)kinds.set(s.kind,(kinds.get(s.kind)??0)+1);
 const cover=data.sources.find(s=>s.kind==='video'&&/^[A-Za-z0-9_-]{11}$/.test(s.source_id));
 return <div className="space-y-8"><JsonLd data={breadcrumbJsonLd(eventBreadcrumbs({canonicalId:data.canonicalId,title:data.event.title,sourceCount:data.sources.length}))}/><EventHeader title={data.event.title} breadcrumb={<><Link className="hover:underline" href="/events">事件時間軸</Link> / 第 {data.event.version} 版</>} description="關聯由編輯審核，同名來源不會自動合併；新聞與 YouTube 指標分別計算。" updatedAt={meta.updatedAt}
 cover={cover?{videoId:cover.source_id,title:cover.headline,channel:cover.sourceChannel}:null}
 actions={<><FollowButton kind="event" target={id}/><SaveButton kind="event" target={id}/></>}
 tags={[...new Set(data.sources.flatMap(s=>s.provenance.tags??[]))].slice(0,12)}
 stats={[{label:'已關聯來源',value:count(data.sources.length)},...[...kinds].map(([kind,total])=>({label:labels[kind]??kind,value:count(total)}))]}
 jumps={[["headlines","標題對照"],["timeline","來源時間軸"],["history","編輯異動"]]}/><DataNotice meta={meta}/>

 <section id="headlines" className="scroll-mt-20"><SectionHeading title="跨來源標題比較"/>{data.sources.length?<TableScroller card label="跨來源標題比較，可左右捲動"><table className={'w-full text-left text-sm '+table.nowrap}><thead className="bg-(--table-head-bg) text-xs text-zinc-600 dark:text-zinc-400"><tr><th className={table.leadHead}>來源</th><th className={table.cell}>原始標題</th><th className={table.cell}>發布時間</th><th className={table.cell}>引用依據</th></tr></thead><tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">{data.sources.map(s=>{const href=safeReportHref(s.url??undefined);return <tr className={table.row} key={s.id}><td className={table.lead}><div className={table.leadBox+' flex items-center gap-1.5'}><span className={table.leadText}>{labels[s.kind]??s.kind}</span>{s.kind==='video'&&hasSource(s.sourceChannel)?<small className={`${table.leadExtra} ${table.leadText} shrink-3 text-xs text-zinc-500 sm:max-w-48`}><ChannelSourceLabel source={s.sourceChannel}/></small>:s.provenance.publisher&&<small className={`${table.leadExtra} ${table.leadText} shrink-3 text-xs text-zinc-500 sm:max-w-48`} title={s.provenance.publisher}>{s.provenance.publisher}</small>}</div></td><td className={table.cell}><div className="flex items-center gap-2">{s.kind==='video'&&<VideoThumbnail videoId={s.source_id} width={48} height={27}/>}{href?<a className={ui.link+' '+table.clip} href={href} rel="noopener noreferrer" title={s.headline}>{s.headline}</a>:<span className={table.clip} title={s.headline}>{s.headline}</span>}{s.kind==='video'&&/^[A-Za-z0-9_-]{11}$/.test(s.source_id)&&<Link className={ui.link+' shrink-0 text-xs'} href={'/videos/'+encodeURIComponent(s.source_id)}>本機影片觀測 →</Link>}</div></td><td className={table.cell+' text-xs'}>{time(s.published_at)}</td><td className={table.cell+' text-xs text-zinc-600 dark:text-zinc-400'}><div className="flex items-center gap-2"><span className="shrink-0">{s.provenance.headlineEvidence==='operator-transcribed'?'編輯轉錄；文章編號已核對共享來源快照':s.provenance.headlineEvidence==='captured-source-title'?'擷取的影片標題':'AI 分析標題，需回到原始來源'}</span>{s.provenance.sourceVersion&&<span className={table.clip} title={s.provenance.sourceVersion}>來源版本 {s.provenance.sourceVersion}</span>}</div></td></tr>;})}</tbody></table></TableScroller>:<Empty title="目前沒有已關聯來源" description="編輯異動歷史仍保留於下方。"/>}</section>
 <section id="timeline" className="scroll-mt-20"><SectionHeading title="來源時間軸"/><ol className="space-y-4 border-l border-zinc-300 pl-5 dark:border-zinc-700">{data.sources.map(s=><li key={s.id} className="relative"><span className="absolute -left-[1.55rem] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-brand-600 dark:border-zinc-950"/><time dateTime={s.published_at??undefined} className="text-xs tabular-nums text-zinc-500">{time(s.published_at)}</time><p className="mt-1 text-sm font-medium">{s.headline}</p><p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{labels[s.kind]??s.kind} · 來源編號 {s.source_id} · 觀測 {time(s.observed_at)}</p>{s.provenance.tags?.length?<p className="mt-2 flex flex-wrap gap-1">{s.provenance.tags.map(tag=><Link className={ui.tag} key={tag} href={'/keywords/'+encodeURIComponent(tag)+'/videos'}>{tag}</Link>)}</p>:null}</li>)}</ol></section>
 <section id="history" className="scroll-mt-20"><SectionHeading title="編輯異動紀錄"/><p className="mb-3 text-xs text-zinc-600 dark:text-zinc-400">最近 100 次異動，包含合併前事件的紀錄。</p><ol className="divide-y divide-zinc-200 rounded-xl border border-zinc-300 bg-white text-sm dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">{data.history.map((h,i)=><li className="px-4 py-3" key={i}><time dateTime={h.at} className="mr-2 text-xs tabular-nums text-zinc-500">{time(h.at)}</time>{labels[h.action]??h.action}{h.action==='rename'&&<Rename history={h} canonicalId={id}/>}</li>)}</ol></section></div>;
}

function Rename({history,canonicalId}:{history:Data["history"][number];canonicalId:string}){const change=renameHistory(history,canonicalId);return change?<> · {change.before} → {change.after}{change.merged&&<small>（合併前事件 {change.sourceId}）</small>}</>:null;}
