import type {ReactNode} from 'react';
import {NOT_APPLIED_NOTICE,VOCABULARY_LIMIT,VOCABULARY_SOURCE,actionLabels,contextLabels,decisionLabels,statusLabels,type KeywordReview,type ReviewDetail,type ReviewExecution,type ReviewPreview,type ReviewStatusInfo,type VocabularyChoice,type VocabularyLookup} from '@/lib/keyword-review-client';
/**
 * Pure presentational pieces for /admin/keywords (no hooks, no fetch), so they render in SSR tests.
 * All values are rendered as React text; no raw HTML and no arbitrary payload/JSON dumps.
 */
export const styles={
 note:'text-sm text-zinc-600 dark:text-zinc-400',
 card:'rounded-lg border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900',
 button:'inline-flex min-h-9 items-center rounded-full border border-zinc-300 px-3 text-sm hover:border-brand-600 disabled:opacity-50 dark:border-zinc-700',
 primary:'inline-flex min-h-9 items-center rounded-full bg-brand-700 px-4 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50 dark:bg-brand-600',
 field:'w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900',
 alert:'rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100',
};
export function NotAppliedBadge(){
 return <p role="note" className="inline-flex items-center gap-2 rounded-full border border-amber-400 bg-amber-50 px-3 py-1 text-sm font-semibold text-amber-900 dark:border-amber-600 dark:bg-amber-950 dark:text-amber-100">{NOT_APPLIED_NOTICE}<span className="font-normal">（原始詞彙與命中證據保留）</span></p>;
}
export type GateState={kind:'loading'}|{kind:'session-error';message:string}|{kind:'login-disabled'}|{kind:'signed-out';loginUrl:string}|{kind:'forbidden'}|{kind:'feature-disabled'}|{kind:'schema-unavailable'}|{kind:'status-error';message:string};
/** Access and feature-gate notices. `action` is an optional retry/login control supplied by the caller. */
export function GateNotice({state,action}:{state:GateState;action?:ReactNode}){
 switch(state.kind){
  case 'loading':return <p role="status" className={styles.note}>載入登入狀態…</p>;
  case 'session-error':return <p role="alert" className={styles.note}>{state.message}{action}</p>;
  case 'login-disabled':return <p className={styles.note}>Google 登入尚未開放；關鍵字覆核只接受 Google 管理員登入，不接受服務權杖。</p>;
  case 'signed-out':return <p className={styles.note}>請先<a className="mx-1 text-brand-700 underline dark:text-brand-300" href={state.loginUrl}>使用 Google 管理員帳號登入</a>後再檢視覆核紀錄。</p>;
  case 'forbidden':return <p role="alert" className={styles.note}>此帳號沒有管理員權限，無法檢視或提出關鍵字覆核。</p>;
  case 'feature-disabled':return <p role="status" className={styles.alert}>關鍵字覆核功能尚未啟用（預設關閉）。啟用前不會讀寫任何覆核紀錄。</p>;
  case 'schema-unavailable':return <p role="status" className={styles.alert}>覆核紀錄資料表尚未就緒，暫時無法讀寫。此狀態不會自動修復或建立資料表。</p>;
  case 'status-error':return <p role="alert" className={styles.note}>{state.message}{action}</p>;
 }
}
export function GateSummary({info}:{info:ReviewStatusInfo}){
 return <p className={styles.note}>覆核功能：{info.status==='ready'?'可讀取':'未就緒'} · 寫入：{info.writeEnabled?'已開放':'未開放（僅能預覽）'} · 階段：只記錄覆核，排行疊加關閉</p>;
}
function Field({label,children}:{label:string;children:ReactNode}){
 return <div className="grid grid-cols-[8rem_1fr] gap-2"><dt className="text-zinc-500 dark:text-zinc-400">{label}</dt><dd className="break-all">{children}</dd></div>;
}
/** Exact stored original term, version/rule/context, decision/status/revision and provenance. */
export function ReviewFields({review}:{review:KeywordReview}){
 const e=review.evidence;
 return <dl className="grid gap-1">
  <Field label="原始詞彙"><strong data-testid="raw-term">{e.rawTerm}</strong></Field>
  <Field label="詞彙版本">{e.vocabularyVersion}</Field>
  <Field label="詞彙鍵"><code>{e.termKey}</code></Field>
  <Field label="比對規則">{e.ruleVersion}</Field>
  <Field label="情境">{contextLabels[review.context]}（{review.context}）</Field>
  <Field label="提案">{decisionLabels[review.decision]}</Field>
  <Field label="狀態">{statusLabels[review.status]} · 修訂 {review.revision}</Field>
  <Field label="套用狀態">{NOT_APPLIED_NOTICE}</Field>
  <Field label="來源">{e.source}</Field>
  <Field label="上游編號">{e.provenance.upstreamId??'（未提供）'}</Field>
  <Field label="媒體">{e.provenance.media.length?e.provenance.media.join('、'):'（未提供）'}</Field>
  <Field label="證據雜湊"><code>{e.sha256}</code></Field>
  <Field label="提案者">{review.submittedBy}</Field>
  <Field label="提案理由"><span className="whitespace-pre-wrap">{review.reason}</span></Field>
  <Field label="建立／更新">{review.createdAt} ／ {review.updatedAt}</Field>
 </dl>;
}
export function ReviewDetailView({detail}:{detail:ReviewDetail}){
 return <div className="grid gap-3">
  <ReviewFields review={detail.review}/>
  <p className={styles.note}>原始詞彙池與命中證據不會被改寫；此快照只保存覆核當下的詞彙資料，並非所有上游文章稽核。</p>
  <h3 className="font-semibold">稽核紀錄（最多 100 筆）</h3>
  {detail.audit.length===0?<p className={styles.note}>沒有稽核紀錄。</p>:<ol className="grid gap-2">{detail.audit.map(a=><li key={a.sequence} className="rounded border border-zinc-200 p-2 dark:border-zinc-800">
   <p>#{a.sequence} · {actionLabels[a.action]} · {a.actor} · {a.createdAt}</p>
   <p>狀態：{a.fromStatus?statusLabels[a.fromStatus]:'（新建）'} → {a.toStatus?statusLabels[a.toStatus]:'（無法辨識）'}</p>
   <p className="whitespace-pre-wrap">理由：{a.reason}</p>
  </li>)}</ol>}
 </div>;
}
export function ReviewTable({rows,selectedId,onSelect,disabled}:{rows:KeywordReview[];selectedId:string|null;onSelect?:(id:string)=>void;disabled?:boolean}){
 if(!rows.length)return <p className={styles.note}>沒有覆核紀錄。</p>;
 return <ul className="grid gap-2">{rows.map(r=><li key={r.id}><button type="button" disabled={disabled} aria-pressed={r.id===selectedId} onClick={()=>onSelect?.(r.id)} className={'w-full rounded-lg border px-3 py-2 text-left text-sm disabled:opacity-50 '+(r.id===selectedId?'border-brand-600 bg-brand-50 dark:bg-zinc-800':'border-zinc-200 dark:border-zinc-800')}>
  <strong>{r.evidence.rawTerm}</strong> · {decisionLabels[r.decision]} · {contextLabels[r.context]} · {statusLabels[r.status]} · 修訂 {r.revision}
  <span className={'block '+styles.note}>{r.evidence.vocabularyVersion} · {r.evidence.ruleVersion} · {r.updatedAt} · 未套用</span>
 </button></li>)}</ul>;
}
export function PreviewView({preview,writeEnabled}:{preview:ReviewPreview;writeEnabled:boolean}){
 const c=preview.command,a=preview.after;
 return <section aria-label="預覽" className={styles.card+' grid gap-2'}>
  <h3 className="font-semibold">預覽：{c.action==='submit'?'提出'+decisionLabels[c.decision]:actionLabels[c.action]+'此提案'}（尚未寫入）</h3>
  <NotAppliedBadge/>
  <p className={styles.note}>伺服器解析結果如下。執行後只會新增覆核紀錄與稽核，不會改變排行、文字比對或原始詞彙池。</p>
  <ReviewFields review={a}/>
  {preview.before&&<p>狀態變更：{statusLabels[preview.before.status]}（修訂 {preview.before.revision}）→ {statusLabels[a.status]}（修訂 {a.revision}）</p>}
  {preview.warnings.map((w,i)=><p role="note" key={i}><strong>{w}</strong></p>)}
  <p className={styles.note}>預覽雜湊：<code>{preview.previewHash.slice(0,16)}…</code> · 請求編號：<code>{c.requestId}</code></p>
  {!writeEnabled&&<p role="status" className={styles.alert}>寫入開關未開放：可以預覽，但無法執行。</p>}
 </section>;
}
export type VocabularySearchState=
 |{kind:'idle'}
 |{kind:'loading';query:string}
 |{kind:'error';query:string;message:string}
 |{kind:'ready';query:string;lookup:VocabularyLookup};
