import type {AccountSession} from '../../../shared/account-contracts';
// (Vocabulary lookup below is a separate public read-only helper; it never touches the ops allowlist.)
/**
 * Restricted same-origin client for the review-record-only keyword review API.
 * Local wire contracts only: never import the backend runtime into the client bundle.
 * Every result is a review record; nothing here applies ranking or text matching.
 */
/** Ranking-display approvals feed the ranking overlay; text-matching decisions stay records only. */
export const NOT_APPLIED_NOTICE='排行顯示的已核准決定會套用到熱門標籤排行；文字比對決定只記錄，尚未套用';
export const REVIEW_CONTEXTS=['youtube-ranking-display','youtube-text-matching'] as const;
export const RULE_VERSIONS=['exact-text-v1','youtube-quality-v2'] as const;
export const DECISIONS=['keep','exclude'] as const;
export const REVIEW_STATUSES=['pending','approved','rejected'] as const;
export const AUDIT_ACTIONS=['submit','approve','reject'] as const;
export type ReviewContext=typeof REVIEW_CONTEXTS[number];
export type RuleVersion=typeof RULE_VERSIONS[number];
export type Decision=typeof DECISIONS[number];
export type ReviewStatus=typeof REVIEW_STATUSES[number];
export type AuditAction=typeof AUDIT_ACTIONS[number];
export const contextLabels:Record<ReviewContext,string>={'youtube-ranking-display':'YouTube 排行顯示','youtube-text-matching':'YouTube 文字比對'};
export const decisionLabels:Record<Decision,string>={keep:'提案保留',exclude:'提案排除'};
export const statusLabels:Record<ReviewStatus,string>={pending:'待覆核',approved:'已核准',rejected:'已駁回'};
export const actionLabels:Record<AuditAction,string>={submit:'提出提案',approve:'核准',reject:'駁回'};
export const REVIEW_LIMIT=50,AUDIT_LIMIT=100,MAX_REASON=2000,MAX_PAGE=1000;
const BASE='/api/ops/keyword-reviews';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const VERSION=/^[A-Za-z0-9_-]{1,100}$/,TERM_KEY=/^[a-f0-9]{64}$/,HASH=/^[a-f0-9]{64}$/;
const UNSAFE_CONTROL=/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export interface Provenance {upstreamId:string|null;media:string[]}
export interface ReviewEvidence {vocabularyVersion:string;termKey:string;rawTerm:string;ruleVersion:RuleVersion;source:'https://tag.observe.tw';sha256:string;provenance:Provenance}
export interface KeywordReview {id:string;revision:number;status:ReviewStatus;decision:Decision;context:ReviewContext;evidence:ReviewEvidence;submittedBy:string;reason:string;applied:false;applicationStatus:'not-applied';createdAt:string;updatedAt:string}
export interface AuditRow {sequence:string;requestId:string;actor:string;action:AuditAction;reason:string;fromStatus:ReviewStatus|null;toStatus:ReviewStatus|null;createdAt:string}
export interface ReviewStatusInfo {enabled:boolean;writeEnabled:boolean;schemaReady:boolean;status:'disabled'|'schema-unavailable'|'ready';phase:'review-record-only';applied:false;applicationStatus:'not-applied';rankingOverlayEnabled:false}
export interface ReviewList {rows:KeywordReview[];page:number;hasMore:boolean;applied:false;applicationStatus:'not-applied'}
export interface ReviewDetail {review:KeywordReview;audit:AuditRow[]}
export type SubmitCommand={requestId:string;id:string;action:'submit';reason:string;vocabularyVersion:string;termKey:string;ruleVersion:RuleVersion;context:ReviewContext;decision:Decision};
export type DecideCommand={requestId:string;id:string;action:'approve'|'reject';reason:string;expectedRevision:number};
export type ReviewCommand=SubmitCommand|DecideCommand;
export interface ReviewPreview {command:ReviewCommand;before:KeywordReview|null;after:KeywordReview;previewHash:string;warnings:string[];writes:0;applied:false;applicationStatus:'not-applied'}
export interface ReviewExecution {review:KeywordReview;requestId:string;replayed:boolean;applied:false;applicationStatus:'not-applied'}

