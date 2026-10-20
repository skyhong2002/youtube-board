'use client';
import {useEffect,useRef,useState} from 'react';
import {dateTime} from '@/lib/format';
import {reportStyle as ui} from '@/lib/report-styles';
import {INITIAL_RETRY_STATE,MAX_MANUAL_RETRIES,RELATION_TYPES,fetchKeywordRelations,isSupportedKeyword,recordFailure,retryDecision,waitText,
 type KeywordRelation,type RelationType,type RelationsView,type RelationsResult,type RetryState} from '@/lib/keyword-relations';

/** Optional relations panel, initially read by the server; the browser retains manual retry
 * and expansion. Videos, evidence, coverage, filters and pagination never change because of it. Visual vocabulary from tag.observe.tw MediaRelations
 * (compact neutral source panel, bounded preview, native expanders); no relation metrics. */

export const RELATION_PREVIEW=5;
export const RELATION_GROUP_MAX=40;
const HEADING_ID='keyword-relations-heading';

export const RELATION_COPY:Record<RelationType,{title:string;note:(keyword:string)=>string}>={
 'is-a':{title:'上位概念／群組',note:keyword=>`「${keyword}」→ 上位：單一方向，不代表兩者相同。`},
 related:{title:'相關標籤',note:()=>'來源記錄的相關關係，不是 YouTube 影片共同出現的統計。'},
 alias:{title:'別名',note:()=>'來源記錄的別名關係，不會自動合併影片、去除重複或視為同一人物。'},
};
export const RELATIONS_UNAFFECTED='本頁影片、比對依據與數量不受影響。';
export const RELATIONS_SCOPE_NOTE='關聯不改變本頁影片的排名、數量或篩選範圍。';
const link=`${ui.link} rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600`;
const toggle='rounded-sm text-xs text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 dark:text-brand-400';

function RelationRow({relation}:{relation:KeywordRelation}){
 const {target,href}=relation,label=<span className="break-words [overflow-wrap:anywhere]">{target.label}</span>;
 return <li className="min-w-0 py-1.5" data-relation-type={relation.type}>
  <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
   {relation.type==='is-a'&&<span aria-hidden="true" className="text-zinc-500">→</span>}
   {href?<a href={href} rel="noopener noreferrer external" className={`min-w-0 ${link}`}>{label}<span aria-hidden="true"> ↗</span><span className="sr-only">（前往新文易數）</span></a>:<span className="min-w-0 text-zinc-800 dark:text-zinc-200">{label}</span>}
   {target.kind==='group'&&<span className={ui.tag}>群組</span>}
   {relation.inherited&&<span className={ui.tag}>繼承・第 {relation.depth} 層</span>}
  </div>
  <details className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
   <summary className="cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-brand-600">來源與紀錄</summary>
   <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 [overflow-wrap:anywhere]">
    <dt>來源</dt><dd>{relation.source}</dd>
    <dt>來源說明</dt><dd>{relation.sourceDetail}</dd>
    <dt>狀態</dt><dd>已核准</dd>
    <dt>建立時間</dt><dd>{relation.createdAt?dateTime(relation.createdAt):'未記錄'}</dd>
    <dt>取得方式</dt><dd>{relation.inherited?`繼承（第 ${relation.depth} 層）`:`直接記錄（第 ${relation.depth} 層）`}</dd>
    <dt>{target.kind==='group'?'群組 ID':'標籤 ID'}</dt><dd className="break-all">{target.id}</dd>
    <dt>關聯 ID</dt><dd className="break-all">{relation.id}</dd>
   </dl>
  </details>
 </li>;
}

