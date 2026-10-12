import MyTabs from './MyTabs';
export const dynamic='force-dynamic';
export const metadata={title:'我的有影儀表板',robots:{index:false,follow:false}};
export default function MyLayout({children}:{children:React.ReactNode}){return <section className="py-4"><h1 className="text-2xl font-semibold tracking-tight">我的有影儀表板</h1><MyTabs/><div className="mt-6">{children}</div></section>;}