export const keywordReviewMessages:Record<string,string>={
 KEYWORD_REVIEW_DISABLED:'關鍵字覆核功能尚未啟用。',
 KEYWORD_REVIEW_SCHEMA_UNAVAILABLE:'覆核紀錄資料表尚未就緒，暫時無法讀寫。',
 KEYWORD_REVIEW_UNAVAILABLE:'覆核服務暫時無法使用，請稍後重試。',
 KEYWORD_REVIEW_WRITE_DISABLED:'目前未開放寫入覆核紀錄；仍可預覽，但不能執行。',
 INVALID_REVIEW_COMMAND:'覆核內容不完整：請確認理由（1–2000 字、無控制字元）後重新預覽。',
 INVALID_REVIEW_TARGET:'詞彙版本、詞彙鍵、比對規則、情境或決定格式不正確。',
 INVALID_REVIEW_QUERY:'清單查詢條件不正確，請檢查詞彙版本。',
 INVALID_REVIEW_ID:'覆核編號格式不正確。',
 INVALID_REVIEW_REQUEST:'覆核請求格式不正確，請重新預覽。',
 REVISION_REQUIRED:'請先載入覆核紀錄的目前修訂版本。',
 ADMIN_ACTOR_REQUIRED:'需要 Google 管理員登入身分才能操作。',
 REVIEW_EXISTS:'此覆核編號已存在，請重新預覽。',
 REVIEW_SOURCE_CHANGED:'找不到該詞彙版本中的原始詞彙，或來源已變更；請核對後重新預覽。',
 REVIEW_SOURCE_INVALID:'詞彙來源快照無法驗證。',
 REVIEW_NOT_FOUND:'找不到這筆覆核紀錄，請重新載入清單。',
 REVISION_CONFLICT:'覆核紀錄已被更新，請重新載入後再預覽。',
 REVIEW_ALREADY_DECIDED:'這筆覆核已完成決定，請重新載入。',
 PREVIEW_REQUIRED:'請先預覽，再執行。',
 PREVIEW_CHANGED:'預覽內容已變更（狀態、證據或操作身分），請重新載入後再預覽。',
 REQUEST_ID_CONFLICT:'此請求編號已用於另一項內容，請重新預覽。',
 REVIEW_CONFLICT:'覆核紀錄發生衝突，請重新載入後再預覽。',
 REVIEW_WRITER_BUSY:'另一項覆核正在寫入，請稍後以相同請求重試。',
 REVIEW_EVIDENCE_TOO_LARGE:'此詞彙證據過大，無法建立覆核紀錄。',
 REVIEW_STORED_STATE_INVALID:'既有覆核紀錄無法驗證，請聯絡系統管理員。',
 REVIEW_STATE_SCHEMA_REQUIRED:'覆核紀錄資料表尚未設定。',
 REVIEW_STATE_SCHEMA_MISMATCH:'覆核紀錄資料表設定不一致。',
 AUTH_DISABLED:'登入功能尚未開放。',
 SIGN_IN_REQUIRED:'登入已過期，請重新登入後再試。',
 ADMIN_REQUIRED:'此帳號沒有管理員權限。',
 CSRF_REJECTED:'同源驗證（CSRF）未通過，請重新整理頁面後再試。',
 SESSION_AUTH_REQUIRED:'請使用 Google 管理員帳號登入；不接受服務權杖。',
 FORBIDDEN:'沒有權限執行此操作（管理員身分、同源驗證或寫入開關）。',
 RATE_LIMITED:'操作較頻繁，請稍候再試。',
 INVALID_CLIENT_REQUEST:'請求不在允許的覆核端點內。',
 INVALID_INPUT:'請檢查輸入內容。',
 MALFORMED_RESPONSE:'伺服器回應格式無法驗證，已停止顯示以免誤導。',
 VOCABULARY_QUERY_INVALID:'請輸入 1–100 字的搜尋詞（不可包含控制字元）。',
 VOCABULARY_UNAVAILABLE:'公開詞彙 API 目前無法使用（開發環境未提供 /api/v1/vocabulary，或服務暫時中斷）。請稍後重試。',
 VOCABULARY_RATE_LIMITED:'詞彙查詢較頻繁，請稍候再重試。',
 VOCABULARY_MALFORMED:'詞彙 API 回應格式無法驗證，已停止顯示以免誤選。',
 NETWORK_ERROR:'無法連線至覆核服務，請稍後重試。',
 ABORTED:'請求已取消。',
 INVALID_RANKING_DECISION:'排行決定的內容不正確（詞彙或理由格式）。',
 TERM_NOT_IN_VOCABULARY:'目前詞彙版本找不到這個詞，無法排除。',
 NOTHING_TO_RESTORE:'這個詞目前沒有被管理員排除。',
};
const GENERIC='覆核操作暫時無法完成，請稍後重試。';
export class KeywordReviewError extends Error{
 constructor(public readonly code:string,public readonly status=0,public readonly uncertain=false){super(keywordReviewMessages[code]??GENERIC);}
}
export const keywordReviewMessage=(error:unknown)=>error instanceof KeywordReviewError?error.message:GENERIC;