function RelationGroup({keyword,type,rows,sourceUrl,expanded,partial,onExpand}:{keyword:string;type:RelationType;rows:KeywordRelation[];sourceUrl:string;expanded:boolean;partial:boolean;onExpand?:(type:RelationType)=>void}){
 const copy=RELATION_COPY[type],limit=expanded?RELATION_GROUP_MAX:RELATION_PREVIEW,shown=rows.slice(0,limit),rest=rows.length-shown.length,listId=`keyword-relations-${type}`;
 return <section className="min-w-0" aria-label={copy.title} data-relation-group={type}>
  {/* The type's meaning is in 關聯類型說明 below; an empty type stays one line. */}
  <h3 className="text-xs font-medium text-zinc-700 dark:text-zinc-300" title={copy.note(keyword)}>{copy.title} <span className="font-normal text-zinc-500 dark:text-zinc-400">{rows.length} 筆{rows.length===0&&<> · {partial?'本次未取得（來源結果不完整）':'尚未收錄'}</>}</span></h3>
  <ul id={listId} className="divide-y divide-zinc-200 dark:divide-zinc-800">{shown.map((relation,i)=><RelationRow key={`${i}:${relation.id}`} relation={relation}/>)}</ul>
  {rest>0&&(!expanded&&onExpand
   ?<button type="button" className={toggle} aria-controls={listId} aria-expanded="false" onClick={()=>onExpand(type)}>顯示其餘 {Math.min(rest,RELATION_GROUP_MAX-RELATION_PREVIEW)} 筆</button>
   :<p className="text-xs text-zinc-500 dark:text-zinc-400">另有 {rest} 筆未在此列出，<a href={sourceUrl} rel="noopener noreferrer external" className={link}>請至新文易數查看</a>。</p>)}
 </section>;
}

export interface KeywordRelationsViewProps {
 keyword:string;
 view:RelationsView;
 /** Manual retry; absent or exhausted means no button. */
 onRetry?:()=>void;
 retriesLeft?:number;
 /** Result of the last refused manual retry (hold or exhausted), plain local copy only. */
 note?:string|null;
 expanded?:Partial<Record<RelationType,boolean>>;
 onExpand?:(type:RelationType)=>void;
}

/** Pure display: every state is its own wording; none of them is an empty list or a zero unless the
 * source returned a successful read with no approved rows. */
export function KeywordRelationsView({keyword,view,onRetry,retriesLeft=0,note=null,expanded={},onExpand}:KeywordRelationsViewProps){
 let status:string,body=null;
 switch(view.kind){
  case 'idle':status='標籤關聯會在頁面載入後另外讀取；'+RELATIONS_UNAFFECTED;break;
  case 'loading':status='正在讀取標籤關聯…';break;
  case 'disabled':status='標籤關聯尚未開放，目前未向來源查詢；這不表示此標籤沒有關聯。';break;
  case 'unavailable':{
   status=(view.reason==='invalid-keyword'?'這個標籤的格式無法查詢關聯。':'標籤關聯目前無法讀取。')+RELATIONS_UNAFFECTED;
   const canRetry=view.retryable&&!!onRetry&&retriesLeft>0;
   body=<div className="mt-2 space-y-1.5">
    {view.retryable&&view.retryAfterSeconds!==null&&<p className="text-xs">來源要求稍候，請於{waitText(view.retryAfterSeconds)}後再試；本頁不會自動重試。</p>}
    {view.retryable&&!canRetry&&onRetry&&<p className="text-xs">已多次重新讀取仍無法取得，請稍後重新整理頁面。</p>}
    {canRetry&&<button type="button" className={`${ui.button} min-h-8 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600`} onClick={onRetry}>重新讀取標籤關聯</button>}
   </div>;
   break;
  }
  case 'available':{
   const total=view.relations.length;
   status=total?`已讀取 ${total} 筆新文易數已核准的關聯${view.truncated?'；來源只回傳部分結果（已截斷），以下不是完整清單。':'。'}`
    :view.truncated?'來源回傳的結果不完整（已截斷），無法確認此標籤是否還有其他關聯。'
    :'尚未收錄已核准的標籤關係；不代表沒有相關影片。';
   const groups=RELATION_TYPES.map(type=>[type,view.relations.filter(r=>r.type===type)] as const);
   const sourceLink=<a href={view.sourceUrl} rel="noopener noreferrer external" className={link}>在新文易數查看「{keyword}」<span aria-hidden="true"> ↗</span></a>;
   // A complete read with no approved relation is one line, not three empty groups.
   if(!total&&!view.truncated){body=<p className="mt-1 text-xs">{sourceLink}</p>;break;}
   body=<div className="mt-2 space-y-3">
    {groups.map(([type,rows])=><RelationGroup key={type} keyword={keyword} type={type} rows={rows} sourceUrl={view.sourceUrl} expanded={!!expanded[type]} partial={view.truncated} onExpand={onExpand}/>)}
    <details className="text-xs text-zinc-600 dark:text-zinc-400">
     <summary className="cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-brand-600">關聯類型說明</summary>
     <ul className="mt-1 list-disc space-y-0.5 pl-4">{RELATION_TYPES.map(type=><li key={type}><strong className="font-medium">{RELATION_COPY[type].title}</strong>：{RELATION_COPY[type].note(keyword)}</li>)}<li>{RELATIONS_SCOPE_NOTE}</li></ul>
    </details>
    <p className="border-t border-zinc-200 pt-2 text-xs dark:border-zinc-800">{sourceLink}</p>
   </div>;
   break;
  }
 }
 return <section aria-labelledby={HEADING_ID} aria-busy={view.kind==='loading'||undefined} data-relations-state={view.kind==='unavailable'&&view.reason==='invalid-keyword'?'invalid-keyword':view.kind} className="min-w-0 rounded-lg border border-zinc-300 bg-white p-3 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
  <div className="flex flex-wrap items-baseline justify-between gap-x-2">
   <h2 id={HEADING_ID} className="text-sm font-medium text-zinc-700 dark:text-zinc-300">標籤關聯</h2>
   <span className="text-xs text-zinc-500 dark:text-zinc-400">來源：新文易數</span>
  </div>
  <p role="status" className="mt-1 text-xs leading-5 [overflow-wrap:anywhere]">{status}{note&&<span className="block">{note}</span>}</p>
  {body}
 </section>;
}

