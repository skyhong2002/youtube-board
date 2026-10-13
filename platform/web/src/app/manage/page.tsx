import ReaderGate from '@/app/my/ReaderGate';
export const dynamic='force-dynamic';
export const metadata={title:'管理後台',robots:{index:false,follow:false}};
const links=[
 ['/manage/editorial','事件與頻道審核','預覽並執行事件、來源與頻道提名異動。'],
 ['/manage/keywords','關鍵字覆核','記錄關鍵字保留／排除提案與決定；尚未套用排行或文字比對。'],
 ['/manage/users','管理角色','檢視帳號並調整管理員角色。'],
] as const;
export default function Page(){
 return <section className="mx-auto grid max-w-4xl gap-4">
  <h1 className="text-2xl font-semibold">管理後台</h1>
  <ReaderGate next="/manage" admin>
   <nav aria-label="管理功能"><ul className="grid gap-3 sm:grid-cols-3">{links.map(([href,title,text])=><li key={href}>
    <a href={href} className="block h-full rounded-lg border border-zinc-200 bg-white p-4 text-sm hover:border-brand-600 dark:border-zinc-800 dark:bg-zinc-900">
     <span className="block font-semibold text-brand-700 dark:text-brand-300">{title}</span>
     <span className="mt-1 block text-zinc-600 dark:text-zinc-400">{text}</span>
    </a>
   </li>)}</ul></nav>
  </ReaderGate>
 </section>;
}