/** Fixed endpoint allowlist; mirrors the dev bridge and the Fastify routes exactly. */
export function isKeywordReviewEndpoint(target:string,method:string):boolean{
 if(typeof target!=='string'||target.length>300||!target.startsWith(BASE))return false;
 const [path,query,...rest]=target.split('?');if(rest.length)return false;
 if(path===BASE+'/ranking-display')return query===undefined&&(method==='POST'||method==='GET');
 if(method==='POST')return query===undefined&&(path===BASE+'/preview'||path===BASE+'/execute');
 if(method!=='GET')return false;
 if(path===BASE+'/status'||UUID.test(path.slice(BASE.length+1))&&path===BASE+'/'+path.slice(BASE.length+1))return query===undefined;
 if(path!==BASE||query===undefined)return false;
 const params=new URLSearchParams(query),keys=[...params.keys()];
 if(keys.some(k=>k!=='page'&&k!=='version')||params.getAll('page').length!==1||params.getAll('version').length>1)return false;
 const page=params.get('page')!;if(!/^[1-9]\d{0,3}$/.test(page)||Number(page)>MAX_PAGE)return false;
 const version=params.get('version');return version===null||VERSION.test(version);
}
export function listPath(page:number,version?:string){
 if(!Number.isSafeInteger(page)||page<1||page>MAX_PAGE)throw new KeywordReviewError('INVALID_INPUT');
 const params=new URLSearchParams({page:String(page)});
 if(version){if(!VERSION.test(version))throw new KeywordReviewError('INVALID_REVIEW_QUERY');params.set('version',version);}
 return BASE+'?'+params;
}

type Fetcher=typeof fetch;
interface RequestOptions {session?:AccountSession|null;body?:unknown;signal?:AbortSignal;fetcher?:Fetcher;timeoutMs?:number;uncertainOnFailure?:boolean}
/** Low-level call; rejects any path/method outside the fixed allowlist before fetching. */
export async function keywordReviewFetch(target:string,method:'GET'|'POST',options:RequestOptions={}):Promise<unknown>{
 if(!isKeywordReviewEndpoint(target,method))throw new KeywordReviewError('INVALID_CLIENT_REQUEST');
 const post=method==='POST';
 if(post&&(!options.session?.user||!options.session.csrfToken))throw new KeywordReviewError('SIGN_IN_REQUIRED',401);
 if(post&&options.body===undefined)throw new KeywordReviewError('INVALID_CLIENT_REQUEST');
 const timeout=AbortSignal.timeout(options.timeoutMs??15000);
 const signal=options.signal?AbortSignal.any([options.signal,timeout]):timeout;
 const headers:Record<string,string>={Accept:'application/json'};
 if(post){headers['x-csrf-token']=options.session!.csrfToken!;headers['Content-Type']='application/json';}
 const uncertain=!!options.uncertainOnFailure;
 let response:Response;
 try{response=await(options.fetcher??fetch)(target,{method,credentials:'same-origin',cache:'no-store',redirect:'error',signal,headers,...(post?{body:JSON.stringify(options.body)}:{})});}
 catch{if(options.signal?.aborted)throw new KeywordReviewError('ABORTED',0,uncertain);throw new KeywordReviewError('NETWORK_ERROR',0,uncertain);}
 let value:unknown=null;try{value=await response.json();}catch{value=null;}
 if(!response.ok){
  const raw=(value as {error?:{code?:unknown}}|null)?.error?.code;
  const known=typeof raw==='string'&&raw.length<=64&&Object.hasOwn(keywordReviewMessages,raw)?raw:null;
  const code=known??(response.status===401?'SIGN_IN_REQUIRED':response.status===403?'FORBIDDEN':response.status===429?'RATE_LIMITED':'KEYWORD_REVIEW_UNAVAILABLE');
  // 4xx is a definitive refusal; 5xx after a write attempt may still have committed.
  throw new KeywordReviewError(code,response.status,uncertain&&response.status>=500);
 }
 if(value===null||typeof value!=='object'||Array.isArray(value))throw new KeywordReviewError('MALFORMED_RESPONSE',response.status,uncertain);
 return value;
}

