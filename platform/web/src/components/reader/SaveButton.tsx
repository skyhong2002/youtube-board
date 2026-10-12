'use client';
import {usePathname} from 'next/navigation';
import {useState} from 'react';
import type {AccountSaveKind} from '../../../../shared/account-contracts';
import {saves,setSave} from '@/lib/reader';
import {loginHref,useSession} from '@/lib/session';
import {accountMessage} from '@/lib/account-client';
import {pill,pillOff,pillOn} from './FollowButton';
export default function SaveButton({kind,target}:{kind:AccountSaveKind;target:string}){const session=useSession(),list=saves.useValue(),path=usePathname(),[busy,setBusy]=useState(false),[error,setError]=useState('');if(!session?.enabled)return null;if(!session.user)return <a className={pill+' '+pillOff} href={loginHref(path)} onClick={e=>{e.currentTarget.href=loginHref(location.pathname+location.search);}}>收藏</a>;const on=!!list.data?.some(item=>item.kind===kind&&item.target===target);return <span className="inline-flex flex-wrap items-center gap-2"><button type="button" className={pill+' '+(on?pillOn:pillOff)} aria-pressed={on} disabled={busy||!list.data} onClick={async()=>{setBusy(true);setError('');try{await setSave(kind,target,!on);}catch(e){setError(accountMessage(e));}finally{setBusy(false);}}}>{on?'已收藏':'收藏'}</button>{(error||list.error)&&<span role="alert" className="text-xs text-red-700 dark:text-red-300">{error||list.error}{list.error&&<button className="ml-1 underline" onClick={()=>void saves.reload()}>重試</button>}</span>}</span>;}
