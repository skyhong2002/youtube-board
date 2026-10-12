import type {ReactNode} from 'react';

/** tag.observe.tw FooterMethod: a collapsible 「本頁資料來源與計算方式」. The anchor sits
 * inside <details>, so a `#method` link opens it (browsers reveal fragment targets). */
export default function MethodDisclosure({children,id='method'}:{children:ReactNode;id?:string}){
 return <details className="group mt-10 border-t border-zinc-200 dark:border-zinc-800">
  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-sm font-medium text-zinc-900 hover:text-brand-700 dark:text-zinc-100 dark:hover:text-brand-400 [&::-webkit-details-marker]:hidden">
   <span>本頁資料來源與計算方式<span className="ml-1 text-xs font-normal text-brand-700 dark:text-brand-400" aria-hidden="true">ⓘ</span></span>
   <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" className="shrink-0 transition-transform group-open:rotate-180"><path d="m6 9 6 6 6-6"/></svg>
  </summary>
  <div id={id} className="max-w-3xl scroll-mt-32 space-y-2.5 pb-5 text-[13px] leading-[1.9] text-zinc-600 dark:text-zinc-400">{children}</div>
 </details>;
}
/** Section heading inside the disclosure (tag.observe.tw method/styles methodHeading). */
export const methodHeading='pt-2 text-[13px] font-semibold text-zinc-800 first:pt-0 dark:text-zinc-200';