// ---------- runtime validation: fail closed on anything unexpected ----------
const isObject=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const malformed=():never=>{throw new KeywordReviewError('MALFORMED_RESPONSE');};
const str=(v:unknown,max:number):string=>typeof v==='string'&&v.length<=max?v:malformed();
const oneOf=<T extends string>(v:unknown,list:readonly T[]):T=>typeof v==='string'&&(list as readonly string[]).includes(v)?v as T:malformed();
const bool=(v:unknown)=>typeof v==='boolean'?v:malformed();
const notApplied=(v:Record<string,unknown>)=>{if(v.applied!==false||v.applicationStatus!=='not-applied')malformed();};
function provenance(payload:unknown):Provenance{
 if(!isObject(payload))return {upstreamId:null,media:[]};
 const id=payload.upstreamId,media=payload.media;
 const upstreamId=typeof id==='string'&&id.length<=200?id:typeof id==='number'&&Number.isSafeInteger(id)?String(id):null;
 const list=typeof media==='string'?[media]:Array.isArray(media)?media:[];
 return {upstreamId,media:list.filter((m):m is string=>typeof m==='string'&&m.length<=200).slice(0,20)};
}
export function parseReview(v:unknown):KeywordReview{
 if(!isObject(v))return malformed();
 notApplied(v);
 const e=v.evidence;if(!isObject(e))return malformed();
 if(typeof v.revision!=='number'||!Number.isSafeInteger(v.revision)||v.revision<1)malformed();
 if(e.source!=='https://tag.observe.tw')malformed();
 const evidence:ReviewEvidence={vocabularyVersion:str(e.vocabularyVersion,100),termKey:str(e.termKey,64),rawTerm:str(e.rawTerm,1000),ruleVersion:oneOf(e.ruleVersion,RULE_VERSIONS),source:'https://tag.observe.tw',sha256:str(e.sha256,64),provenance:provenance(e.payload)};
 if(!VERSION.test(evidence.vocabularyVersion)||!TERM_KEY.test(evidence.termKey)||!HASH.test(evidence.sha256))malformed();
 const id=str(v.id,36);if(!UUID.test(id))malformed();
 return {id,revision:v.revision as number,status:oneOf(v.status,REVIEW_STATUSES),decision:oneOf(v.decision,DECISIONS),context:oneOf(v.context,REVIEW_CONTEXTS),evidence,submittedBy:str(v.submittedBy,100),reason:str(v.reason,MAX_REASON),applied:false,applicationStatus:'not-applied',createdAt:str(v.createdAt,40),updatedAt:str(v.updatedAt,40)};
}
const snapshotStatus=(v:unknown):ReviewStatus|null=>isObject(v)&&typeof v.status==='string'&&(REVIEW_STATUSES as readonly string[]).includes(v.status)?v.status as ReviewStatus:null;
function parseAudit(v:unknown):AuditRow{
 if(!isObject(v))return malformed();
 const sequence=typeof v.sequence==='number'&&Number.isSafeInteger(v.sequence)?String(v.sequence):typeof v.sequence==='string'&&/^\d{1,20}$/.test(v.sequence)?v.sequence:malformed();
 const requestId=str(v.request_id,36);if(!UUID.test(requestId))malformed();
 return {sequence,requestId,actor:str(v.actor,100),action:oneOf(v.action,AUDIT_ACTIONS),reason:str(v.reason,MAX_REASON),fromStatus:snapshotStatus(v.before),toStatus:snapshotStatus(v.after),createdAt:str(v.created_at,40)};
}
export function parseStatus(v:unknown):ReviewStatusInfo{
 if(!isObject(v))return malformed();notApplied(v);
 if(v.phase!=='review-record-only'||v.rankingOverlayEnabled!==false)malformed();
 const info:ReviewStatusInfo={enabled:bool(v.enabled),writeEnabled:bool(v.writeEnabled),schemaReady:bool(v.schemaReady),status:oneOf(v.status,['disabled','schema-unavailable','ready'] as const),phase:'review-record-only',applied:false,applicationStatus:'not-applied',rankingOverlayEnabled:false};
 // Fail closed on internally inconsistent gates.
 if(info.writeEnabled&&!info.enabled||info.status==='ready'&&!(info.enabled&&info.schemaReady))malformed();
 return info;
}
export function parseList(v:unknown):ReviewList{
 if(!isObject(v)||!Array.isArray(v.rows)||v.rows.length>REVIEW_LIMIT)return malformed();notApplied(v);
 if(typeof v.page!=='number'||!Number.isSafeInteger(v.page)||v.page<1)malformed();
 return {rows:v.rows.map(parseReview),page:v.page as number,hasMore:bool(v.hasMore),applied:false,applicationStatus:'not-applied'};
}
export function parseDetail(v:unknown):ReviewDetail{
 if(!isObject(v)||!Array.isArray(v.audit)||v.audit.length>AUDIT_LIMIT)return malformed();
 return {review:parseReview(v.review),audit:v.audit.map(parseAudit)};
}
function sameCommand(a:unknown,b:ReviewCommand):boolean{
 if(!isObject(a))return false;
 const keys=Object.keys(b) as (keyof ReviewCommand)[];
 return Object.keys(a).length===keys.length&&keys.every(k=>a[k]===(b as Record<string,unknown>)[k]);
}
export function parsePreview(v:unknown,sent:ReviewCommand):ReviewPreview{
 if(!isObject(v)||v.mode!=='preview'||v.writes!==0)return malformed();notApplied(v);
 // The server echoes the normalized command; it must be exactly what we sent (reason is pre-trimmed).
 if(!sameCommand(v.command,sent))malformed();
 if(!Array.isArray(v.warnings)||v.warnings.length>10)malformed();
 const previewHash=str(v.previewHash,64);if(!HASH.test(previewHash))malformed();
 const after=parseReview(v.after),before=v.before===null?null:parseReview(v.before);
 if(after.id!==sent.id)malformed();
 return {command:sent,before,after,previewHash,warnings:(v.warnings as unknown[]).map(w=>str(w,500)),writes:0,applied:false,applicationStatus:'not-applied'};
}
export function parseExecution(v:unknown,sent:ReviewCommand):ReviewExecution{
 if(!isObject(v)||v.mode!=='execute')return malformed();notApplied(v);
 const review=parseReview(v.review),requestId=str(v.requestId,36);
 if(requestId!==sent.requestId||review.id!==sent.id)malformed();
 return {review,requestId,replayed:bool(v.replayed),applied:false,applicationStatus:'not-applied'};
}

