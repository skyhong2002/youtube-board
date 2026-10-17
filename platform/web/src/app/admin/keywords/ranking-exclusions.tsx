'use client';
import {useCallback,useEffect,useState} from 'react';
import type {AccountSession} from '../../../../../shared/account-contracts';
import {decideRankingDisplay,fetchRankingDisplay,keywordReviewMessage,type RankingDisplayEntry} from '@/lib/keyword-review-client';
import {dateTime} from '@/lib/format';
import {styles} from './review-details';

type State={kind:'loading'}|{kind:'error';message:string}|{kind:'ready';rows:RankingDisplayEntry[]};
/** Labels an administrator excluded from the 熱門標籤排行 (latest approved decision per label).
 * Restoring records a new approved "keep" decision; the history stays in the review log. */
export function RankingExclusionsView({rows,busy,onRestore}:{rows:RankingDisplayEntry[];busy:string|null;onRestore?:(row:RankingDisplayEntry)=>void}){
 if(!rows.length)return <p className={styles.note}>目前沒有管理員排除的關鍵字。可在熱門標籤排行或關鍵字頁按「排除」。</p>;
 return <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">{rows.map(row=>
  <li key={row.termKey} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
   <span className="font-medium">{row.term}</span>
   <span className="text-xs text-zinc-500">{dateTime(row.decidedAt)} · {row.decidedBy} · {row.reason}</span>
   {onRestore&&<button type="button" className={styles.button+' ml-auto'} disabled={busy!==null} onClick={()=>onRestore(row)}>{busy===row.termKey?'恢復中…':'恢復顯示'}</button>}
  </li>)}</ul>;
}
export default function RankingExclusions({session}:{session:AccountSession}){
 const[state,setState]=useState<State>({kind:'loading'}),[busy,setBusy]=useState<string|null>(null),[message,setMessage]=useState('');
 const load=useCallback(async()=>{try{setState({kind:'ready',rows:await fetchRankingDisplay()});}catch(e){setState({kind:'error',message:keywordReviewMessage(e)});}},[]);
 useEffect(()=>{void load();},[load]);
 const restore=async(row:RankingDisplayEntry)=>{
  if(!window.confirm(`恢復「${row.term}」在熱門標籤排行的顯示？`))return;
  setBusy(row.termKey);setMessage('');
  try{await decideRankingDisplay([row.term],'keep',session);setMessage(`已恢復「${row.term}」，約 1–2 分鐘後回到排行。`);await load();}
  catch(e){setMessage(keywordReviewMessage(e));}
  finally{setBusy(null);}
 };
 return <section className="grid gap-2" aria-labelledby="ranking-exclusions">
  <h2 id="ranking-exclusions" className="text-lg font-semibold">管理員排除的關鍵字</h2>
  <p className={styles.note}>只影響熱門標籤排行的顯示；詞彙池與比對證據保留。每次排除與恢復都會留下覆核紀錄。</p>
  {message&&<p role="status" className={styles.note}>{message}</p>}
  {state.kind==='loading'?<p className={styles.note}>載入中…</p>:state.kind==='error'?<p role="alert" className={styles.alert}>{state.message}</p>:<RankingExclusionsView rows={state.rows} busy={busy} onRestore={restore}/>}
 </section>;
}
