'use client';
import {createContext,useContext,useState,type MouseEvent,type ReactNode} from 'react';
import {DEFAULT_KEYWORD_WINDOW,KEYWORD_WINDOWS,type KeywordWindow} from '@/lib/home-presentation';

// One selection drives the masthead word cloud, the keyword ranking and their
// method notes, which sit in different parts of the page. Both windows are rendered on the
// server; switching only chooses which one is shown.
const Selection=createContext<{selected:KeywordWindow;select:(window:KeywordWindow)=>void}>({selected:DEFAULT_KEYWORD_WINDOW,select:()=>{}});
export const KEYWORD_REGIONS='home-keyword-ranking home-keyword-cloud';

export function KeywordWindowProvider({initial=DEFAULT_KEYWORD_WINDOW,children}:{initial?:KeywordWindow;children:ReactNode}){
 const [selected,select]=useState<KeywordWindow>(initial);
 return <Selection value={{selected,select}}>{children}</Selection>;
}
/** Renders the selected window's children unchanged. Only the content of an aria-controls region
 * opts in with `region`, which wraps it in one marked box styled by the caller's `className`. */
export function KeywordWindowPane({window,region=false,className,children}:{window:KeywordWindow;region?:boolean;className?:string;children:ReactNode}){
 if(useContext(Selection).selected!==window)return null;
 return region?<div className={className} data-keyword-window-pane={window}>{children}</div>:children;
}
/** Native radios: arrow keys move between windows. Each section carries its own synchronized copy. */
export function KeywordWindowSwitch({name,className='mb-3',controls=KEYWORD_REGIONS,legend='關鍵字期間（同時切換熱門關鍵字排行與文字雲）'}:{name:string;className?:string;controls?:string;legend?:string}){
 const {selected,select}=useContext(Selection);
 return <fieldset className={`min-w-0 ${className}`} data-keyword-window-selected={selected}>
  <legend className="sr-only">{legend}</legend>
  <div className="inline-flex rounded-full border border-zinc-300 bg-white p-0.5 text-xs dark:border-zinc-800 dark:bg-zinc-900">
   {KEYWORD_WINDOWS.map(({value,label})=><label key={value} className="cursor-pointer">
    <input type="radio" name={name} value={value} checked={selected===value} onChange={()=>select(value)} aria-controls={controls} className="peer sr-only"/>
    <span className="block rounded-full px-3 py-1.5 leading-4 text-zinc-600 transition-colors peer-checked:bg-brand-700 peer-checked:text-white peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-700 dark:text-zinc-400 dark:peer-checked:bg-brand-600 dark:peer-checked:text-white dark:peer-focus-visible:outline-brand-400">{label}</span>
   </label>)}
  </div>
 </fieldset>;
}
/** A link to the other window that switches the shared selection in place: after a radio switch the URL
 * still names the first window, so following the href alone could leave the page on the same window.
 * The href stays for new tabs and readers without scripts. */
export function KeywordWindowLink({window,className,children}:{window:KeywordWindow;className?:string;children:ReactNode}){
 const {select}=useContext(Selection);
 const follow=(event:MouseEvent<HTMLAnchorElement>)=>{if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;event.preventDefault();select(window);};
 return <a className={className} href={window==='today'?'/keywords?window=today':'/keywords'} onClick={follow}>{children}</a>;
}
