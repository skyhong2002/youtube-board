'use client';
import Link from 'next/link';
import {loginHref,refreshSession,useSessionState} from '@/lib/session';
const errors:Record<string,string>={state:'登入驗證已過期，請重新開始。',cancelled:'已取消登入。',invalid:'無法驗證這次登入，請重新開始。',failed:'登入暫時無法完成，請稍後重試。'};
export default function LoginPanel({next='/my',error}:{next?:string;error?:string}){const state=useSessionState();return <div className="mt-6">{error&&<p role="alert" className="mb-4 text-sm text-red-700 dark:text-red-300">{errors[error]??'登入未完成，請重新開始。'}</p>}{state.loading&&!state.session?<p role="status">載入中…</p>:state.error?<p role="alert">{state.error}<button className="ml-2 underline" onClick={()=>void refreshSession()}>重試</button></p>:!state.session?.enabled?<p className="text-sm text-zinc-500">登入功能尚未開放，公開觀測仍可瀏覽。</p>:state.session.user?<p className="text-sm">你已經以 {state.session.user.email} 登入。<Link href="/my" className="ml-2 text-brand-700 underline dark:text-brand-300">前往我的動態</Link></p>:<a href={loginHref(next)} className="inline-flex items-center gap-2 rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"><svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">
        <path
          fill="#FFC107"
          d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.9z"
        />
        <path
          fill="#FF3D00"
          d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
        />
        <path
          fill="#4CAF50"
          d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
        />
        <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z" />
      </svg>使用 Google 登入</a>}</div>;}
