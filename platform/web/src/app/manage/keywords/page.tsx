import KeywordReviewAccess from './console';
export const dynamic='force-dynamic';
export const metadata={title:'關鍵字覆核',robots:{index:false,follow:false}};
export default function Page(){
 return <section className="mx-auto grid max-w-4xl gap-4">
  <h1 className="text-2xl font-semibold">關鍵字覆核</h1>
  <p className="text-sm text-zinc-600 dark:text-zinc-400">記錄有效關鍵字的保留／排除提案與管理員決定。先預覽，再明確執行；目前只寫入覆核紀錄，尚未套用排行或文字比對，原始詞彙池與命中證據不會被改寫。</p>
  <KeywordReviewAccess/>
 </section>;
}
