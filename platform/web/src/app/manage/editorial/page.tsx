import PageMethod from '@/components/PageMethod';
import {methodHeading} from '@/components/method/styles';
import EditorialConsole from './console';
export const dynamic='force-dynamic';
export const metadata={title:'事件與頻道審核',robots:{index:false,follow:false}};
export default function Page(){return <><EditorialConsole/><PageMethod><h3 className={methodHeading}>事件與頻道審核</h3><p>先預覽異動，再明確執行。所有異動保留版本與審核紀錄。</p></PageMethod></>;}