// ---------- typed endpoint helpers ----------
type Call={signal?:AbortSignal;fetcher?:Fetcher};
export const fetchReviewStatus=async(o:Call={})=>parseStatus(await keywordReviewFetch(BASE+'/status','GET',o));
export const fetchReviewList=async(page:number,version:string|undefined,o:Call={})=>parseList(await keywordReviewFetch(listPath(page,version),'GET',o));
export async function fetchReviewDetail(id:string,o:Call={}){if(!UUID.test(id))throw new KeywordReviewError('INVALID_REVIEW_ID');return parseDetail(await keywordReviewFetch(BASE+'/'+id,'GET',o));}
export async function previewReviewCommand(command:ReviewCommand,session:AccountSession|null,o:Call={}){
 validateCommand(command);
 return parsePreview(await keywordReviewFetch(BASE+'/preview','POST',{...o,session,body:{command}}),command);
}
/** Executes EXACTLY the previewed command and hash. Failures that may have committed are marked uncertain. */
export async function executeReviewCommand(preview:Pick<ReviewPreview,'command'|'previewHash'>,session:AccountSession|null,o:Call={}){
 validateCommand(preview.command);if(!HASH.test(preview.previewHash))throw new KeywordReviewError('PREVIEW_REQUIRED');
 const value=await keywordReviewFetch(BASE+'/execute','POST',{...o,session,uncertainOnFailure:true,body:{command:preview.command,previewHash:preview.previewHash,execute:true}});
 try{return parseExecution(value,preview.command);}catch(e){if(e instanceof KeywordReviewError)throw new KeywordReviewError(e.code,200,true);throw e;}
}