/** Supplied server data avoids a duplicate hydration request. Otherwise one request per keyword
 * plus bounded manual retries; aborts on
 * unmount/keyword change and ignores any response for a keyword that is no longer current. */
export default function KeywordRelations({keyword,initialView}:{keyword:string;initialView?:RelationsResult}){
 const adopted=useRef(initialView);
 const [state,setState]=useState<{keyword:string;view:RelationsView}>({keyword,view:initialView??{kind:'idle'}});
 const [retry,setRetry]=useState<{keyword:string;state:RetryState;attempt:number;note:string|null}>({keyword,state:initialView?recordFailure(INITIAL_RETRY_STATE,initialView,Date.now()):INITIAL_RETRY_STATE,attempt:0,note:null});
 const [expanded,setExpanded]=useState<{keyword:string;types:Partial<Record<RelationType,boolean>>}>({keyword,types:{}});
 const current=retry.keyword===keyword?retry:{keyword,state:INITIAL_RETRY_STATE,attempt:0,note:null};
 const attempt=current.attempt;
 useEffect(()=>{
  if(initialView&&adopted.current!==initialView){
   adopted.current=initialView;setState({keyword,view:initialView});
   // Preserve retry count and the longest upstream hold on same-keyword refresh.
   setRetry(r=>r.keyword===keyword?{...r,state:recordFailure(r.state,initialView,Date.now()),note:null}:r);
   return;
  }
  if(initialView&&attempt===0)return;
  if(!isSupportedKeyword(keyword)){setState({keyword,view:{kind:'unavailable',reason:'invalid-keyword',retryAfterSeconds:null,retryable:false}});return;}
  const controller=new AbortController();
  setState({keyword,view:{kind:'loading'}});
  fetchKeywordRelations(keyword,{signal:controller.signal})
   .catch(()=>({kind:'unavailable',reason:'network',retryAfterSeconds:null,retryable:true}) as const)
   .then(result=>{
    if(!result||controller.signal.aborted)return;
    const at=Date.now();
    setRetry(r=>r.keyword===keyword?{...r,state:recordFailure(r.state,result,at)}:r);
    setState({keyword,view:result});
   });
  return()=>controller.abort();
 },[keyword,attempt,initialView]);
 const view:RelationsView=initialView&&adopted.current!==initialView?initialView:state.keyword===keyword?state.view:{kind:'idle'};
 const onRetry=()=>{
  const decision=retryDecision(current.state,view,Date.now());
  if(!decision.allowed){
   const note=decision.reason==='hold'&&decision.waitSeconds!==null?`等候時間尚未結束（${waitText(decision.waitSeconds)}），尚未重新讀取。`:decision.reason==='exhausted'?'已多次重新讀取仍無法取得，請稍後重新整理頁面。':null;
   setRetry({...current,note});return;
  }
  setRetry({...current,state:{...current.state,retries:current.state.retries+1},attempt:current.attempt+1,note:null});
 };
 return <KeywordRelationsView keyword={keyword} view={view} onRetry={onRetry} retriesLeft={MAX_MANUAL_RETRIES-current.state.retries} note={current.note}
  expanded={expanded.keyword===keyword?expanded.types:{}} onExpand={type=>setExpanded(e=>({keyword,types:{...(e.keyword===keyword?e.types:{}),[type]:true}}))}/>;
}
