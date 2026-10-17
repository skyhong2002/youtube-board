import ReaderGate from '@/app/my/ReaderGate';
import PageMethod from '@/components/PageMethod';
import {methodHeading,methodList,methodTerm} from '@/components/method/styles';
import Channels from './Channels';
export const dynamic='force-dynamic';
export const metadata={title:'頻道管理',robots:{index:false,follow:false}};
export default function Page(){
 return <>
  <ReaderGate next="/admin" admin><Channels/></ReaderGate>
  <PageMethod>
   <h3 className={methodHeading}>頻道管理表</h3>
   <p>列出收錄過的所有頻道，包含已封存、公開頻道列表不再顯示的頻道。預設依 7 天新片由多到少排序；點欄名可改排序，再點一次反向；點表格裡的分類名稱只看該分類，再點一次取消；搜尋、分類與收錄狀態可以一起用，每個選項旁的數字是套用其他條件後剩下的頻道數。</p>
   <dl className={methodList}>
    <dt className={methodTerm}>已封存</dt><dd>頻道已停止收錄（flag_del），歷史影片與報表仍保留。</dd>
    <dt className={methodTerm}>尚未抓到影片</dt><dd>頻道已加入，但影片表裡還沒有任何一支它的影片。</dd>
    <dt className={methodTerm}>統計逾期</dt><dd>超過 3 天沒有更新訂閱數、觀看數等頻道統計，或從未更新。</dd>
    <dt className={methodTerm}>近 30 天無新片</dt><dd>統計正常更新，但最新一支影片的發布時間在 30 天以前。</dd>
    <dt className={methodTerm}>正常</dt><dd>以上皆非。狀態依序判斷，符合前一項就不再往下看。</dd>
    <dt className={methodTerm}>7 天新片</dt><dd>發布時間在過去 7 天內的影片數，以資料讀取當下往回算。</dd>
    <dt className={methodTerm}>統計更新</dt><dd>最近一次抓取頻道統計的時間（台北時間）。</dd>
    <dt className={methodTerm}>頭像</dt><dd>從 YouTube 下載後存在本站，每小時補抓一批，7 天內抓過的不重抓；還沒抓到或已封存的頻道先顯示名稱的第一個字。</dd>
   </dl>
   <p>只有管理員看得到這頁。抓取失敗的退避紀錄與頻道提名不在網站帳號的讀取權限內，所以這裡沒有列出。</p>
  </PageMethod>
 </>;
}
