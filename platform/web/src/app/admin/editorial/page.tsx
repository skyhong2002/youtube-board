import PageMethod from '@/components/PageMethod';
import {methodHeading} from '@/components/method/styles';
import EditorialConsole from './console';
export const dynamic='force-dynamic';
export const metadata={title:'事件與頻道審核',robots:{index:false,follow:false}};
export default function Page(){return <><p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">把影片、每日分析等來源整理成一個「事件」（建立、改名、加入來源、合併、拆分），以及審核讀者提名的新頻道。選好審核動作、填內容，先預覽再執行。</p><EditorialConsole/><PageMethod><h3 className={methodHeading}>事件與頻道審核</h3><p>先預覽異動，再明確執行。所有異動保留版本與審核紀錄。</p></PageMethod></>;}
