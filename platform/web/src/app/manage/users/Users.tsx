'use client';
import {useEffect,useState} from 'react';
import type {AccountUserInfo,AccountUsers} from '../../../../../shared/account-contracts';
import type {AccountActivity,AccountActivityList} from '../../../../../shared/manage-contracts';
import Avatar from '@/components/Avatar';
import {readerFetch} from '@/lib/reader';
import {accountMessage} from '@/lib/account-client';
import {count,dateTime} from '@/lib/format';
import {useSession} from '@/lib/session';
import {table} from '@/lib/table-styles';
import {button,card,note,primary} from '@/app/my/ReaderGate';
import SortTable,{type SortColumn} from '../SortTable';
export type UserRow=AccountUserInfo&{activity:AccountActivity|null};
const WEEK=7*86400000;
export const interactions=(a:AccountActivity|null)=>a?a.follows+a.saves+a.apiKeys+(a.feed?1:0):null;
export const contributions=(a:AccountActivity|null)=>a?a.editorial.event+a.editorial.nomination+a.editorial.decision+a.roleChanges:null;
/** Latest action or login, whichever is newer; logins alone still count as being around. */
export const lastSeen=(row:UserRow)=>{const at=row.activity?.lastActiveAt;return at&&at>row.lastLoginAt?at:row.lastLoginAt;};
const time=(value:string|null|undefined)=>value?Date.parse(value):null;
const role=(u:AccountUserInfo)=>u.disabled?'帳號停用':u.role==='admin'?(u.adminSource==='config'?'管理員＊':'管理員'):'讀者';
export default function Users(){
 const session=useSession(),[users,setUsers]=useState<AccountUserInfo[]|null>(null),[activity,setActivity]=useState<Map<number,AccountActivity>|null>(null),[activityError,setActivityError]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[selected,setSelected]=useState<AccountUserInfo|null>(null),[retry,setRetry]=useState(0);
 useEffect(()=>{const controller=new AbortController(),signal=controller.signal;setError('');setActivityError('');
  void readerFetch<AccountUsers>('/auth/users',{signal}).then(data=>{if(!signal.aborted)setUsers(data.users);}).catch(e=>{if(!signal.aborted)setError(accountMessage(e));});
  // Counts are extra: the role list stays usable when they cannot be read.
  void readerFetch<AccountActivityList>('/auth/admin/user-activity',{signal}).then(data=>{if(!signal.aborted)setActivity(new Map(data.activity.map(a=>[a.userId,a])));}).catch(e=>{if(!signal.aborted){setActivity(new Map());setActivityError(accountMessage(e));}});
  return()=>controller.abort();},[retry]);
 async function change(){if(!selected)return;setBusy(true);setError('');try{await readerFetch('/auth/users/'+selected.id+'/role',{method:'PUT',body:{role:selected.role==='admin'?'reader':'admin'}});setSelected(null);setRetry(n=>n+1);}catch(e){setError(accountMessage(e));}finally{setBusy(false);}}
 const rows:UserRow[]=(users??[]).map(u=>({...u,activity:activity?.get(u.id)??(activity&&!activityError?{userId:u.id,follows:0,saves:0,apiKeys:0,feed:false,sessions:0,editorial:{event:0,nomination:0,decision:0},roleChanges:0,lastActiveAt:null}:null)}));
 const recent=rows.filter(r=>Date.now()-Date.parse(lastSeen(r))<=WEEK).length;
 const n=(value:number|null|undefined)=>value==null?'—':count(value);
 const columns:SortColumn<UserRow>[]=[
  {key:'name',label:'帳號',sort:r=>r.name??r.email,cell:r=><span className="flex min-w-0 items-center gap-2" title={`${r.email}\n加入 ${dateTime(r.createdAt)}`}><Avatar src={r.picture} label={r.name??r.email} size={24}/><span className="min-w-0"><span className={`${table.leadText} block font-medium sm:max-w-56`}>{r.name??r.email}</span><span className={`${table.leadWide} ${table.leadText} block text-xs text-zinc-500 sm:max-w-56`}>{r.email}</span></span></span>},
  {key:'role',label:'身分',sort:r=>role(r),title:'管理員＊是伺服器設定的管理員，這裡不能取消',cell:r=><span className="inline-flex items-center gap-2"><span className="text-xs">{role(r)}</span>{!r.disabled&&r.adminSource!=='config'&&r.id!==session?.user?.id&&<button className={button+' min-h-7 px-2 text-xs'} disabled={busy} onClick={()=>setSelected(r)}>{r.role==='admin'?'設為讀者':'設為管理員'}</button>}</span>},
  {key:'interactions',label:'互動',num:true,title:'追蹤、收藏、有效的 API 金鑰與 RSS 訂閱的合計',sort:r=>interactions(r.activity),cell:r=><strong className="font-semibold">{n(interactions(r.activity))}</strong>},
  {key:'contributions',label:'貢獻',num:true,title:'事件編輯、頻道提名、頻道審核與角色調整的合計',sort:r=>contributions(r.activity),cell:r=><strong className="font-semibold">{n(contributions(r.activity))}</strong>},
  {key:'follows',label:'追蹤',num:true,sort:r=>r.activity?.follows??null,cell:r=>n(r.activity?.follows)},
  {key:'saves',label:'收藏',num:true,sort:r=>r.activity?.saves??null,cell:r=>n(r.activity?.saves)},
  {key:'apiKeys',label:'API 金鑰',num:true,sort:r=>r.activity?.apiKeys??null,cell:r=>n(r.activity?.apiKeys)},
  {key:'feed',label:'RSS',sort:r=>r.activity?(r.activity.feed?1:0):null,first:'desc',cell:r=>r.activity?(r.activity.feed?'有':'—'):'—'},
  {key:'events',label:'事件編輯',num:true,sort:r=>r.activity?.editorial.event??null,cell:r=>n(r.activity?.editorial.event)},
  {key:'nominations',label:'頻道提名',num:true,sort:r=>r.activity?.editorial.nomination??null,cell:r=>n(r.activity?.editorial.nomination)},
  {key:'decisions',label:'頻道審核',num:true,sort:r=>r.activity?.editorial.decision??null,cell:r=>n(r.activity?.editorial.decision)},
  {key:'roles',label:'角色調整',num:true,sort:r=>r.activity?.roleChanges??null,cell:r=>n(r.activity?.roleChanges)},
  {key:'seen',label:'最近活動',num:true,sort:r=>time(lastSeen(r)),cell:r=>dateTime(lastSeen(r))},
  {key:'login',label:'最近登入',num:true,sort:r=>time(r.lastLoginAt),cell:r=>dateTime(r.lastLoginAt)},
  {key:'sessions',label:'登入裝置',num:true,title:'目前仍有效的登入工作階段數',sort:r=>r.activity?.sessions??null,cell:r=>n(r.activity?.sessions)},
 ];
 return <div className="grid gap-4">
  {error&&<p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}<button className="ml-2 underline" disabled={busy} onClick={()=>setRetry(n=>n+1)}>重新讀取</button></p>}
  {activityError&&<p role="alert" className="text-sm text-amber-800 dark:text-amber-200">活動統計暫時讀不到（{activityError}），先只列帳號與角色。</p>}
  {!users&&!error&&<p role="status" className={note}>載入中…</p>}
  {selected&&<div className={card+' p-4'}><p>將 {selected.email} 設為{selected.role==='admin'?'讀者':'管理員'}？</p><div className="mt-3 flex gap-2"><button className={primary} disabled={busy} onClick={()=>void change()}>確認變更角色</button><button className={button} disabled={busy} onClick={()=>setSelected(null)}>取消</button></div></div>}
  {users&&<><p className="text-sm text-zinc-600 dark:text-zinc-400">共 {count(users.length)} 個帳號，近 7 天有活動 {count(recent)} 個</p><SortTable rows={rows} columns={columns} rowKey={r=>r.id} label="帳號活動表" initial={{key:'seen',dir:'desc'}}/></>}
 </div>;
}
