/** Placeholder for a report while its data is read: the same outline as a report page (title and
 * update line, section tabs, filter row, then rows: a table on wider screens, cards on phones) in
 * the site's zinc surfaces. No data and no hooks, so it renders on the server and shows at once
 * on in-site navigation. Screen readers hear one status line instead of the empty shapes. */
const bar='rounded-md bg-zinc-200 dark:bg-zinc-800';
const ROWS=[72,58,84,64,76,52,68,60];
export function ReportSkeleton({label='正在讀取報表'}:{label?:string}){
 return <div role="status" aria-live="polite" className="motion-safe:animate-pulse">
  <span className="sr-only">{label}⋯</span>
  <div aria-hidden="true">
   <header className="mb-5 space-y-2">
    <div className={bar+' h-8 w-56 max-w-full'}/>
    <div className={bar+' h-4 w-72 max-w-full'}/>
   </header>
   <div className="mb-4 flex gap-1 overflow-hidden rounded-xl bg-zinc-100 p-1 dark:bg-zinc-900">
    {[64,56,48,48,56,48].map((width,index)=><div key={index} className={'h-9 shrink-0 rounded-lg '+(index===0?'bg-white shadow-sm dark:bg-zinc-800':'bg-zinc-200/60 dark:bg-zinc-800/60')} style={{width:width+16}}/>)}
   </div>
   <div className="my-4 flex flex-wrap items-center gap-3">
    <div className={'h-11 w-64 max-w-full rounded-full bg-zinc-200 dark:bg-zinc-800'}/>
    <div className={'h-11 w-24 rounded-full bg-zinc-200 dark:bg-zinc-800'}/>
    <div className={'h-11 w-24 rounded-full bg-zinc-200 dark:bg-zinc-800'}/>
   </div>
   <div className={bar+' mb-3 h-5 w-48'}/>
   {/* Phones: cards, like the live and channel lists. */}
   <ul className="m-0 list-none space-y-3 p-0 sm:hidden">
    {ROWS.slice(0,3).map((width,index)=><li key={index} className="rounded-xl border border-zinc-300 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
     <div className="aspect-video w-full rounded-lg bg-zinc-200 dark:bg-zinc-800"/>
     <div className={bar+' mt-3 h-5'} style={{width:`${width+16}%`}}/>
     <div className={bar+' mt-2 h-4 w-1/2'}/>
     <div className="mt-3 grid grid-cols-2 gap-3">{[0,1,2,3].map(cell=><div key={cell} className={bar+' h-9'}/>)}</div>
    </li>)}
   </ul>
   {/* Wider screens: table rows under a header line. */}
   <div className="hidden sm:block">
    <div className="flex gap-4 border-b border-zinc-300 py-2 dark:border-zinc-800"><div className={bar+' h-4 w-1/3'}/><div className={bar+' h-4 w-16'}/><div className={bar+' h-4 w-16'}/><div className={bar+' h-4 w-24'}/></div>
    {ROWS.map((width,index)=><div key={index} className="flex items-center gap-4 border-b border-zinc-200 py-3 dark:border-zinc-800">
     <div className={bar+' h-4 w-6'}/>
     <div className={bar+' h-9 w-16 shrink-0'}/>
     <div className="min-w-0 flex-1"><div className={bar+' h-4'} style={{width:`${width}%`}}/></div>
     <div className={bar+' h-4 w-16'}/>
     <div className={bar+' h-4 w-16'}/>
     <div className={bar+' hidden h-4 w-24 lg:block'}/>
    </div>)}
   </div>
  </div>
 </div>;
}
