import LoginPanel from './LoginPanel';
export const metadata={title:'登入',robots:{index:false,follow:false}};
export default async function LoginPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){const q=await searchParams;return <section className="mx-auto max-w-xl py-8"><h1 className="text-2xl font-semibold">登入有影儀表板</h1><p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">追蹤頻道、標籤與事件，收藏影片和來源脈絡。</p><LoginPanel next={typeof q.next==='string'?q.next:'/my'} error={typeof q.error==='string'?q.error:undefined}/></section>;}