const sourceLink=<a className="text-brand-700 underline dark:text-brand-300" href={VOCABULARY_SOURCE} rel="noopener noreferrer" target="_blank">新文易數 tag.observe.tw</a>;
/** Search result chooser for the public vocabulary snapshot. Rows render as text; selection is by exact key. */
export function VocabularyResults({state,selectedKey,onSelect,onRetry,disabled}:{state:VocabularySearchState;selectedKey:string|null;onSelect?:(choice:VocabularyChoice)=>void;onRetry?:()=>void;disabled?:boolean}){
 switch(state.kind){
  case 'idle':return <p className={styles.note}>輸入詞彙後搜尋目前已發布的公開詞彙快照，再從結果中選擇。</p>;
  case 'loading':return <p role="status" className={styles.note}>正在搜尋「{state.query}」…</p>;
  case 'error':return <p role="alert" className={styles.note}>{state.message}{onRetry&&<button type="button" className="ml-2 underline" onClick={onRetry}>重試搜尋</button>}</p>;
 }
 const l=state.lookup;
 if(l.status==='not-synchronized')return <p role="status" className={styles.alert}>公開詞彙池尚未同步（目前沒有已發布版本），無法從搜尋選擇詞彙。{onRetry&&<button type="button" className="ml-2 underline" onClick={onRetry}>重試搜尋</button>}</p>;
 return <div className="grid gap-2">
  <p className={styles.note}>來源：{sourceLink} · 詞彙版本 <code>{l.version}</code> · 「{state.query}」共 {l.total} 筆{l.total>l.rows.length?`，僅列出前 ${VOCABULARY_LIMIT} 筆，請輸入更精確的詞`:''}{l.upstreamSnapshotConsistent?'':' · 上游快照一致性未確認'}</p>
  {l.rows.length===0?<p className={styles.note}>找不到符合「{state.query}」的詞彙。可改用其他寫法，或到原始詞彙池瀏覽。</p>:
  <ul className="grid gap-1" aria-label="詞彙搜尋結果">{l.rows.map(r=><li key={r.key}><button type="button" disabled={disabled} aria-pressed={r.key===selectedKey} onClick={()=>onSelect?.(r)} className={'w-full rounded-lg border px-3 py-2 text-left text-sm disabled:opacity-50 '+(r.key===selectedKey?'border-brand-600 bg-brand-50 dark:bg-zinc-800':'border-zinc-200 dark:border-zinc-800')}>
   <strong>{r.term}</strong> · {r.articleCount} 篇文章{r.media.length?' · '+r.media.join('、'):''}
   {r.displayExclusion&&<span className={'block '+styles.note}>目前靜態顯示排除：{r.displayExclusion}</span>}
  </button></li>)}</ul>}
 </div>;
}
/** The selected snapshot identity, shown read-only exactly as returned (original term, version, key). */
export function SelectedVocabulary({version,choice}:{version:string;choice:VocabularyChoice}){
 return <div className="grid gap-2 rounded-lg border border-brand-600 p-3" aria-label="已選擇的詞彙">
  <label className="grid gap-1">原始詞彙（唯讀）<input readOnly className={styles.field} value={choice.term}/></label>
  <label className="grid gap-1">詞彙版本（唯讀）<input readOnly className={styles.field+' font-mono'} value={version}/></label>
  <label className="grid gap-1">詞彙鍵（唯讀，快照原樣）<input readOnly className={styles.field+' font-mono'} value={choice.key}/></label>
  <p className={styles.note}>來源：{sourceLink}{choice.upstreamId?` · 上游編號 ${choice.upstreamId}`:''} · {choice.articleCount} 篇文章。版本與詞彙鍵直接取自 API 回應，未在瀏覽器推導。</p>
 </div>;
}
export function ExecutionView({result}:{result:ReviewExecution}){
 return <section role="status" className={styles.card+' grid gap-2'}>
  <h3 className="font-semibold">{result.replayed?'已確認：此請求先前已寫入覆核紀錄（重送未重複建立）':'已寫入覆核紀錄'}</h3>
  <NotAppliedBadge/>
  <p>原始詞彙：<strong>{result.review.evidence.rawTerm}</strong> · {decisionLabels[result.review.decision]} · {statusLabels[result.review.status]} · 修訂 {result.review.revision}</p>
  <p className={styles.note}>此結果只是覆核紀錄；排行與文字比對完全未變更，未來套用需另行授權。</p>
 </section>;
}
