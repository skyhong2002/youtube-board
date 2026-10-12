'use client';
import Link from 'next/link';
import Avatar from './Avatar';
import {usePathname} from 'next/navigation';
import {useEffect,useRef,useState} from 'react';
import {loginHref,logout,useSessionState} from '@/lib/session';
import {accountMessage} from '@/lib/account-client';
export default function AccountMenu(){
 const {session}=useSessionState(),path=usePathname(),[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),box=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null);
 useEffect(()=>{if(!open)return;const outside=(e:PointerEvent)=>{if(!box.current?.contains(e.target as Node))setOpen(false);};document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);},[open]);useEffect(()=>setOpen(false),[path]);
 if(!session?.enabled)return null;
 if(!session.user)return <a href={loginHref(path)} onClick={e=>{e.currentTarget.href=loginHref(location.pathname+location.search);}} className="block whitespace-nowrap rounded-md px-2 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">登入</a>;
 const user=session.user,label=user.name??user.email;
 return <div ref={box} className="relative flex" onBlur={e=>{if(e.relatedTarget&&!e.currentTarget.contains(e.relatedTarget))setOpen(false);}} onKeyDown={e=>{if(e.key==='Escape'){setOpen(false);trigger.current?.focus();}}}>
  <button ref={trigger} type="button" aria-label={'帳號：'+label} aria-expanded={open} aria-controls="account-links" onClick={()=>setOpen(!open)} className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-50 text-sm font-medium text-brand-800 hover:ring-2 hover:ring-brand-200 focus-visible:outline-2 focus-visible:outline-brand-600 dark:bg-brand-950 dark:text-brand-300"><Avatar src={user.picture} label={label} size={32}/></button>
  {open&&<div id="account-links" className="absolute right-0 top-full mt-2 w-60 max-w-[calc(100vw-2rem)] rounded-lg border border-zinc-200 bg-white p-2 text-sm shadow-lg dark:border-zinc-800 dark:bg-zinc-950"><div className="px-2 py-1.5"><p className="truncate font-medium">{label}</p><p className="truncate text-xs text-zinc-500">{user.email}</p><p className="mt-1 text-xs text-zinc-500">{user.role==='admin'?'管理員':'讀者'}</p></div><nav aria-label="帳號功能">{[['/my','我的動態'],['/boards','我的看板'],['/my/following','追蹤清單'],['/my/saved','我的收藏'],['/my/settings','設定'],...(user.role==='admin'?[['/manage/editorial','管理後台'],['/manage/users','管理角色']]:[])].map(([href,title])=><Link key={href} href={href} className="block rounded-md px-2 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800">{title}</Link>)}</nav><button disabled={busy} className="block w-full rounded-md px-2 py-1.5 text-left hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800" onClick={async()=>{setBusy(true);setError('');try{await logout();}catch(e){setError(accountMessage(e));setBusy(false);}}}>登出</button>{error&&<p role="alert" className="p-2 text-xs text-red-700 dark:text-red-300">{error}</p>}</div>}
 </div>;
}
