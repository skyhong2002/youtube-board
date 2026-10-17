import type {ReactNode} from 'react';
import Link from 'next/link';
import type {HomeExploration,ReportMeta} from '../../../api/src/contracts';
import {count,dateTime} from '@/lib/format';
import {table} from '@/lib/table-styles';
import {reportStyle as ui} from '@/lib/report-styles';
import {KEYWORD_WINDOWS,homeKeywordState,homeKeywordSummary,keywordRangeLabel,keywordUpdatedLabel,keywordVideosHref,type KeywordWindow} from '@/lib/home-presentation';
import {INSUFFICIENT,heatLabel,keywordCoverageLabel,keywordMethodNotes,rankingBasis,riseLabel,trendLabel,trendValues,viewsCell,type RankingRow} from '@/lib/keyword-ranking';
import {KeywordWindowPane,KeywordWindowProvider,KeywordWindowSwitch} from '@/app/_home/KeywordWindow';
import TableScroller from './TableScroller';
import Sparkline from './Sparkline';
import {VideoThumbnail} from './VideoThumbnail';
import {ChannelAvatar} from './ChannelAvatar';
import MethodLink from './MethodLink';
import PageMethod from './PageMethod';
import {PageNotes,SourceMethod} from './MethodNotes';
import {metaNotes} from './ReportMethod';
import LinkPending from './LinkPending';

const REGION='keyword-ranking-table';
const riseTone={up:'font-medium text-brand-700 dark:text-brand-400',down:'text-zinc-600 dark:text-zinc-400',flat:'text-zinc-500',missing:'text-xs text-zinc-400'} as const;
type View={window:KeywordWindow;label:string}&ReturnType<typeof view>;
function view(exploration:Partial<HomeExploration>,window:KeywordWindow){
 const summary=homeKeywordSummary(exploration,window),state=homeKeywordState(summary,window);
 return {summary,...state,basis:rankingBasis(summary,state.rows)};
}
export const keywordRankingViews=(exploration:Partial<HomeExploration>):View[]=>KEYWORD_WINDOWS.map(({value,label})=>({window:value,label,...view(exploration,value)}));

/** /keywords: the homepage's effective-keyword ranking at full length, laid out as
 * tag.observe.tw /ranking (sticky keyword column, complete mobile labels, sideways scroll). */
