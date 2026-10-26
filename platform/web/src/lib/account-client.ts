import type {AccountSession} from '../../../shared/account-contracts';
export const accountMessages:Record<string,string>={
 PREVIEW_CHANGED:'來源或操作身分已變更，請重新載入後再預覽。',
 EXECUTION_GATED:'目前未開放執行此異動；預覽不會寫入資料。',
 REQUEST_ID_CONFLICT:'此請求編號已用於另一項異動，請重新載入後再預覽。',
 EVENT_MERGED:'此事件已合併，請重新載入並選擇合併後的事件。',
 TARGET_MERGED:'目標事件已合併，請重新載入並選擇合併後的事件。',
 EVENT_NOT_FOUND:'找不到這個事件，請重新載入清單。',
 TARGET_NOT_FOUND:'找不到目標事件，請重新載入清單。',
 EVENT_EXISTS:'這個事件已經存在，請重新載入確認結果。',
 TARGET_EXISTS:'目標事件已經存在，請重新載入確認結果。',
 CANDIDATE_EXISTS:'這個頻道已有提名紀錄，請重新載入清單。',
 CANDIDATE_NOT_FOUND:'找不到這筆頻道提名，請重新載入清單。',
 CANDIDATE_ALREADY_DECIDED:'這筆頻道提名已完成審核，請重新載入清單。',
 SOURCE_NOT_FOUND:'找不到引用來源，請確認來源類型與編號。',
 SOURCE_NOT_FOUND_OR_AMBIGUOUS:'無法唯一辨識引用來源，請確認來源類型與編號。',
 DAILY_EVENT_NOT_FOUND:'找不到指定的每日分析事件，請確認資料編號與事件順序。',
 SOURCE_ALREADY_LINKED:'此來源已經加入事件，請重新載入確認。',
 SOURCE_NOT_IN_EVENT:'所選來源已不在事件中，請重新載入後再預覽。',
 REFRESH_SOURCE_NOT_LINKED:'只能更新此事件已引用的來源，請重新載入確認。',
 REFRESH_UNCHANGED:'已引用的來源快照沒有變更。',
 SOURCE_IDENTITY_CONFLICT:'來源身分與既有引用不一致，請重新核對來源。',
 SOURCE_REFERENCE_MISSING:'來源引用已不存在，請重新載入後再預覽。',
 ARTICLE_PROVENANCE_REQUIRED:'新聞來源需要快照版本、原始標題與網址。',
 ARTICLE_SNAPSHOT_NOT_FOUND:'找不到指定的新聞來源快照，請確認版本與文章編號。',
 ARTICLE_SNAPSHOT_INVALID:'新聞來源快照無法驗證，請重新確認來源版本。',
 INVALID_TITLE:'請填寫有效的事件或頻道名稱。',
 INVALID_COMMAND:'異動內容不完整，請核對欄位後重新預覽。',
 INVALID_SOURCE:'引用來源格式無法辨識，請核對來源欄位。',
 INVALID_SOURCE_ID:'引用來源編號無法辨識，請重新核對。',
 INVALID_SOURCE_URL:'請填寫有效的原始報導網址。',
 INVALID_SPLIT_SELECTION:'請選擇要移至新事件的來源。',
 DUPLICATE_SOURCE:'引用來源重複，請移除重複項目。',
 SOURCE_LIMIT:'請加入 1 至 25 個來源，再進行預覽。',
 EVENT_SOURCE_CAP:'事件的來源數已達上限，請先檢查事件範圍。',
 VERSION_REQUIRED:'請先載入目前版本，再預覽異動。',
 ACTOR_NOT_CONFIGURED:'管理操作身分尚未設定，請聯絡系統管理員。',
PREVIEW_REQUIRED:'請先預覽異動。',WRITE_DISABLED:'目前未開放執行異動。',VERSION_CONFLICT:'來源版本已變更，請重新載入並預覽。',PREVIEW_MISMATCH:'預覽已失效，請重新預覽。',SIGN_IN_REQUIRED:'請重新登入後再試。',ADMIN_REQUIRED:'這項功能需要管理員身分。',CSRF_REJECTED:'登入狀態已更新，請重新整理後再試。',AUTH_DISABLED:'登入功能尚未開放。',ACCOUNT_UNAVAILABLE:'帳號資料暫時無法讀取，請稍後重試。',AUTH_UNAVAILABLE:'登入服務暫時無法使用。',ROLE_NOT_FOUND:'找不到這個帳號。',ROLE_FORBIDDEN:'無法修改這個角色。',INVALID_ROLE_REQUEST:'請檢查角色設定。',SESSION_AUTH_REQUIRED:'請使用 Google 管理員帳號登入。',INVALID_REQUEST:'請檢查輸入的內容。',QUEUE_FULL:'等待套用的變更太多，請等一分鐘再送出。',CHANNEL_ADMIN_UNAVAILABLE:'頻道管理暫時無法使用，請稍後重試。',INVALID_TARGET:'這個來源無法使用。',INVALID_CHANNEL:'頻道編號無法辨識。',INVALID_VIDEO:'影片編號無法辨識。',INVALID_EVENT:'事件編號無法辨識。',INVALID_TAG:'這個標籤尚未出現在維護詞彙中。',INVALID_NOTE:'註記最多 500 字，請移除特殊控制字元。',TARGET_UNAVAILABLE:'來源目前無法使用；既有追蹤或收藏仍可移除。',FOLLOW_LIMIT:'追蹤已達上限，請先取消其他追蹤。',SAVE_LIMIT:'收藏已達上限，請先移除其他收藏。',RATE_LIMITED:'操作較頻繁，請稍候再試。',ROLE_SELF:'無法修改自己的管理角色。',ROLE_CONFIG:'這個管理員由系統設定，無法在此修改。',API_KEYS_DISABLED:'個人 API 金鑰目前未開放。',API_KEY_LIMIT:'有效金鑰已達 3 把上限，請先撤銷其他金鑰。',API_KEY_LIFETIME_LIMIT:'這個帳號建立的金鑰總數已達 100 把上限，無法再建立新金鑰。',API_KEY_NOT_FOUND:'找不到這把金鑰，請重新載入清單。',INVALID_LABEL:'請填寫 1 至 64 字的金鑰名稱，勿含控制字元。'};
export class AccountError extends Error{constructor(public readonly code:string){super(accountMessages[code]??'操作暫時無法完成，請稍後重試。');}}
export const accountMessage=(error:unknown)=>error instanceof AccountError?error.message:'操作暫時無法完成，請稍後重試。';
export function safeNext(value:string|undefined):string{if(!value||value.length>2048||!value.startsWith('/')||value.startsWith('//')||/[\\\u0000-\u0020\u007f]/.test(value)||/^\/auth(?:\/|\?|$)/i.test(value))return '/my';try{const url=new URL(value,'https://youtube.observe.tw');return url.origin==='https://youtube.observe.tw'?value:'/my';}catch{return '/my';}}
export const loginHref=(next:string)=>'/auth/google?'+new URLSearchParams({next:safeNext(next)});
export function isAccountSession(value:unknown):value is AccountSession{if(!value||typeof value!=='object')return false;const s=value as AccountSession,u=s.user;if(typeof s.enabled!=='boolean'||!(s.csrfToken===null||typeof s.csrfToken==='string'))return false;if(u===null)return s.csrfToken===null;if(!u||typeof u!=='object')return false;return s.enabled&&!!s.csrfToken&&Number.isSafeInteger(u.id)&&u.id>0&&typeof u.email==='string'&&(u.name===null||typeof u.name==='string')&&(u.picture===null||typeof u.picture==='string')&&['reader','admin'].includes(u.role)&&[null,'config','granted'].includes(u.adminSource);}
export async function accountFetch<T>(path:string,session:AccountSession|null,options:{method?:'GET'|'PUT'|'POST'|'DELETE';body?:unknown;signal?:AbortSignal}={},fetcher:typeof fetch=fetch):Promise<T>{
 if(!/^\/auth\/(?:me(?:\/(?:follows|saves|feed|feed-token|api-keys(?:\/[1-9]\d{0,19})?))?|users(?:\/[1-9]\d*\/role)?|admin\/(?:user-activity|channels|channel-requests))$/.test(path))throw new AccountError('INVALID_REQUEST');
 const method=options.method??'GET';if(method!=='GET'&&(!session?.user||!session.csrfToken))throw new AccountError('SIGN_IN_REQUIRED');
 let response:Response;try{response=await fetcher(path,{method,credentials:'same-origin',cache:'no-store',signal:options.signal??AbortSignal.timeout(12000),headers:{Accept:'application/json',...(method!=='GET'?{'x-csrf-token':session!.csrfToken!}:{}),...(options.body!==undefined?{'Content-Type':'application/json'}:{})},...(options.body!==undefined?{body:JSON.stringify(options.body)}:{})});}catch{throw new AccountError('ACCOUNT_UNAVAILABLE');}
 const value:unknown=await response.json().catch(()=>null);if(!response.ok){const code=(value as {error?:{code?:unknown}}|null)?.error?.code;throw new AccountError(typeof code==='string'&&Object.hasOwn(accountMessages,code)?code:response.status===401?'SIGN_IN_REQUIRED':response.status===503&&path.startsWith('/auth/me/api-keys')?'API_KEYS_DISABLED':'ACCOUNT_UNAVAILABLE');}if(value===null)throw new AccountError('ACCOUNT_UNAVAILABLE');return value as T;
}
/** getRandomValues remains available on local HTTP previews; never use Math.random. */
export function commandId(source:Pick<Crypto,'getRandomValues'|'randomUUID'>=crypto):string{if(typeof source.randomUUID==='function')return source.randomUUID();const bytes=source.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;const hex=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');}
