import Link from 'next/link';
import { inlineLink, methodHeading, methodList, methodTerm } from './styles';

// 本站流量 (/observe), over /api/v1/site-observation (api/src/reports/site-observation.ts), which reads the hourly
// GA4 / Search Console pull (jobs/src/site-analytics-cli.ts). As tag.observe.tw components/method/observe.tsx.
export function ObserveMethod() {
  return (
    <>
      <h3 className={methodHeading}>本站流量</h3>
      <p>
        本站每小時從 Google Analytics 4 與 Google Search Console 讀取彙整數字，近幾天的資料每次重抓，晚到的資料會補上；GA4
        處理需要時間，今天的數字通常落後一小時左右。只計 youtube.observe.tw 的公開觀測頁；登入、管理、搜尋結果、帶查詢條件的網址與關鍵字、群組、縣市等自由文字頁面一律不量測，所以不在這裡。阻擋追蹤、停用 JavaScript、送出「不要追蹤」或 GPC 訊號的讀者不會被計入。自動化測試工具不送統計；也可以在
        <Link href="/observe/opt-out" className={inlineLink}>停用網站分析</Link>
        讓這個瀏覽器不計入。
      </p>
      <dl className={methodList}>
        <dt className={methodTerm}>最近 30 分鐘</dt>
        <dd>GA4 即時報表：最近 30 分鐘內有活動的讀者數、瀏覽次數與每分鐘瀏覽，約每 2 分鐘更新，超過 15 分鐘沒更新就不顯示。只有總數，不列出正在看的頁面。</dd>
        <dt className={methodTerm}>瀏覽</dt>
        <dd>GA4 的網頁瀏覽次數，包含同一人重複開啟。</dd>
        <dt className={methodTerm}>造訪</dt>
        <dd>GA4 的工作階段：一次連續使用網站，閒置 30 分鐘後再回來算新的一次。來源依 GA4 預設管道分類，「未指派」是 GA4 無法判斷來源的造訪。</dd>
        <dt className={methodTerm}>讀者關注</dt>
        <dd>
          期間內瀏覽次數最多的內容頁：影片、頻道、頻道分類、AI 議題與事件頁，不含首頁與各列表頁。GA4 只收到固定的網站名稱作為頁面標題，標題由本站依網址查自己的影片、頻道與分類名稱。這是本站讀者的閱讀情況，與 YouTube 上的觀看數不同。
        </dd>
        <dt className={methodTerm}>Google 搜尋</dt>
        <dd>Search Console 的網頁搜尋曝光、點擊與平均排名（依曝光加權），日期依美國太平洋時間，通常延遲 2–3 天，最近幾天的數字仍可能修正。只公開各頁合計，不讀取也不公開搜尋字詞。</dd>
        <dt className={methodTerm}>使用體驗</dt>
        <dd>讀者瀏覽器回報的 LCP（主要內容出現）、INP（操作反應）、CLS（版面位移）評級，依 Google 的 web-vitals 門檻分為良好、需改善、不佳。是樣本數比例，不是 Google 的 Core Web Vitals 通過判定。</dd>
      </dl>
    </>
  );
}