// ---------- one-click ranking display decisions ----------
export interface RankingDisplayEntry {termKey:string;term:string;reviewId:string;vocabularyVersion:string;decidedBy:string;decidedAt:string;reason:string}
export interface RankingDecisionResult {decision:Decision;changed:boolean;results:{term:string;status:'decided'|'unchanged'|'replayed'}[]}
export function parseRankingDisplay(v:unknown):RankingDisplayEntry[]{
 if(!isObject(v)||!Array.isArray(v.rows)||v.rows.length>20000)return malformed();
 return v.rows.map(r=>{if(!isObject(r)||!TERM_KEY.test(String(r.termKey))||!UUID.test(String(r.reviewId)))malformed();const row=r as Record<string,unknown>;
  return {termKey:str(row.termKey,64),term:str(row.term,240),reviewId:str(row.reviewId,36),vocabularyVersion:str(row.vocabularyVersion,100),decidedBy:str(row.decidedBy,100),decidedAt:str(row.decidedAt,40),reason:str(row.reason,MAX_REASON)};});
}
export function parseRankingDecision(v:unknown,terms:string[]):RankingDecisionResult{
 if(!isObject(v)||!Array.isArray(v.results)||v.results.length!==terms.length)return malformed();
 const results=v.results.map((r,i)=>{if(!isObject(r)||r.term!==terms[i])malformed();return {term:terms[i]!,status:oneOf((r as Record<string,unknown>).status,['decided','unchanged','replayed'] as const)};});
 return {decision:oneOf(v.decision,DECISIONS),changed:bool(v.changed),results};
}
export const fetchRankingDisplay=async(o:Call={})=>parseRankingDisplay(await keywordReviewFetch(BASE+'/ranking-display','GET',o));
/** Submit+approve in one server transaction for every exact label of a ranking row. */
export async function decideRankingDisplay(terms:string[],decision:Decision,session:AccountSession|null,reason='',o:Call&{newId?:()=>string}={}){
 if(!terms.length||terms.length>20||reasonProblem(reason||'x'))throw new KeywordReviewError('INVALID_RANKING_DECISION');
 const body={requestId:(o.newId??(()=>crypto.randomUUID()))(),terms,decision,...(reason.trim()?{reason:reason.trim()}:{})};
 return parseRankingDecision(await keywordReviewFetch(BASE+'/ranking-display','POST',{...o,session,uncertainOnFailure:true,body}),terms);
}

// ---------- public read-only vocabulary lookup (separate from the restricted ops helper) ----------
/**
 * The ONLY public endpoint this module reads. Production Fastify serves it directly; there is
 * deliberately no Next dev bridge, so in unsupported dev setups the lookup reports unavailable.
 * GET only, no cookies (credentials:'omit'), no CSRF, no Authorization, no caller-chosen target/base.
 */
export const VOCABULARY_ENDPOINT='/api/v1/vocabulary';
export const VOCABULARY_LIMIT=20,VOCABULARY_QUERY_MAX=100,VOCABULARY_SOURCE='https://tag.observe.tw' as const;
const VOCAB_TERM_MAX=240,VOCAB_MEDIA_MAX=10;
export interface VocabularyChoice {key:string;term:string;articleCount:number;media:string[];upstreamId:string|null;displayExclusion:string|null}
export type VocabularyLookup=
 |{status:'not-synchronized';version:null;rows:VocabularyChoice[];total:number;source:typeof VOCABULARY_SOURCE}
 |{status:'synchronized';version:string;rows:VocabularyChoice[];total:number;source:typeof VOCABULARY_SOURCE;upstreamSnapshotConsistent:boolean};
