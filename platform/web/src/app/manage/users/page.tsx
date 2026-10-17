import ReaderGate from '@/app/my/ReaderGate';
import PageMethod from '@/components/PageMethod';
import {methodHeading,methodList,methodTerm} from '@/components/method/styles';
import Users from './Users';
export const dynamic='force-dynamic';
export const metadata={title:'帳號',robots:{index:false,follow:false}};
export default function Page(){
 return <>
  <ReaderGate next="/manage/users" admin><Users/></ReaderGate>
  <PageMethod>
   <h3 className={methodHeading}>帳號活動表</h3>
   <p>列出最近登入的 500 個帳號。點欄名可排序，預設依最近活動由新到舊。管理員可以審核事件、覆核關鍵字和調整讀者角色；自己的角色和伺服器設定的管理員（管理員＊）不能在這裡改。</p>
   <dl className={methodList}>
    <dt className={methodTerm}>互動</dt><dd>追蹤、收藏、有效的 API 金鑰數，加上有沒有開 RSS 訂閱（有算 1）。看板存在讀者自己的瀏覽器，不會算進來。</dd>
    <dt className={methodTerm}>貢獻</dt><dd>事件編輯（建立、改名、加入來源、合併、拆分）、頻道提名、頻道審核（核准、拒絕、納入）和角色調整的次數，依審核紀錄上的操作帳號計算。用服務權杖做的操作不屬於任何帳號。</dd>
    <dt className={methodTerm}>最近活動</dt><dd>上面任一項操作或登入的最新時間。追蹤、收藏取最新一筆的時間，取消追蹤或收藏後就不再留下時間。</dd>
    <dt className={methodTerm}>登入裝置</dt><dd>目前還沒過期的登入工作階段數。</dd>
   </dl>
   <p>關鍵字覆核的紀錄不在網站帳號的讀取權限內，暫時沒有算進貢獻。</p>
  </PageMethod>
 </>;
}
