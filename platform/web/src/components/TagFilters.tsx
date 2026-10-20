import type {Search} from '@/lib/api';
import {first} from '@/lib/format';
import {reportStyle as ui} from '@/lib/report-styles';
/** Same form styles as ReportFilters, so every list page's controls look and size alike. */
export function TagFilters({search,path}:{search:Search;path:string}) {
 const rawLimit=first(search.limit)||'50', limit=/^\d+$/.test(rawLimit)&&Number(rawLimit)>=1&&Number(rawLimit)<=200?rawLimit:'50';
 return <form className={ui.form} action={path} method="get">
  <label className={ui.label}>排序<select className={ui.input} name="sort" defaultValue={first(search.sort)||'num'}><option value="num">頻道數</option><option value="total">近七日觀看增量</option><option value="ave">頻道平均增量</option><option value="median">頻道增量中位數</option></select></label>
  <label className={ui.label}>只計近七日觀看增量至少<span className="flex items-center gap-1.5"><input className={`${ui.input} w-28`} name="min" type="number" min="0" max="2147483647" defaultValue={first(search.min)||'10'}/><span className="font-normal">次的頻道</span></span></label>
  <label className={ui.label}>顯示筆數<select className={ui.input} name="limit" defaultValue={limit}>{!['20','50','100','200'].includes(limit)&&<option value={limit}>{limit} 筆</option>}{['20','50','100','200'].map(v=><option key={v} value={v}>{v} 筆</option>)}</select></label>
  <button className={ui.primary} type="submit">套用篩選</button><a className={ui.button} href={path}>清除</a>
 </form>;
}
