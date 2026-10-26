import Link from 'next/link';
import {ChannelAvatar} from './ChannelAvatar';
import {ChannelSourceList,cellSources} from './ChannelSource';
import {VideoThumbnail} from './VideoThumbnail';
import {MissingObservation} from './ObservationValue';
import TableScroller from './TableScroller';
import {table as tableStyle} from '@/lib/table-styles';
import {reportStyle as ui} from '@/lib/report-styles';
import {count,dateTime} from '@/lib/format';
import {reportLinkPrefetch,safeReportHref,type ReportCell,type ReportColumn,type ReportValue} from '@/lib/report-contract';
import {numericColumn,reportLeadIndex} from '@/lib/report-table';
import {stackOnPhones,uniformColumns} from '@/lib/report-table-layout';
/** Contract-driven report table. Wide tables scroll sideways with a sticky lead
 * column (see reportLeadIndex); three columns or fewer stay one line per row on
 * phones unless their text is too long for it, then stack (see stackOnPhones).
 * `foldUniform` names columns that hold one value on every row once above the
 * table instead of repeating them (see uniformColumns). */
export function ReportTable({columns:all,rows,label,showMobileScrollHint=false,foldUniform=false}:{columns:ReportColumn[];rows:Record<string,ReportValue|ReportCell>[];label:string;showMobileScrollHint?:boolean;foldUniform?:boolean}){
 const uniform=foldUniform?uniformColumns(all,rows,all.length>3?reportLeadIndex(all,rows):-1):[],folded=new Set(uniform.map(u=>u.column.key));
 const columns=folded.size?all.filter(column=>!folded.has(column.key)):all;
 const wide=columns.length>3,lead=wide?reportLeadIndex(columns,rows):-1,stack=!wide&&stackOnPhones(columns,rows);
 // Unstacked narrow tables cut long text a little earlier on phones so the row fits the screen.
 const phoneClip=!wide&&!stack;
 const table=<TableScroller card label={label+'表格，可左右捲動'} showMobileScrollHint={showMobileScrollHint}><table className={'w-full text-left text-sm '+tableStyle.nowrap+(stack?' '+tableStyle.stack:'')}><thead className="bg-(--table-head-bg) text-xs text-zinc-600 dark:text-zinc-400"><tr>{columns.map((column,i)=><th key={column.key} scope="col" className={i===lead?tableStyle.leadHead:numericColumn(column)?tableStyle.num:tableStyle.cell}>{column.label}{column.unit&&<span>（{column.unit}）</span>}</th>)}</tr></thead><tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">{rows.map((row,index)=><tr className={tableStyle.row} key={index}>{columns.map((column,i)=><td data-label={column.label} key={column.key} className={i===lead?tableStyle.lead:numericColumn(column)?tableStyle.num:tableStyle.cell}>{i===lead?<div className={tableStyle.leadBox}><Cell value={row[column.key]} column={column} lead/></div>:<Cell value={row[column.key]} column={column} phoneClip={phoneClip}/>}</td>)}</tr>)}</tbody></table></TableScroller>;
 if(!uniform.length)return table;
 return <><p className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-600 dark:text-zinc-400"><span>每列相同：</span>{uniform.map(({column,value})=><span key={column.key} className="whitespace-nowrap">{column.label}{column.unit?`（${column.unit}）`:''} <strong className="font-medium tabular-nums text-zinc-800 dark:text-zinc-200">{count(value)}{column.kind==='percent'?'%':''}</strong></span>)}</p>{table}</>;
}
function Cell({value,column,lead=false,phoneClip=false}:{value:ReportValue|ReportCell|undefined;column:ReportColumn;lead?:boolean;phoneClip?:boolean}){
 const cell=value!==null&&typeof value==='object'?value:{value:value??null};
 // Native disclosure remains keyboard-operable without hydrating every row.
 if(column.key==='tags'&&column.label==='頻道分類'&&typeof cell.value==='string'){
  const tags=cell.value.split(' · ').map(tag=>tag.trim()).filter(Boolean);
  if(tags.length>1)return <details className="group/categories w-40 whitespace-normal"><summary className="flex cursor-pointer items-center gap-1 rounded focus-visible:outline-2 focus-visible:outline-offset-2" aria-label={`頻道分類：${tags[0]}，另 ${tags.length-1} 項`}><span className="min-w-0 truncate" title={tags[0]}>{tags[0]}</span><span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400"><span className="group-open/categories:hidden">+{tags.length-1}</span><span className="hidden group-open/categories:inline">收合</span></span></summary><ul className="mt-1 space-y-1 break-words text-xs">{tags.slice(1).map((tag,i)=><li key={i}>{tag}</li>)}</ul></details>;
 }
 const sources=cellSources(cell);
 const href=sources?undefined:safeReportHref(cell.href);
 const text=(cell.value===null||(typeof cell.value==='number'&&!Number.isFinite(cell.value)))
  ?<MissingObservation/>
  :column.kind==='date'||column.kind==='datetime'
   ?dateTime(String(cell.value),column.kind==='date')
   :typeof cell.value==='number'
    ?`${count(cell.value)}${column.kind==='percent'?'%':''}`
    :typeof cell.value==='boolean'
     ?cell.value?'是':'否'
     :cell.value;
 // One line per cell: long text is cut with an ellipsis and keeps the full text as its title.
 const clip=lead?tableStyle.leadText+' inline-block align-top sm:max-w-xs':(column.key==='channel'||cell.media?.kind==='channel'?'inline-block min-w-0 max-w-40 truncate align-top':tableStyle.clip)+(phoneClip?' max-sm:max-w-36':'');
 // Source names share that one clipped line; each keeps its own icon and the list keeps the full title.
 const label=sources?<ChannelSourceList sources={sources} className={clip}/>:typeof text==='string'&&!numericColumn(column)?<span className={clip} title={text}>{text}</span>:text;
 const row='inline-flex min-w-0 max-w-full items-center gap-2 align-top';
 const media=!sources&&cell.media&&<span className={(lead?tableStyle.leadExtra+' ':'')+'shrink-0'}>{cell.media.kind==='channel'?<ChannelAvatar avatar={cell.media.avatar} title={typeof cell.value==='string'?cell.value:undefined} size={20}/>:<VideoThumbnail videoId={cell.media.videoId} width={48} height={27}/>}</span>;
 const content=media?<span className={row}>{media}{label}</span>:label;
 const rendered=href?(href.startsWith('/')
  ?<Link className={ui.link+(media?'':' '+row)} href={href} prefetch={reportLinkPrefetch(href)}>{content}</Link>
  :<a className={ui.link+' '+row} href={href} target="_blank" rel="noopener noreferrer">{content}<span className="shrink-0">↗</span><span className="sr-only">（另開視窗）</span></a>)
  :content;
 if(!cell.detail)return <>{rendered}</>;
 // The detail follows on the same line and is the first thing cut.
 return <span className={row}>{rendered}<small className={(lead?tableStyle.leadExtra+' ':'')+'min-w-0 max-w-xs shrink-3 truncate text-xs'} title={cell.detail}>{cell.detail}</small></span>;
}