/** Trimmed query or null when it cannot be sent (empty, too long, control characters). */
export function vocabularyQuery(input:string):string|null{
 if(typeof input!=='string')return null;const q=input.trim();
 return q&&q.length<=VOCABULARY_QUERY_MAX&&!/[\u0000-\u001f\u007f]/.test(q)?q:null;
}
/** Fixed URL builder: only the query text varies; limit is always 20. */
export function vocabularyLookupUrl(input:string):string{
 const q=vocabularyQuery(input);if(q===null)throw new KeywordReviewError('VOCABULARY_QUERY_INVALID');
 return VOCABULARY_ENDPOINT+'?q='+encodeURIComponent(q)+'&limit='+VOCABULARY_LIMIT;
}
const vocabMalformed=():never=>{throw new KeywordReviewError('VOCABULARY_MALFORMED');};
function vocabRow(v:unknown):VocabularyChoice{
 if(!isObject(v))return vocabMalformed();
 const {key,term,articleCount,media,upstreamId,displayExclusion}=v;
 // Exact stored identity: key must already be the review contract's 64-hex key; never derived here.
 if(typeof key!=='string'||!TERM_KEY.test(key))vocabMalformed();
 if(typeof term!=='string'||!term.length||term.length>VOCAB_TERM_MAX)vocabMalformed();
 if(typeof articleCount!=='number'||!Number.isSafeInteger(articleCount)||articleCount<0)vocabMalformed();
 if(!Array.isArray(media))vocabMalformed();
 if(upstreamId!==undefined&&upstreamId!==null&&(typeof upstreamId!=='string'||upstreamId.length>200))vocabMalformed();
 if(displayExclusion!==undefined&&displayExclusion!==null&&(typeof displayExclusion!=='string'||displayExclusion.length>200))vocabMalformed();
 return {key:key as string,term:term as string,articleCount:articleCount as number,
  media:(media as unknown[]).filter((m):m is string=>typeof m==='string'&&m.length>0&&m.length<=200).slice(0,VOCAB_MEDIA_MAX),
  upstreamId:typeof upstreamId==='string'?upstreamId:null,displayExclusion:typeof displayExclusion==='string'?displayExclusion:null};
}
/** Validates the public {data,meta} envelope; fails closed on anything unexpected. */
export function parseVocabularyLookup(v:unknown):VocabularyLookup{
 if(!isObject(v)||!isObject(v.data)||!isObject(v.meta)||v.meta.schemaVersion!==1)return vocabMalformed();
 const d=v.data;
 if(d.source!==VOCABULARY_SOURCE||!Array.isArray(d.rows)||d.rows.length>VOCABULARY_LIMIT)return vocabMalformed();
 if(typeof d.total!=='number'||!Number.isSafeInteger(d.total)||d.total<d.rows.length)vocabMalformed();
 if(d.version===null){
  if(d.rows.length)vocabMalformed();
  return {status:'not-synchronized',version:null,rows:[],total:0,source:VOCABULARY_SOURCE};
 }
 if(typeof d.version!=='string'||!VERSION.test(d.version))vocabMalformed();
 const rows=(d.rows as unknown[]).map(vocabRow);
 if(new Set(rows.map(r=>r.key)).size!==rows.length)vocabMalformed();
 return {status:'synchronized',version:d.version as string,rows:rows.slice(0,VOCABULARY_LIMIT),total:d.total as number,source:VOCABULARY_SOURCE,upstreamSnapshotConsistent:d.upstreamSnapshotConsistent===true};
}
/** Public read-only lookup. Not routed through keywordReviewFetch and never carries session credentials. */
export async function lookupVocabulary(input:string,o:{signal?:AbortSignal;fetcher?:Fetcher;timeoutMs?:number}={}):Promise<VocabularyLookup>{
 const url=vocabularyLookupUrl(input);
 const timeout=AbortSignal.timeout(o.timeoutMs??10000);
 const signal=o.signal?AbortSignal.any([o.signal,timeout]):timeout;
 let response:Response;
 try{response=await(o.fetcher??fetch)(url,{method:'GET',credentials:'omit',cache:'no-store',redirect:'error',signal,headers:{Accept:'application/json'}});}
 catch{if(o.signal?.aborted)throw new KeywordReviewError('ABORTED');throw new KeywordReviewError('VOCABULARY_UNAVAILABLE');}
 if(!response.ok)throw new KeywordReviewError(response.status===429?'VOCABULARY_RATE_LIMITED':response.status===400?'VOCABULARY_QUERY_INVALID':'VOCABULARY_UNAVAILABLE',response.status);
 let value:unknown;try{value=await response.json();}catch{throw new KeywordReviewError('VOCABULARY_MALFORMED',response.status);}
 return parseVocabularyLookup(value);
}
/** Fills the proposal target with the EXACT returned snapshot identity (no hashing, no normalization). */
export function applyVocabularyChoice(input:SubmitInput,lookup:VocabularyLookup,choice:VocabularyChoice):SubmitInput{
 if(lookup.status!=='synchronized'||!lookup.rows.some(r=>r.key===choice.key&&r.term===choice.term))throw new KeywordReviewError('INVALID_INPUT');
 return {...input,vocabularyVersion:lookup.version,termKey:choice.key};
}

