'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {loginHref,refreshSession,useSessionState} from '@/lib/session';
import {commandId} from '@/lib/account-client';
import type {AccountSession} from '../../../../../shared/account-contracts';
import {DECISIONS,MAX_REASON,REVIEW_CONTEXTS,RULE_VERSIONS,VOCABULARY_QUERY_MAX,KeywordReviewError,applyVocabularyChoice,buildDecideCommand,buildSubmitCommand,contextLabels,decisionLabels,executeReviewCommand,fetchReviewDetail,fetchReviewList,fetchReviewStatus,keywordReviewMessage,lookupVocabulary,needsRepreview,previewReviewCommand,reasonProblem,submitInputProblem,vocabularyQuery,type KeywordReview,type ReviewCommand,type ReviewDetail,type ReviewExecution,type ReviewPreview,type ReviewStatusInfo,type SubmitInput,type VocabularyChoice} from '@/lib/keyword-review-client';
import {ExecutionView,GateNotice,GateSummary,NotAppliedBadge,PreviewView,ReviewDetailView,ReviewTable,SelectedVocabulary,VocabularyResults,styles,type GateState,type VocabularySearchState} from './review-details';

const NEXT='/manage/keywords';
/** Session gate: Google administrator session only. No service-token input or storage exists here. */
export default function KeywordReviewAccess(){
 const {session,loading,error}=useSessionState();
 const retry=<button type="button" className="ml-2 underline" onClick={()=>void refreshSession()}>重試</button>;
 let gate:GateState|null=null;
 if(loading&&!session)gate={kind:'loading'};
 else if(error)gate={kind:'session-error',message:error};
 else if(!session?.enabled)gate={kind:'login-disabled'};
 else if(!session.user)gate={kind:'signed-out',loginUrl:loginHref(NEXT)};
 else if(session.user.role!=='admin')gate={kind:'forbidden'};
 return <div className="grid gap-4">
  <NotAppliedBadge/>
  {gate||!session?.user?<GateNotice state={gate??{kind:'loading'}} action={retry}/>:<>
   <p className={styles.note}>操作帳號：{session.user.name??session.user.email}（{session.user.email}）· Google 管理員</p>
   <KeywordReviewConsole key={session.user.id+':'+(session.csrfToken??'')} session={session}/>
  </>}
 </div>;
}

type StatusState={kind:'loading'}|{kind:'error';message:string}|{kind:'ready';info:ReviewStatusInfo};
type ListState={kind:'idle'|'loading'|'ready'}|{kind:'error';message:string};
type DetailState={kind:'none'|'loading'}|{kind:'error';message:string}|{kind:'ready';detail:ReviewDetail};
/** A preview plus whether a previous execute attempt had an unknown outcome (replay the exact request). */
type Pending={preview:ReviewPreview;uncertain:boolean};
const emptySubmit:SubmitInput={vocabularyVersion:'',termKey:'',ruleVersion:'youtube-quality-v2',context:'youtube-ranking-display',decision:'exclude',reason:''};

