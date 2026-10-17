'use client';
import {useState,type ReactNode} from 'react';
import TableScroller from '@/components/TableScroller';
import {table} from '@/lib/table-styles';
type Key=number|string|null;
/** One sortable column; `sort` omitted means the column is shown but not sortable. */
export interface SortColumn<T>{key:string;label:string;num?:boolean;time?:boolean;title?:string;sort?:(row:T)=>Key;first?:'asc'|'desc';cell:(row:T)=>ReactNode}
/** Plain words for the current order: counts go 多到少, times 新到舊, text by character order. */
export function orderLabel(column:{num?:boolean;time?:boolean},dir:'asc'|'desc'){const [down,up]=column.time?['新到舊','舊到新']:column.num?['多到少','少到多']:['反向','依字序'];return dir==='desc'?down:up;}
/** Missing values stay last in either direction; ties keep the server order. */
export function compareKeys(a:Key,b:Key,dir:'asc'|'desc'){if(a===b)return 0;if(a===null)return 1;if(b===null)return -1;const d=typeof a==='number'&&typeof b==='number'?a-b:String(a).localeCompare(String(b),'zh-Hant');return dir==='asc'?d:-d;}
/** Client-sorted admin table on the shared TableScroller; the first column is the sticky lead. */
/** Stays mounted when filters leave no rows, so the chosen sort and page size survive the empty state. */
export default function SortTable<T>({rows,columns,rowKey,label,initial,page,empty='沒有資料。',summary}:{rows:T[];columns:SortColumn<T>[];rowKey:(row:T)=>string|number;label:string;initial:{key:string;dir:'asc'|'desc'};page?:number;empty?:string;summary?:string}){
 const [sort,setSort]=useState(initial),[shown,setShown]=useState(page??Number.POSITIVE_INFINITY);
 const by=columns.find(c=>c.key===sort.key)?.sort,sorted=by?[...rows].sort((a,b)=>compareKeys(by(a),by(b),sort.dir)):rows,visible=sorted.slice(0,shown);
 const more=sorted.length-visible.length,sortedBy=columns.find(c=>c.key===sort.key&&c.sort);
 return <><p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400">{summary?summary+' · ':''}排序：{sortedBy?`${sortedBy.label}（${orderLabel(sortedBy,sort.dir)}）`:'預設'}，點欄名可改排序</p><TableScroller card label={label+'，可左右捲動'} footer={more>0&&page?<div className="border-t border-zinc-200 p-2 text-center dark:border-zinc-800"><button type="button" className="min-h-9 rounded-full px-4 text-sm text-brand-700 hover:bg-zinc-100 dark:text-brand-400 dark:hover:bg-zinc-800" onClick={()=>setShown(n=>n+page)}>再顯示 {Math.min(page,more)} 個（還有 {more} 個）</button></div>:undefined}>
  <table className={table.nowrap}>
   <thead><tr>{columns.map((c,i)=>{const active=c.key===sort.key&&!!c.sort;return <th key={c.key} scope="col" className={(i===0?table.leadHead:c.num?'number':'')+' align-middle'} aria-sort={active?(sort.dir==='asc'?'ascending':'descending'):undefined} title={c.title}>
    {c.sort?<button type="button" className={'relative hover:text-brand-700 dark:hover:text-brand-400 '+(active?'font-semibold text-zinc-900 dark:text-zinc-100':'')} onClick={()=>setSort(s=>s.key===c.key?{key:c.key,dir:s.dir==='asc'?'desc':'asc'}:{key:c.key,dir:c.first??(c.num?'desc':'asc')})}>{c.label}{active&&<span aria-hidden="true" className="absolute left-full top-0 pl-0.5">{sort.dir==='asc'?'↑':'↓'}</span>}</button>:c.label}
   </th>;})}</tr></thead>
   <tbody>{!visible.length&&<tr><td colSpan={columns.length} className="py-6 text-center text-sm text-zinc-500">{empty}</td></tr>}{visible.map(row=><tr key={rowKey(row)} className={table.row}>{columns.map((c,i)=><td key={c.key} className={(i===0?table.lead:c.num?'number':'')+' align-middle'}>{i===0?<div className={`${table.leadBox} flex items-center gap-2`}>{c.cell(row)}</div>:c.cell(row)}</td>)}</tr>)}</tbody>
  </table>
 </TableScroller></>;
}