// ---------- command construction (client-side checks mirror server rules) ----------
export function reasonProblem(reason:string):string|null{
 const t=reason.trim();if(!t)return '請填寫理由。';if(reason.length>MAX_REASON)return '理由最多 2000 字。';if(UNSAFE_CONTROL.test(reason))return '理由不可包含控制字元。';return null;
}
export function validateCommand(c:ReviewCommand):void{
 if(!isObject(c)||!UUID.test(c.id)||!UUID.test(c.requestId)||reasonProblem(c.reason)||c.reason!==c.reason.trim())throw new KeywordReviewError('INVALID_REVIEW_COMMAND');
 if(c.action==='submit'){
  if(!VERSION.test(c.vocabularyVersion)||!TERM_KEY.test(c.termKey)||!(RULE_VERSIONS as readonly string[]).includes(c.ruleVersion)||!(REVIEW_CONTEXTS as readonly string[]).includes(c.context)||!(DECISIONS as readonly string[]).includes(c.decision))throw new KeywordReviewError('INVALID_REVIEW_TARGET');
 }else if(c.action==='approve'||c.action==='reject'){if(!Number.isSafeInteger(c.expectedRevision)||c.expectedRevision<1)throw new KeywordReviewError('REVISION_REQUIRED');}
 else throw new KeywordReviewError('INVALID_REVIEW_COMMAND');
}
export interface SubmitInput {vocabularyVersion:string;termKey:string;ruleVersion:string;context:string;decision:string;reason:string}
export function submitInputProblem(i:SubmitInput):string|null{
 if(!VERSION.test(i.vocabularyVersion))return '詞彙版本需為 1–100 個英數字、底線或連字號。';
 if(!TERM_KEY.test(i.termKey))return '詞彙鍵需為 64 個小寫十六進位字元。';
 if(!(RULE_VERSIONS as readonly string[]).includes(i.ruleVersion))return '請選擇比對規則。';
 if(!(REVIEW_CONTEXTS as readonly string[]).includes(i.context))return '請選擇套用情境。';
 if(!(DECISIONS as readonly string[]).includes(i.decision))return '請選擇保留或排除。';
 return reasonProblem(i.reason);
}
export function buildSubmitCommand(i:SubmitInput,newId:()=>string):SubmitCommand{
 if(submitInputProblem(i))throw new KeywordReviewError('INVALID_INPUT');
 return {requestId:newId(),id:newId(),action:'submit',reason:i.reason.trim(),vocabularyVersion:i.vocabularyVersion,termKey:i.termKey,ruleVersion:i.ruleVersion as RuleVersion,context:i.context as ReviewContext,decision:i.decision as Decision};
}
export function buildDecideCommand(review:Pick<KeywordReview,'id'|'revision'|'status'>,action:'approve'|'reject',reason:string,newId:()=>string):DecideCommand{
 if(review.status!=='pending'||reasonProblem(reason))throw new KeywordReviewError('INVALID_INPUT');
 return {requestId:newId(),id:review.id,action,reason:reason.trim(),expectedRevision:review.revision};
}
/** True when an error means the caller must reload state and preview again. */
export const needsRepreview=(e:unknown)=>e instanceof KeywordReviewError&&['PREVIEW_CHANGED','REVISION_CONFLICT','REVIEW_ALREADY_DECIDED','REQUEST_ID_CONFLICT','REVIEW_EXISTS','REVIEW_SOURCE_CHANGED','REVIEW_CONFLICT','REVIEW_NOT_FOUND'].includes(e.code);
