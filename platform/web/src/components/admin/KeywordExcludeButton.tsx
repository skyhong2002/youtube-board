'use client';
import {useRef,useState} from 'react';
import {useSession} from '@/lib/session';
import {decideRankingDisplay,keywordReviewMessage} from '@/lib/keyword-review-client';
import {pill,pillOff} from '../reader/FollowButton';

/** Administrator-only island on public keyword surfaces. Anonymous HTML stays shareable:
 * nothing renders until the client session reports role 'admin'. One confirmed click
 * submits and approves a ranking-display exclusion for every exact label of the row;
 * vocabulary and matching evidence are kept, and /admin/keywords can restore it. */
export default function KeywordExcludeButton({terms,label,compact=false}:{terms:string[];label:string;compact?:boolean}){
 const session=useSession(),ref=useRef<HTMLSpanElement>(null),[state,setState]=useState<'idle'|'busy'|'done'>('idle'),[error,setError]=useState('');
 if(session?.user?.role!=='admin'||!terms.length)return null;
 if(state==='done')return <span ref={ref} role="status" className="text-xs text-amber-700 dark:text-amber-400">已排除，約 1–2 分鐘後從排行消失</span>;
 const exclude=async()=>{
  if(!window.confirm(`從熱門標籤排行排除「${label}」？\n${terms.length>1?`包含 ${terms.length} 種寫法：${terms.join('、')}\n`:''}詞彙與比對紀錄會保留，可在「管理 › 關鍵字覆核」恢復。`))return;
  setState('busy');setError('');
  try{await decideRankingDisplay(terms,'exclude',session);setState('done');ref.current?.closest('tr')?.classList.add('opacity-40');}
  catch(e){setState('idle');setError(keywordReviewMessage(e));}
 };
 return <span ref={ref} className="inline-flex items-center gap-2">
  <button type="button" onClick={exclude} disabled={state==='busy'} title="從熱門標籤排行排除（管理員）" aria-label={`從熱門標籤排行排除「${label}」`}
   className={compact?'rounded-full border border-zinc-300 px-2 py-0.5 text-xs text-zinc-600 hover:border-red-500 hover:text-red-600 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-400':`${pill} ${pillOff} hover:border-red-500 hover:text-red-600`}>
   {state==='busy'?'排除中…':'排除'}
  </button>
  {error&&<span role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</span>}
 </span>;
}
