'use client';
import {useState} from 'react';
import {pill,pillOff,pillOn} from '@/components/reader/FollowButton';
import {button,field} from '@/app/my/ReaderGate';
import {normalizeTagName} from '../../../../shared/channel-admin';
import {submitChannelRequest} from '@/lib/channel-admin-client';
import {accountMessage} from '@/lib/account-client';
import type {ChannelTagOption} from '@/lib/channel-tag-options';
type Tag=ChannelTagOption;

/** Pick categories by name; a pressed pill is a category the channel will carry. */
export function TagPicker({tags,selected,onToggle,label,onQueued}:{tags:Tag[];selected:ReadonlySet<number>;onToggle:(id:number)=>void;label:string;onQueued?:()=>void}){
 const [query,setQuery]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const name=normalizeTagName(query),exists=tags.some(t=>t.name.toLocaleLowerCase()===name?.toLocaleLowerCase());
 async function create(){
  if(!name||exists||busy||!onQueued)return;setBusy(true);setError('');
  try{await submitChannelRequest({kind:'create-tag',name});setMessage(`已送出建立「${name}」，約 1 分鐘後會出現在清單；選取後再儲存到頻道。`);onQueued();}
  catch(e){setError(accountMessage(e));}finally{setBusy(false);}
 }
 const search=query.normalize('NFC').replace(/\s+/g,' ').trim().toLocaleLowerCase();
 const shown=tags.filter(t=>t.name.normalize('NFC').toLocaleLowerCase().includes(search));
 return <div className="grid gap-2"><input type="search" className={field+' w-full'} aria-label={`搜尋${label}`} placeholder="搜尋或輸入新標籤名稱" value={query} onChange={e=>{setQuery(e.target.value);setMessage('');setError('');}}/><div className="flex flex-wrap gap-2" role="group" aria-label={label}>
  {shown.map(t=><button type="button" key={t.id} aria-pressed={selected.has(t.id)} className={pill+' '+(selected.has(t.id)?pillOn:pillOff)} onClick={()=>onToggle(t.id)}>{t.name}<span className="text-xs tabular-nums opacity-70" aria-label={`${t.channelCount??0} 個頻道`}>{t.channelCount??0}</span></button>)}
  {!shown.length&&<p className="text-xs text-zinc-500">沒有符合的標籤。</p>}
 </div>{onQueued&&name&&!exists&&<button type="button" className={button+' w-fit'} disabled={busy||Boolean(message)} onClick={()=>void create()}>{busy?'送出中…':`建立「${name}」標籤`}</button>}{onQueued&&query.trim()&&!name&&<p className="text-sm text-red-700 dark:text-red-300">標籤名稱最多 32 字，不能包含控制字元。</p>}{message&&<p role="status" className="text-xs text-zinc-500">{message}</p>}{error&&<p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}</div>;
}
