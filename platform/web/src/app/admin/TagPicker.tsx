'use client';
import {useState} from 'react';
import {pill,pillOff,pillOn} from '@/components/reader/FollowButton';
import {field} from '@/app/my/ReaderGate';
import type {ChannelTagOption} from '@/lib/channel-tag-options';
type Tag=ChannelTagOption;

/** Pick categories by name; a pressed pill is a category the channel will carry. */
export function TagPicker({tags,selected,onToggle,label}:{tags:Tag[];selected:ReadonlySet<number>;onToggle:(id:number)=>void;label:string}){
 const [query,setQuery]=useState('');
 const shown=tags.filter(t=>t.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
 return <div className="grid gap-2"><input type="search" className={field+' w-full'} aria-label={`搜尋${label}`} placeholder="搜尋標籤名稱" value={query} onChange={e=>setQuery(e.target.value)}/><div className="flex flex-wrap gap-2" role="group" aria-label={label}>
  {shown.map(t=><button type="button" key={t.id} aria-pressed={selected.has(t.id)} className={pill+' '+(selected.has(t.id)?pillOn:pillOff)} onClick={()=>onToggle(t.id)}>{t.name}<span className="text-xs tabular-nums opacity-70" aria-label={`${t.channelCount??0} 個頻道`}>{t.channelCount??0}</span></button>)}
  {!shown.length&&<p className="text-xs text-zinc-500">沒有符合的標籤。</p>}
 </div></div>;
}
