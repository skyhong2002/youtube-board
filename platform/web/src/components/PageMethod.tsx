import Link from 'next/link';
import type {ReactNode} from 'react';
import {inlineLink} from './method/styles';

/** The full write-up of every block (tag.observe.tw METHOD_HREF). */
export const METHOD_HREF='/about';

/** tag.observe.tw FooterMethod: the collapsible 本頁的資料來源與計算方式 under the page,
 * with this page's blocks, then its own notes, then a link to the full write-up.
 * Pages render it last in <main> (the ISR/filtered rewrites leave no reliable pathname
 * in the shared layout); the footer keeps a `fallback` copy for pages without one,
 * hidden by globals.css when the page has its own. The anchor sits inside <details>,
 * so a `#method` link (MethodLink) opens it: browsers reveal fragment targets, which can
 * happen before hydration, so the `open` attribute is allowed to differ from the server. */
export default function PageMethod({children,fallback=false}:{children:ReactNode;fallback?:boolean}){
 return <details className={`group border-t border-zinc-200 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400 ${fallback?'':'mt-20'}`} {...(fallback?{'data-footer-method':''}:{'data-page-method':''})} suppressHydrationWarning>
  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-sm font-medium text-zinc-900 hover:text-brand-700 dark:text-zinc-100 dark:hover:text-brand-400 [&::-webkit-details-marker]:hidden">
   <span>本頁的資料來源與計算方式<span className="ml-1 text-xs font-normal text-brand-700 dark:text-brand-400" aria-hidden="true">ⓘ</span></span>
   <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" className="shrink-0 transition-transform group-open:rotate-180"><path d="m6 9 6 6 6-6"/></svg>
  </summary>
  <div id={fallback?undefined:'method'} className="max-w-3xl scroll-mt-32 space-y-2.5 pb-5 text-[13px] leading-[1.9]">
   {children}
   <p><Link href={METHOD_HREF} className={inlineLink}>完整的資料來源與計算方式 →</Link></p>
  </div>
 </details>;
}
