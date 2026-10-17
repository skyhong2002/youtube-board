import PageMethod from '@/components/PageMethod';
import {methodHeading} from '@/components/method/styles';
import KeywordReviewAccess from './console';
export const dynamic='force-dynamic';
export const metadata={title:'關鍵字覆核',robots:{index:false,follow:false}};
export default function Page(){
 return <>
  <section className="grid max-w-4xl gap-4"><KeywordReviewAccess/></section>
  <PageMethod><h3 className={methodHeading}>關鍵字覆核</h3><p>記錄有效關鍵字的保留／排除提案與管理員決定。先預覽，再明確執行；目前只寫入覆核紀錄，尚未套用排行或文字比對，原始詞彙池與命中證據不會被改寫。</p></PageMethod>
 </>;
}
