import { Heading } from '@/components/ReportUI';
import { privateMetadata } from '@/lib/seo';
import OptOutPanel from './OptOutPanel';
export const metadata = privateMetadata('停用網站分析');
export default function OptOutPage() {
  return (
    <section className="mx-auto max-w-2xl py-4">
      <Heading title="停用網站分析" description="有影儀表板以 Google Analytics 了解公開頁面的使用情形，用來改善報表與導覽。你可以在這裡為此瀏覽器停用。" />
      <article className="space-y-3 text-sm leading-7 text-zinc-700 dark:text-zinc-300">
        <p>只在正式網站 youtube.observe.tw 的公開觀測頁面載入；登入、我的有影儀表板、管理、搜尋結果與本頁不載入。瀏覽器送出「不要追蹤」（Do Not Track）或全球隱私控制（GPC）訊號時，也不會載入。</p>
        <p>本站自訂事件只記錄連結網域、頁面類型、頻道編號或 YouTube 影片編號，不記錄搜尋字詞、帳號或 Email。Google Analytics 預設仍會收集頁面網址與標題等瀏覽資訊。</p>
      </article>
      <OptOutPanel />
    </section>
  );
}