export function KeywordRankingView({exploration,meta,notice,tabs,initial='week'}:{exploration:Partial<HomeExploration>;meta:ReportMeta;notice?:ReactNode;tabs?:ReactNode;initial?:KeywordWindow}){
 const views=keywordRankingViews(exploration);
 return <div className="space-y-5">
  <header className="flex flex-wrap items-end justify-between gap-3">
   <div className="min-w-0 space-y-1">
    <h1 className="text-2xl font-semibold tracking-tight">熱門標籤排行</h1>
    <p className="text-sm text-zinc-600 dark:text-zinc-400">更新於 {dateTime(meta.updatedAt)} · 台北時間 · <MethodLink/></p>
   </div>
  </header>
  {notice}
  {tabs}
  <KeywordWindowProvider initial={initial}>
   <KeywordWindowSwitch name="keyword-ranking-window" className="" controls={REGION} legend="排行期間"/>
   <div id={REGION}>{views.map(v=><KeywordWindowPane key={v.window} window={v.window} region className="space-y-3"><RankingPane view={v} priority={v.window===initial}/></KeywordWindowPane>)}</div>
   <p className="text-sm"><Link className={ui.link} href="/vocabulary">原始詞彙池（含不列入排行的詞與原因）→</Link></p>
   <PageMethod>
    <p>YouTube 影片標題與說明中出現的新聞標籤，依頻道加權熱度排序。</p>
    {views.map(v=><KeywordWindowPane key={v.window} window={v.window}><PageNotes title={`${v.label}熱門標籤`} notes={keywordMethodNotes(v.summary,v.basis)}/></KeywordWindowPane>)}
    <PageNotes notes={metaNotes(meta)}/>
    <SourceMethod/>
   </PageMethod>
  </KeywordWindowProvider>
 </div>;
}
function RankingPane({view:v,priority}:{view:View;priority:boolean}){
 const s=v.summary;
 return <>
  {s&&<p role="status" className="text-sm text-zinc-600 dark:text-zinc-400">{keywordRangeLabel(s,v.window)} · {keywordCoverageLabel(s)} · {keywordUpdatedLabel(s)}{v.rows.length>0&&` · 列出 ${count(v.rows.length)} 個標籤`}</p>}
  {s&&v.rows.length?<KeywordRankingTable rows={v.rows} summary={s} window={v.window} basis={v.basis} priority={priority}/>:<p role="status" className="rounded-xl border border-zinc-300 bg-zinc-50 p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400" data-keyword-state={v.kind}>{v.message??`${v.label}範圍與比對狀態未知。`}</p>}
 </>;
}
export function KeywordRankingTable({rows,summary,window,basis,priority=false}:{rows:RankingRow[];summary:NonNullable<View['summary']>;window:KeywordWindow;basis:View['basis'];priority?:boolean}){
 const heat=basis==='heat';
 return <TableScroller card label={`${window==='today'?'過去24小時':'近七日'}熱門標籤排行表格，可左右捲動`}>
  <table className={'w-full min-w-[64rem] text-left text-sm '+table.nowrap}>
   <thead className="bg-(--table-head-bg) text-xs text-zinc-600 dark:text-zinc-400">
    <tr>
     <th className={`hidden w-10 text-right sm:table-cell ${table.cell}`}>#</th>
     <th className={table.leadHead}>標籤</th>
     <th className={table.num}>熱度</th>
     <th className={table.num}>升溫</th>
     <th className={table.cell}>走勢</th>
     <th className={table.num}>影片</th>
     <th className={table.num} title="標題命中／僅說明命中的影片數">標題／說明</th>
     <th className={table.num}>頻道</th>
     <th className={table.num}>已測觀看</th>
     <th className={table.cell}>代表頻道</th>
    </tr>
   </thead>
   <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">{rows.map((row,index)=>{
    const rise=heat?riseLabel(row,summary):{text:INSUFFICIENT,tone:'missing' as const},values=heat?trendValues(row.trend):[],views=viewsCell(row),aliases=Array.isArray(row.sourceTerms)?row.sourceTerms:[],channel=row.channel??null;
    return <tr className={table.row} key={row.key}>
     <td className={`hidden text-zinc-500 sm:table-cell ${table.num}`}>{index+1}</td>
     <td className={table.lead}>
      <div className="flex items-center gap-2 whitespace-nowrap">
       <div className={`${table.leadBox} flex items-center gap-2`}>
        <span className="w-5 shrink-0 text-right text-xs tabular-nums text-zinc-500 sm:hidden">{index+1}</span>
        {row.representativeVideoId
         ?<Link href={`/videos/${encodeURIComponent(row.representativeVideoId)}`} tabIndex={-1} aria-hidden="true" className={`${table.leadWide} shrink-0`}><VideoThumbnail videoId={row.representativeVideoId} width={48} height={27} priority={priority&&index===0}/></Link>
         :<span className={`${table.leadWide} shrink-0`}><VideoThumbnail videoId={null} width={48} height={27}/></span>}
        {/* Mobile labels wrap in full; the fixed-size pending hint stays visible inside the link. */}
        <Link href={keywordVideosHref(row.term,summary)} className="inline-flex min-w-0 max-w-full items-center gap-1 font-medium text-brand-700 hover:underline dark:text-brand-400" title={row.term}><span className="min-w-0 max-w-full whitespace-normal [overflow-wrap:anywhere] sm:truncate sm:whitespace-nowrap">{row.term}</span><LinkPending/></Link>
       </div>
       {aliases.length>1&&<span className={`${table.leadExtra} text-xs text-zinc-500`} title={`合併寫法：${aliases.map(a=>a.term).join('、')}`}>{aliases.length} 種寫法</span>}
      </div>
     </td>
     <td className={`${table.num} ${heat?'font-medium':'text-xs text-zinc-400'}`}>{heat?heatLabel(row):INSUFFICIENT}</td>
     <td className={`${table.num} ${riseTone[rise.tone]}`}>{rise.text}</td>
     <td className="px-2 py-1 sm:px-3">{values.some(v=>v!==null)?<span role="img" aria-label={trendLabel(row.trend)} title={trendLabel(row.trend)} className="inline-block align-middle text-brand-700 dark:text-brand-400"><Sparkline values={values}/></span>:<span className="text-xs text-zinc-400">{INSUFFICIENT}</span>}</td>
     <td className={table.num}>{count(row.videoCount)}</td>
     <td className={`${table.num} text-zinc-600 dark:text-zinc-400`}>{count(row.titleVideos)}／{count(row.descriptionOnlyVideos)}</td>
     <td className={table.num}>{count(row.channelCount)}</td>
     <td className={table.num} title={views.title}>{views.value}{views.detail&&<small className="ml-1 text-zinc-500">（{views.detail}）</small>}</td>
     <td className={table.cell}>{channel?<Link href={`/channels/${encodeURIComponent(channel.id)}`} className="inline-flex max-w-[12rem] items-center gap-1.5 hover:underline" title={channel.name||channel.title}><ChannelAvatar avatar={channel.avatar??null} title={channel.name||channel.title} size={18}/><span className="truncate">{channel.name||channel.title||'頻道名稱尚未取得'}</span></Link>:<span className="text-xs text-zinc-400">—</span>}</td>
    </tr>;
   })}</tbody>
  </table>
 </TableScroller>;
}
