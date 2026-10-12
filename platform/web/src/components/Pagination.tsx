import Link from 'next/link';
import type {Search} from '@/lib/api';
import {queryString} from '@/lib/query-string';
import {count} from '@/lib/format';
import {reportStyle as ui} from '@/lib/report-styles';
export interface PaginationCollection {
 total:number|null;limit:number;offset:number;
 hasNext?:boolean;totalStatus?:'exact'|'not-computed'|'unavailable';rows?:unknown[];
}
/** Search pages may omit a full-history count; navigation uses the API's extra row. */
export function Pagination({collection,search,path}:{collection:PaginationCollection;search:Search;path:string}){
 const {total,limit,offset}=collection,unknown=total===null;
 const hasNext=collection.hasNext??(!unknown&&offset+limit<total),withinOffsetBound=offset+limit<=100000;
 if(!unknown&&total<=limit&&offset===0&&!hasNext)return null;
 const shown=collection.rows?.length;
 const range=shown===0?'目前頁面沒有資料':shown!==undefined?`第 ${count(offset+1)}–${count(offset+shown)} 筆`:!unknown&&offset<total?`第 ${count(offset+1)}–${count(Math.min(offset+limit,total))} 筆`:'目前頁面沒有資料';
 return <nav className="my-4 flex flex-wrap items-center justify-between gap-3 text-sm" aria-label="頁碼">
  <div className="space-y-1 text-zinc-600 dark:text-zinc-400">
   <p>{unknown?(collection.totalStatus==='unavailable'?'總數暫時無法取得':'總數未計算'):`共 ${count(total)} 筆`} · {range}</p>
   {unknown&&<p className="text-xs">依目前篩選條件顯示符合的影片，未另外縮短日期範圍。</p>}
  </div>
  <div className="flex gap-5">
   {offset>0&&<Link className={ui.link} href={`${path}${queryString({...search,offset:String(Math.max(0,offset-limit))})}`} scroll={false}>← 上一頁</Link>}
   {hasNext&&withinOffsetBound&&<Link className={ui.link} href={`${path}${queryString({...search,offset:String(offset+limit)})}`} scroll={false}>下一頁 →</Link>}
   {hasNext&&!withinOffsetBound&&<span>已達可瀏覽頁數上限，請縮小篩選範圍。</span>}
  </div>
 </nav>;
}