function KeywordReviewConsole({session}:{session:AccountSession}){
 const[status,setStatus]=useState<StatusState>({kind:'loading'});
 const[rows,setRows]=useState<KeywordReview[]>([]),[page,setPage]=useState(1),[hasMore,setHasMore]=useState(false),[list,setList]=useState<ListState>({kind:'idle'});
 const[versionInput,setVersionInput]=useState(''),[versionFilter,setVersionFilter]=useState<string|undefined>(undefined);
 const[selectedId,setSelectedId]=useState<string|null>(null),[detail,setDetail]=useState<DetailState>({kind:'none'});
 const[submit,setSubmit]=useState<SubmitInput>(emptySubmit);
 const[decideAction,setDecideAction]=useState<'approve'|'reject'>('approve'),[decideReason,setDecideReason]=useState('');
 const[pending,setPending]=useState<Pending|null>(null),[result,setResult]=useState<ReviewExecution|null>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 // Proposal target: primary path is a selected public-vocabulary result; manual entry is an explicit advanced mode.
 const[vocabQuery,setVocabQuery]=useState(''),[vocabSearch,setVocabSearch]=useState<VocabularySearchState>({kind:'idle'});
 const[chosen,setChosen]=useState<{version:string;choice:VocabularyChoice}|null>(null),[manual,setManual]=useState(false);
 // Monotonic tokens + abort controllers: stale responses never overwrite newer selection/inputs.
 const listSeq=useRef(0),detailSeq=useRef(0),previewSeq=useRef(0),vocabSeq=useRef(0);
 const listAbort=useRef<AbortController|null>(null),detailAbort=useRef<AbortController|null>(null),previewAbort=useRef<AbortController|null>(null),vocabAbort=useRef<AbortController|null>(null);

 const handleAuth=useCallback((e:unknown)=>{if(e instanceof KeywordReviewError&&e.status===401)void refreshSession();},[]);
 /** Drop any preview / replay request. Called on every relevant input, action or selection change. */
 const invalidate=useCallback(()=>{previewSeq.current++;previewAbort.current?.abort();previewAbort.current=null;setPending(null);},[]);

 const loadList=useCallback(async(nextPage:number,version:string|undefined)=>{
  const seq=++listSeq.current;listAbort.current?.abort();const ctrl=new AbortController();listAbort.current=ctrl;
  setList({kind:'loading'});
  try{const data=await fetchReviewList(nextPage,version,{signal:ctrl.signal});if(seq!==listSeq.current)return;setRows(data.rows);setPage(data.page);setHasMore(data.hasMore);setList({kind:'ready'});}
  catch(e){if(seq!==listSeq.current)return;handleAuth(e);setList({kind:'error',message:keywordReviewMessage(e)});}
 },[handleAuth]);

 const loadDetail=useCallback(async(id:string)=>{
  const seq=++detailSeq.current;detailAbort.current?.abort();const ctrl=new AbortController();detailAbort.current=ctrl;
  setDetail({kind:'loading'});
  try{const data=await fetchReviewDetail(id,{signal:ctrl.signal});if(seq!==detailSeq.current)return;setDetail({kind:'ready',detail:data});}
  catch(e){if(seq!==detailSeq.current)return;handleAuth(e);setDetail({kind:'error',message:keywordReviewMessage(e)});}
 },[handleAuth]);

 const loadStatus=useCallback(async()=>{
  setStatus({kind:'loading'});
  try{const info=await fetchReviewStatus();setStatus({kind:'ready',info});if(info.status==='ready')void loadList(1,undefined);}
  catch(e){handleAuth(e);setStatus({kind:'error',message:keywordReviewMessage(e)});}
 },[handleAuth,loadList]);

 useEffect(()=>{void loadStatus();return()=>{listAbort.current?.abort();detailAbort.current?.abort();previewAbort.current?.abort();vocabAbort.current?.abort();};},[loadStatus]);

 /** Reject any in-flight vocabulary response (query edit, selection, new search, unmount/session change). */
 const cancelSearch=useCallback(()=>{vocabSeq.current++;vocabAbort.current?.abort();vocabAbort.current=null;},[]);
 async function runSearch(raw:string){
  const query=vocabularyQuery(raw);
  cancelSearch();
  if(query===null){setVocabSearch({kind:'error',query:raw.trim().slice(0,VOCABULARY_QUERY_MAX),message:keywordReviewMessage(new KeywordReviewError('VOCABULARY_QUERY_INVALID'))});return;}
  const seq=vocabSeq.current,ctrl=new AbortController();vocabAbort.current=ctrl;
  setVocabSearch({kind:'loading',query});
  try{const lookup=await lookupVocabulary(query,{signal:ctrl.signal});if(seq!==vocabSeq.current)return;setVocabSearch({kind:'ready',query,lookup});}
  catch(e){if(seq!==vocabSeq.current)return;setVocabSearch({kind:'error',query,message:keywordReviewMessage(e)});}
 }
 function changeQuery(value:string){
  setVocabQuery(value);cancelSearch();
  // A pending response for the old text is now stale; completed results stay visible and labelled with their query.
  setVocabSearch(s=>s.kind==='loading'?{kind:'idle'}:s);
 }
 function chooseVocabulary(choice:VocabularyChoice){
  if(busy||vocabSearch.kind!=='ready')return;
  const lookup=vocabSearch.lookup;
  let next:SubmitInput;
  try{next=applyVocabularyChoice(submit,lookup,choice);}catch(e){setMessage(keywordReviewMessage(e));return;}
  cancelSearch();invalidate();setResult(null);setMessage('');
  setSubmit(next);setChosen({version:next.vocabularyVersion,choice});setManual(false);
 }
 function setManualMode(on:boolean){
  if(busy)return;
  // Switching modes clears the target so a selected identity and hand-entered values never mix.
  cancelSearch();setVocabSearch(s=>s.kind==='loading'?{kind:'idle'}:s);
  invalidate();setResult(null);setManual(on);setChosen(null);setSubmit(s=>({...s,vocabularyVersion:'',termKey:''}));
 }

 function select(id:string){
  if(busy)return;invalidate();setResult(null);setMessage('');setDecideReason('');setSelectedId(id);void loadDetail(id);
 }
 function changeSubmit<K extends keyof SubmitInput>(key:K,value:SubmitInput[K]){invalidate();setResult(null);setSubmit(s=>({...s,[key]:value}));}

 const selected=detail.kind==='ready'&&detail.detail.review.id===selectedId?detail.detail.review:null;

 async function runPreview(kind:'submit'|'decide'){
  invalidate();setResult(null);setMessage('');
  let command:ReviewCommand;
  try{
   if(kind==='decide'&&!selected)throw new KeywordReviewError('REVISION_REQUIRED');
   command=kind==='submit'?buildSubmitCommand(submit,commandId):buildDecideCommand(selected!,decideAction,decideReason,commandId);
  }catch(e){setMessage(keywordReviewMessage(e));return;}
  const seq=previewSeq.current,ctrl=new AbortController();previewAbort.current=ctrl;setBusy(true);
  try{const preview=await previewReviewCommand(command,session,{signal:ctrl.signal});if(seq!==previewSeq.current)return;setPending({preview,uncertain:false});}
  catch(e){if(seq!==previewSeq.current)return;handleAuth(e);setMessage(keywordReviewMessage(e));}
  finally{setBusy(false);}
 }

 async function runExecute(){
  if(!pending||busy)return;
  const {preview}=pending;setBusy(true);setMessage('');
  try{
   // Exact preview command UUIDs and hash; never regenerated, so a retry is a server-side replay.
   const done=await executeReviewCommand(preview,session);
   setPending(null);setResult(done);
   if(preview.command.action==='submit'){setSubmit(s=>({...s,reason:''}));}else setDecideReason('');
   void loadList(page,versionFilter);setSelectedId(done.review.id);void loadDetail(done.review.id);
  }catch(e){
   handleAuth(e);
   const retryable=e instanceof KeywordReviewError&&(e.uncertain||['REVIEW_WRITER_BUSY','RATE_LIMITED','NETWORK_ERROR'].includes(e.code));
   if(retryable){setPending({preview,uncertain:true});setMessage(keywordReviewMessage(e)+' 結果尚未確認：請以「相同請求重試」確認，不會建立重複紀錄。');}
   else{setPending(null);setMessage(keywordReviewMessage(e)+(needsRepreview(e)?' 已重新載入，請重新預覽。':''));if(needsRepreview(e)){void loadList(page,versionFilter);if(selectedId)void loadDetail(selectedId);}}
  }finally{setBusy(false);}
 }

 if(status.kind==='loading')return <p role="status" className={styles.note}>載入覆核功能狀態…</p>;
 if(status.kind==='error')return <GateNotice state={{kind:'status-error',message:status.message}} action={<button type="button" className="ml-2 underline" onClick={()=>void loadStatus()}>重試</button>}/>;
 const info=status.info;
 if(info.status==='disabled')return <GateNotice state={{kind:'feature-disabled'}}/>;
 if(info.status==='schema-unavailable')return <GateNotice state={{kind:'schema-unavailable'}}/>;
 const writeEnabled=info.writeEnabled,decideProblem=reasonProblem(decideReason);
 const identityProblem=!manual&&!chosen?'請先搜尋並從結果選擇詞彙。':null,submitProblem=identityProblem??submitInputProblem(submit);
 // The server resolves the stored original term; if it differs from the selected row, do not allow execution.
 const p=pending?.preview,termMismatch=!!(p&&p.command.action==='submit'&&chosen&&(p.after.evidence.rawTerm!==chosen.choice.term||p.after.evidence.vocabularyVersion!==chosen.version||p.after.evidence.termKey!==chosen.choice.key));
 const execLabel=pending?.uncertain?'以相同請求重試執行':'確認寫入覆核紀錄（不套用）';
 const executeBar=pending&&<div className="grid gap-2">
  <PreviewView preview={pending.preview} writeEnabled={writeEnabled}/>
  {termMismatch&&<p role="alert" className={styles.alert}>伺服器解析的原始詞彙／版本／詞彙鍵與所選結果不一致，已停止執行；請重新搜尋並選擇後再預覽。</p>}
  {pending.uncertain&&<p role="alert" className={styles.alert}>上次執行結果不確定。重試會送出完全相同的請求編號與預覽雜湊；修改任何輸入將放棄此請求。</p>}
  <div className="flex flex-wrap gap-2"><button type="button" className={styles.primary} disabled={busy||!writeEnabled||termMismatch} onClick={()=>void runExecute()}>{execLabel}</button><button type="button" className={styles.button} disabled={busy} onClick={()=>{invalidate();setMessage('');}}>放棄預覽</button></div>
 </div>;

 return <div className="grid gap-6">
  <GateSummary info={info}/>
  {message&&<p role="alert" className={styles.alert}>{message}</p>}
  {result&&<ExecutionView result={result}/>}

  <section className={styles.card+' grid gap-3'} aria-label="覆核紀錄">
   <h2 className="text-lg font-semibold">覆核紀錄</h2>
   <form className="flex flex-wrap items-end gap-2" onSubmit={e=>{e.preventDefault();const v=versionInput.trim()||undefined;setVersionFilter(v);void loadList(1,v);}}>
    <label className="grid gap-1">詞彙版本（選填）<input className={styles.field} maxLength={100} value={versionInput} onChange={e=>setVersionInput(e.target.value)}/></label>
    <button className={styles.button} disabled={list.kind==='loading'}>套用篩選</button>
   </form>
   {list.kind==='loading'&&<p role="status" className={styles.note}>載入清單…</p>}
   {list.kind==='error'&&<p role="alert" className={styles.note}>{list.message}<button type="button" className="ml-2 underline" onClick={()=>void loadList(page,versionFilter)}>重試</button></p>}
   {list.kind==='ready'&&<ReviewTable rows={rows} selectedId={selectedId} onSelect={select} disabled={busy}/>}
   <div className="flex gap-2"><button type="button" className={styles.button} disabled={page<=1||list.kind==='loading'} onClick={()=>void loadList(page-1,versionFilter)}>上一頁</button><span className={styles.note}>第 {page} 頁（每頁最多 50 筆）</span><button type="button" className={styles.button} disabled={!hasMore||page>=1000||list.kind==='loading'} onClick={()=>void loadList(page+1,versionFilter)}>下一頁</button></div>
  </section>

  {selectedId&&<section className={styles.card+' grid gap-3'} aria-label="覆核明細">
   <h2 className="text-lg font-semibold">覆核明細</h2>
   {detail.kind==='loading'&&<p role="status" className={styles.note}>載入明細…</p>}
   {detail.kind==='error'&&<p role="alert" className={styles.note}>{detail.message}<button type="button" className="ml-2 underline" onClick={()=>void loadDetail(selectedId)}>重試</button></p>}
   {detail.kind==='ready'&&<ReviewDetailView detail={detail.detail}/>}
   {selected?.status==='pending'&&<fieldset disabled={busy} className="grid gap-2">
    <legend className="font-semibold">覆核決定（以修訂 {selected.revision} 為準）</legend>
    <label className="grid gap-1">決定<select className={styles.field} value={decideAction} onChange={e=>{invalidate();setDecideAction(e.target.value==='reject'?'reject':'approve');}}><option value="approve">核准提案（只記錄）</option><option value="reject">駁回提案</option></select></label>
    <label className="grid gap-1">理由（必填，最多 2000 字）<textarea className={styles.field} rows={3} maxLength={MAX_REASON} value={decideReason} onChange={e=>{invalidate();setDecideReason(e.target.value);}}/></label>
    <div><button type="button" className={styles.button} disabled={busy||!!decideProblem||!!pending} onClick={()=>void runPreview('decide')}>預覽決定</button></div>
   </fieldset>}
   {selected&&selected.status!=='pending'&&<p className={styles.note}>此覆核已完成決定；如需不同結論，請另提新提案（保留原紀錄）。</p>}
   {pending&&pending.preview.command.action!=='submit'&&executeBar}
  </section>}

  <section className={styles.card+' grid gap-3'} aria-label="提出保留或排除提案">
   <h2 className="text-lg font-semibold">提出保留／排除提案</h2>
   <p className={styles.note}>先搜尋公開詞彙快照並選擇結果；版本與詞彙鍵會原樣帶入。也可到<a className="mx-1 text-brand-700 underline dark:text-brand-300" href="/vocabulary">原始詞彙池</a>瀏覽。伺服器會解析並保存原始詞彙，預覽時顯示解析結果。提案寫入後只是覆核紀錄，不會立即改變排行或文字比對。</p>
   {!manual&&<div className="grid gap-2">
    <form role="search" className="flex flex-wrap items-end gap-2" onSubmit={e=>{e.preventDefault();if(!busy)void runSearch(vocabQuery);}}>
     <label className="grid flex-1 gap-1">搜尋詞彙<input type="search" className={styles.field} maxLength={VOCABULARY_QUERY_MAX} value={vocabQuery} disabled={busy} onChange={e=>changeQuery(e.target.value)}/></label>
     <button className={styles.button} disabled={busy||vocabSearch.kind==='loading'||vocabularyQuery(vocabQuery)===null}>搜尋</button>
    </form>
    <VocabularyResults state={vocabSearch} selectedKey={chosen?.choice.key??null} onSelect={chooseVocabulary} onRetry={vocabSearch.kind==='idle'||vocabSearch.kind==='loading'?undefined:()=>void runSearch(vocabSearch.query)} disabled={busy}/>
    {chosen?<SelectedVocabulary version={chosen.version} choice={chosen.choice}/>:<p className={styles.note}>尚未選擇詞彙。</p>}
   </div>}
   <div><button type="button" className="text-sm underline" disabled={busy} onClick={()=>setManualMode(!manual)}>{manual?'返回搜尋選擇詞彙':'進階：手動輸入已知快照的精確版本與詞彙鍵'}</button></div>
   <fieldset disabled={busy} className="grid gap-2">
    {manual&&<div className={styles.alert+' grid gap-2'}>
     <p>進階模式：只用於從已知快照<strong>原樣複製</strong>儲存的詞彙版本與詞彙鍵。請勿以顯示文字自行計算雜湊；不符合快照的值會在伺服器預覽時被拒絕。</p>
     <label className="grid gap-1">詞彙版本（原樣複製）<input className={styles.field} maxLength={100} spellCheck={false} autoComplete="off" value={submit.vocabularyVersion} onChange={e=>changeSubmit('vocabularyVersion',e.target.value)}/></label>
     <label className="grid gap-1">詞彙鍵（64 位小寫十六進位，原樣複製）<input className={styles.field+' font-mono'} maxLength={64} spellCheck={false} autoComplete="off" value={submit.termKey} onChange={e=>changeSubmit('termKey',e.target.value)}/></label>
    </div>}
    <label className="grid gap-1">比對規則<select className={styles.field} value={submit.ruleVersion} onChange={e=>changeSubmit('ruleVersion',e.target.value)}>{RULE_VERSIONS.map(v=><option key={v} value={v}>{v}</option>)}</select></label>
    <p className={styles.note}>公開詞彙 API 不提供比對規則；請明確選擇，伺服器預覽會驗證此規則是否與快照一致。</p>
    <label className="grid gap-1">情境<select className={styles.field} value={submit.context} onChange={e=>changeSubmit('context',e.target.value)}>{REVIEW_CONTEXTS.map(v=><option key={v} value={v}>{contextLabels[v]}</option>)}</select></label>
    <label className="grid gap-1">提案<select className={styles.field} value={submit.decision} onChange={e=>changeSubmit('decision',e.target.value)}>{DECISIONS.map(v=><option key={v} value={v}>{decisionLabels[v]}</option>)}</select></label>
    <label className="grid gap-1">理由（必填，最多 2000 字）<textarea className={styles.field} rows={3} maxLength={MAX_REASON} value={submit.reason} onChange={e=>changeSubmit('reason',e.target.value)}/></label>
    {submitProblem&&(chosen||submit.vocabularyVersion||submit.termKey||submit.reason)&&<p className={styles.note}>{submitProblem}</p>}
    <div><button type="button" className={styles.button} disabled={busy||!!submitProblem||!!pending} onClick={()=>void runPreview('submit')}>預覽提案</button></div>
   </fieldset>
   {pending&&pending.preview.command.action==='submit'&&executeBar}
  </section>
 </div>;
}
