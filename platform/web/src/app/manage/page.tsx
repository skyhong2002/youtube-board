import {redirect} from 'next/navigation';
export const dynamic='force-dynamic';
export const metadata={title:'管理後台',robots:{index:false,follow:false}};
export default function Page(){redirect('/manage/editorial');}
