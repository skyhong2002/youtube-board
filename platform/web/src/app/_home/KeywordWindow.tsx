'use client';
import {createContext,useContext,useState,type ReactNode} from 'react';
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
export function KeywordWindowPane({window,children}:{window:KeywordWindow;children:ReactNode}){
 return useContext(Selection).selected===window?children:null;
}
/** Native radios: arrow keys move between windows. Each section carries its own synchronized copy. */
export function KeywordWindowSwitch({name,className='mb-3',controls=KEYWORD_REGIONS,legend='關鍵字期間（同時切換熱門關鍵字排行與文字雲）'}:{name:string;className?:string;controls?:string;legend?:string}){
 const {selected,select}=useContext(Selection);
 return <fieldset className={`min-w-0 ${className}`}>
  <legend className="sr-only">{legend}</legend>
  <div className="inline-flex rounded-full border border-zinc-300 bg-white p-0.5 text-xs dark:border-zinc-800 dark:bg-zinc-900">
   {KEYWORD_WINDOWS.map(({value,label})=><label key={value} className="cursor-pointer">
    <input type="radio" name={name} value={value} checked={selected===value} onChange={()=>select(value)} aria-controls={controls} className="peer sr-only"/>
    <span className="block rounded-full px-3 py-1.5 leading-4 text-zinc-600 transition-colors peer-checked:bg-brand-700 peer-checked:text-white peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-700 dark:text-zinc-400 dark:peer-checked:bg-brand-600 dark:peer-checked:text-white dark:peer-focus-visible:outline-brand-400">{label}</span>
   </label>)}
  </div>
 </fieldset>;
}
