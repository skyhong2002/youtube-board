import {SITE_NAME} from '@/lib/site';
import ManageTabs from './ManageTabs';
export const dynamic='force-dynamic';
export const metadata={title:{default:'管理後台',template:`%s - ${SITE_NAME}`},robots:{index:false,follow:false}};
export default function ManageLayout({children}:{children:React.ReactNode}){return <section className="py-4"><h1 className="text-2xl font-semibold tracking-tight">管理後台</h1><ManageTabs/><div className="mt-6">{children}</div></section>;}
