'use client';
import {useEffect,useRef,type ReactNode} from 'react';

/** The per-tag evidence list behind a disclosure. Keyword pages link to /videos/:id#keyword-evidence
 * to show why a video matched, so that hash (on load or a later same-page link) opens it. */
export function EvidenceDisclosure({anchor,open=false,summary,children}:{anchor:string;open?:boolean;summary:ReactNode;children:ReactNode}){
 const ref=useRef<HTMLDetailsElement>(null);
 useEffect(()=>{const sync=()=>{if(ref.current&&decodeURIComponent(location.hash.slice(1))===anchor)ref.current.open=true;};sync();addEventListener('hashchange',sync);return()=>removeEventListener('hashchange',sync);},[anchor]);
 return <details ref={ref} open={open||undefined} className="group mt-3">
  <summary className="inline-flex min-h-11 cursor-pointer items-center gap-1 text-sm text-brand-700 hover:underline dark:text-brand-400">{summary}<span aria-hidden="true" className="text-xs transition-transform group-open:rotate-180">▾</span></summary>
  {children}
 </details>;
}
