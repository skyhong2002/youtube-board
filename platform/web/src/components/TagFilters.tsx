import type {Search} from '@/lib/api';
import {first} from '@/lib/format';
export function TagFilters({search,path}:{search:Search;path:string}) {
 const rawLimit=first(search.limit)||'50', limit=/^\d+$/.test(rawLimit)&&Number(rawLimit)>=1&&Number(rawLimit)<=200?rawLimit:'50';
 return <form className="filters" action={path} method="get">
  <label>排序<select name="sort" defaultValue={first(search.sort)||'num'}><option value="num">頻道數</option><option value="total">近七日觀看增量</option><option value="ave">頻道平均增量</option><option value="median">頻道增量中位數</option></select></label>
  <label>頻道至少觀看增量<input name="min" type="number" min="0" max="2147483647" defaultValue={first(search.min)||'10'}/></label>
  <label>顯示筆數<select name="limit" defaultValue={limit}>{!['20','50','100','200'].includes(limit)&&<option value={limit}>{limit} 筆</option>}{['20','50','100','200'].map(v=><option key={v} value={v}>{v} 筆</option>)}</select></label>
  <button className="button button-primary" type="submit">套用篩選</button><a className="button" href={path}>清除</a>
 </form>;
}
