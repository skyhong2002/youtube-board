import PageMethod from '@/components/PageMethod';
import {methodHeading} from '@/components/method/styles';
import KeywordReviewAccess from './console';
export const dynamic='force-dynamic';
export const metadata={title:'關鍵字覆核',robots:{index:false,follow:false}};
export default function Page(){
 return <>
  <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">決定哪些關鍵字不要出現在熱門標籤排行：在這裡恢復被排除的詞，並查看保留／排除的覆核紀錄。</p>
  <section className="grid max-w-4xl gap-4"><KeywordReviewAccess/></section>
  <PageMethod><h3 className={methodHeading}>關鍵字覆核</h3><p>管理員從熱門標籤排行排除的關鍵字可在這裡恢復。下方的覆核紀錄記錄保留／排除提案與決定：排行顯示的已核准決定會套用到熱門標籤排行，文字比對決定只記錄；原始詞彙池與命中證據不會被改寫。</p></PageMethod>
 </>;
}
