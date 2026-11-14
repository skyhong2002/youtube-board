/** Placeholder for a page while its data is read, shaped like the page being opened: the home
 * page's word-cloud masthead and three columns, a ranking table, the live list, a channel profile
 * or the daily topic cards. No data and no hooks, so it renders on the server and shows at once
 * on in-site navigation. Screen readers hear one status line instead of the empty shapes. */
const bar='rounded-md bg-zinc-200 dark:bg-zinc-800';
const ROWS=[72,58,84,64,76,52,68,60];
export type SkeletonKind='home'|'table'|'live'|'channel'|'topics';
/** Which outline fits a path; anything unknown gets the ranking-table outline most reports use. */
export function skeletonKind(pathname:string):SkeletonKind{
 if(pathname==='/')return 'home';
 if(/^\/live\/current(?:\/|$)/.test(pathname))return 'live';
 if(/^\/channels\/\d+\/?$/.test(pathname))return 'channel';
 if(/^\/ai\/days(?:\/\d{4}-\d{2}-\d{2})?(?:\/[a-z]+)?\/?$/.test(pathname))return 'topics';
 return 'table';
}
const LABELS:Record<SkeletonKind,string>={home:'正在讀取總覽',table:'正在讀取報表',live:'正在讀取直播觀測',channel:'正在讀取頻道',topics:'正在讀取每日議題'};
function SkeletonHeading(){return <header className="mb-5 space-y-2"><div className={bar+' h-8 w-56 max-w-full'}/><div className={bar+' h-4 w-72 max-w-full'}/></header>;}
function TabRow({widths=[64,56,48,48,56,48]}:{widths?:number[]}){
 return <div className="mb-4 flex gap-1 overflow-hidden rounded-xl bg-zinc-100 p-1 dark:bg-zinc-900">{widths.map((width,index)=><div key={index} className={'h-9 shrink-0 rounded-lg '+(index===0?'bg-white shadow-sm dark:bg-zinc-800':'bg-zinc-200/60 dark:bg-zinc-800/60')} style={{width:width+16}}/>)}</div>;
}
function TableRows({count=ROWS.length,thumb=true}:{count?:number;thumb?:boolean}){
 return <div>
  <div className="flex gap-4 border-b border-zinc-300 py-2 dark:border-zinc-800"><div className={bar+' h-4 w-1/3'}/><div className={bar+' h-4 w-16'}/><div className={bar+' h-4 w-16'}/><div className={bar+' hidden h-4 w-24 sm:block'}/></div>
  {ROWS.slice(0,count).map((width,index)=><div key={index} className="flex items-center gap-3 border-b border-zinc-200 py-3 sm:gap-4 dark:border-zinc-800">
   <div className={bar+' h-4 w-5'}/>
   {thumb&&<div className={bar+' hidden h-9 w-16 shrink-0 sm:block'}/>}
   <div className="min-w-0 flex-1"><div className={bar+' h-4'} style={{width:`${width}%`}}/></div>
   <div className={bar+' h-4 w-12 sm:w-16'}/>
   <div className={bar+' h-4 w-12 sm:w-16'}/>
   <div className={bar+' hidden h-4 w-24 lg:block'}/>
  </div>)}
 </div>;
}
/** Phones: the live list's compact cards (thumbnail beside the title, figures below). */
function LiveCards(){
 return <ul className="m-0 list-none space-y-3 p-0">{ROWS.slice(0,4).map((width,index)=><li key={index} className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
  <div className="flex gap-3"><div className="aspect-video w-32 shrink-0 rounded-md bg-zinc-200 dark:bg-zinc-800"/><div className="min-w-0 flex-1 space-y-2"><div className={bar+' h-4'} style={{width:`${width+16}%`}}/><div className={bar+' h-4 w-3/4'}/><div className={bar+' h-3 w-1/2'}/></div></div>
  <div className="mt-3 flex gap-4 border-t border-zinc-100 pt-3 dark:border-zinc-800">{[0,1,2].map(cell=><div key={cell} className={bar+' h-8 w-14'}/>)}</div>
 </li>)}</ul>;
}
function Filters(){
 return <div className="my-4 flex flex-wrap items-center gap-3"><div className="h-11 w-64 max-w-full rounded-full bg-zinc-200 dark:bg-zinc-800"/><div className="h-11 w-24 rounded-full bg-zinc-200 dark:bg-zinc-800"/><div className="h-11 w-24 rounded-full bg-zinc-200 dark:bg-zinc-800"/></div>;
}
function Body({kind}:{kind:SkeletonKind}){
 if(kind==='home')return <>
  <div className="mb-6 flex h-56 flex-col items-center justify-center gap-3 rounded-xl bg-zinc-100 sm:h-72 dark:bg-zinc-900"><div className={bar+' h-16 w-16 rounded-full'}/><div className={bar+' h-6 w-40'}/><div className={bar+' h-4 w-56 max-w-[80%]'}/></div>
  <div className="grid gap-6 lg:grid-cols-[1fr_2fr_1fr]">
   <div className="hidden space-y-3 lg:block">{ROWS.slice(0,5).map((_,i)=><div key={i} className={bar+' h-12'}/>)}</div>
   <div className="space-y-3"><div className="aspect-video w-full rounded-xl bg-zinc-200 dark:bg-zinc-800"/><div className={bar+' h-6 w-4/5'}/><div className={bar+' h-4 w-1/2'}/></div>
   <div className="hidden space-y-3 lg:block">{ROWS.slice(0,3).map((_,i)=><div key={i} className={bar+' h-20'}/>)}</div>
  </div>
 </>;
 if(kind==='channel')return <>
  <div className={bar+' mb-3 h-3 w-40'}/>
  <header className="mb-4 flex flex-wrap items-end justify-between gap-4 border-b border-zinc-200 pb-4 dark:border-zinc-800"><div className="flex items-center gap-3"><div className={bar+' size-8 rounded-full'}/><div className={bar+' h-8 w-64 max-w-[60vw]'}/></div><div className="flex gap-5">{[0,1,2].map(i=><div key={i} className={bar+' h-10 w-20'}/>)}</div></header>
  <TabRow widths={[48,40,56,40,40,56]}/>
  <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_19rem]">
   <div className="space-y-1">{ROWS.slice(0,6).map((width,index)=><div key={index} className="flex gap-3 border-b border-zinc-200 py-3 dark:border-zinc-800"><div className="min-w-0 flex-1 space-y-2"><div className={bar+' h-3 w-24'}/><div className={bar+' h-4'} style={{width:`${width}%`}}/><div className={bar+' h-3 w-1/3'}/></div><div className="aspect-video w-24 shrink-0 rounded-md bg-zinc-200 dark:bg-zinc-800"/></div>)}</div>
   <div className="hidden space-y-3 lg:block"><div className={bar+' h-56 rounded-xl'}/><div className={bar+' h-48 rounded-xl'}/></div>
  </div>
 </>;
 if(kind==='topics')return <>
  <SkeletonHeading/><TabRow widths={[56,48,56,56,56]}/>
  <div className="mb-4 grid grid-cols-3 gap-2 sm:gap-3">{[0,1,2].map(i=><div key={i} className={bar+' h-20 rounded-xl'}/>)}</div>
  <div className="space-y-4">{[0,1].map(i=><div key={i} className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"><div className={bar+' h-6 w-3/4'}/><div className="mt-4 space-y-2">{ROWS.slice(0,4).map((width,index)=><div key={index} className={bar+' h-4'} style={{width:`${width}%`}}/>)}</div><div className="mt-4 hidden grid-cols-3 gap-3 sm:grid">{[0,1,2].map(cell=><div key={cell} className="aspect-video rounded-lg bg-zinc-200 dark:bg-zinc-800"/>)}</div></div>)}</div>
 </>;
 if(kind==='live')return <>
  <SkeletonHeading/><TabRow/><TabRow widths={[88,104,88,56,56,56]}/><Filters/>
  <div className={bar+' mb-3 h-5 w-48'}/>
  <div className="sm:hidden"><LiveCards/></div>
  <div className="hidden sm:block"><TableRows/></div>
 </>;
 return <><SkeletonHeading/><TabRow widths={[88,72,72]}/><div className="mb-4 h-9 w-40 rounded-full bg-zinc-200 dark:bg-zinc-800"/><div className={bar+' mb-3 h-5 w-48'}/><TableRows thumb/></>;
}
export function ReportSkeleton({kind='table',label}:{kind?:SkeletonKind;label?:string}){
 return <div role="status" aria-live="polite" className="motion-safe:animate-pulse" data-skeleton={kind}>
  <span className="sr-only">{label??LABELS[kind]}⋯</span>
  <div aria-hidden="true"><Body kind={kind}/></div>
 </div>;
}
