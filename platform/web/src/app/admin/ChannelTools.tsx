'use client';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {parseChannelSource,type ChannelAdminRequest,type ChannelAdminPayload} from '../../../../shared/channel-admin';
import type {ManagedChannel,ManagedChannelList} from '../../../../shared/manage-contracts';
import {pill,pillOff,pillOn} from '@/components/reader/FollowButton';
import {accountMessage} from '@/lib/account-client';
import {addParam,bookmarkletSource} from '@/lib/channel-bookmarklet';
import {fetchChannelRequests,requestOutcome,requestSummary,submitChannelRequest,tagChange} from '@/lib/channel-admin-client';
import {dateTime} from '@/lib/format';
import {button,card,field,note,primary} from '@/app/my/ReaderGate';

const POLL_MS=4000;
type Tag={id:number;name:string};

/** Pick categories by name; a pressed pill is a category the channel will carry. */
export function TagPicker({tags,selected,onToggle,label}:{tags:Tag[];selected:ReadonlySet<number>;onToggle:(id:number)=>void;label:string}){
 return <div className="flex flex-wrap gap-2" role="group" aria-label={label}>
  {tags.map(t=><button type="button" key={t.id} aria-pressed={selected.has(t.id)} className={pill+' '+(selected.has(t.id)?pillOn:pillOff)} onClick={()=>onToggle(t.id)}>{t.name}</button>)}
 </div>;
}
const flip=(set:ReadonlySet<number>,id:number)=>{const next=new Set(set);if(next.has(id))next.delete(id);else next.add(id);return next;};

/** Change one channel's categories. Only the difference is sent, so two administrators editing at once do not overwrite each other. */
function TagEditor({channel,tags,onClose,onQueued}:{channel:ManagedChannel;tags:Tag[];onClose:()=>void;onQueued:()=>void}){
 const [wanted,setWanted]=useState<ReadonlySet<number>>(()=>new Set(channel.tags)),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const known=new Set(tags.map(t=>t.id)),orphans=channel.tags.filter(id=>!known.has(id));
 const change=tagChange(channel.tags,[...wanted]);
 async function save(){
  if(change.problem)return;
  setBusy(true);setError('');
  try{await submitChannelRequest({kind:'set-tags',uId:channel.channelId,add:change.add,remove:change.remove});onQueued();onClose();}
  catch(e){setError(accountMessage(e));}
  finally{setBusy(false);}
 }
 return <section className={card+' grid gap-3 p-4'} aria-label={`編輯 ${channel.channelTitle} 的分類`}>
  <div className="flex flex-wrap items-baseline gap-x-3"><h3 className="font-semibold">編輯分類：{channel.channelTitle}</h3><span className="text-xs text-zinc-500">#{channel.channelId}</span></div>
  <TagPicker tags={tags} selected={wanted} onToggle={id=>setWanted(s=>flip(s,id))} label="分類"/>
  {orphans.length>0&&<p className="text-xs text-zinc-500">這個頻道還帶著已停用的分類（{orphans.join('、')}），不在上面的選項裡，會保持原樣。</p>}
  {change.problem==='full'&&<p role="alert" className="text-sm text-red-700 dark:text-red-300">分類已滿（上限約 20 個），請先取消幾個再加。</p>}
  {error&&<p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
  <div className="flex flex-wrap items-center gap-2">
   <button type="button" className={primary} disabled={busy||change.problem!==null} onClick={()=>void save()}>{busy?'送出中…':'儲存分類'}</button>
   <button type="button" className={button} disabled={busy} onClick={onClose}>取消</button>
   <span className="text-xs text-zinc-500">{change.problem==='none'?'沒有變動':`加入 ${change.add.length}、移除 ${change.remove.length}`}。套用約需 1 分鐘。</span>
  </div>
 </section>;
}

/** Drag-to-bookmarks-bar link. React refuses javascript: hrefs, so the attribute is set on the element directly. */
function Bookmarklet(){
 const link=useRef<HTMLAnchorElement>(null);
 useEffect(()=>{link.current?.setAttribute('href',bookmarkletSource(location.origin));},[]);
 return <div className="grid gap-1 text-sm"><span className="font-medium">從 YouTube 直接加入</span>
  <p className="text-xs text-zinc-600 dark:text-zinc-400">把右邊的按鈕拖到 Chrome 的書籤列。之後在任何 YouTube 頻道頁或影片頁按這個書籤，就會跳到這裡並帶入該頻道。<a ref={link} href="#" onClick={e=>e.preventDefault()} draggable className={button+' ml-2 align-middle'}>加入有影儀表板</a></p></div>;
}

/** Add a channel from what the administrator pastes: a /channel/ link, an @handle link or a channel ID. */
function AddChannel({tags,channels,initial,onQueued,onEdit}:{tags:Tag[];channels:ManagedChannel[];initial:string;onQueued:()=>void;onEdit:(channelId:number)=>void}){
 const [text,setText]=useState(initial),[chosen,setChosen]=useState<ReadonlySet<number>>(new Set()),[busy,setBusy]=useState(false),[error,setError]=useState(''),[sent,setSent]=useState('');
 const source=parseChannelSource(text),known=source?channels.find(c=>c.youtubeChannelId===source)??null:null,problem=text.trim()&&!source?'請貼上頻道網址（youtube.com/channel/… 或 youtube.com/@…）、@名稱或 UC 開頭的頻道 ID。/user/ 與 /c/ 舊式網址查不到，請改貼 @名稱。':'';
 async function submit(){
  if(!source)return;
  setBusy(true);setError('');setSent('');
  try{await submitChannelRequest({kind:'add-channel',source,tags:[...chosen]});setSent(source);setText('');setChosen(new Set());onQueued();}
  catch(e){setError(accountMessage(e));}
  finally{setBusy(false);}
 }
 return <form className="grid gap-2" onSubmit={e=>{e.preventDefault();void submit();}} aria-label="新增頻道">
  <label className="grid gap-1 text-sm font-medium">新增頻道
   <input className={field+' font-normal'} value={text} onChange={e=>setText(e.target.value)} placeholder="貼上 YouTube 頻道網址、@名稱或頻道 ID" autoComplete="off" spellCheck={false} maxLength={300}/>
  </label>
  {problem&&<p role="alert" className="text-xs text-amber-800 dark:text-amber-300">{problem}</p>}
  {source&&!known&&<p className="text-xs text-zinc-500">辨識為：{source}</p>}
  {known&&<p role="status" className="text-sm text-amber-800 dark:text-amber-300">這個頻道已經在清單裡：{known.channelTitle}（#{known.channelId}）{known.status==='archived'?'，目前是封存狀態，不能重新加入':''}。<button type="button" className="ml-2 underline" onClick={()=>onEdit(known.channelId)}>編輯它的分類</button></p>}
  <details className="text-sm"><summary className="cursor-pointer text-zinc-600 dark:text-zinc-400">一併設定分類{chosen.size?`（已選 ${chosen.size}）`:'（可略過，之後再補）'}</summary><div className="mt-2"><TagPicker tags={tags} selected={chosen} onToggle={id=>setChosen(s=>flip(s,id))} label="新增時的分類"/></div></details>
  {error&&<p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
  {sent&&<p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">已送出 {sent}，約 1 分鐘內會出現在下方的紀錄與頻道表。</p>}
  <div><button type="submit" className={primary} disabled={busy||!source||Boolean(known)}>{busy?'送出中…':'加入頻道'}</button></div>
 </form>;
}

function NewTag({onQueued}:{onQueued:()=>void}){
 const [name,setName]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const clean=name.normalize('NFC').replace(/\s+/g,' ').trim(),tooLong=[...clean].length>32;
 async function submit(){
  if(!clean||tooLong)return;
  setBusy(true);setError('');
  try{await submitChannelRequest({kind:'create-tag',name:clean});setName('');onQueued();}
  catch(e){setError(accountMessage(e));}
  finally{setBusy(false);}
 }
 return <form className="flex flex-wrap items-end gap-2" onSubmit={e=>{e.preventDefault();void submit();}} aria-label="新增分類">
  <label className="grid gap-1 text-sm font-medium">新增分類
   <input className={field+' w-56 font-normal'} value={name} onChange={e=>setName(e.target.value)} placeholder="分類名稱（最多 32 字）" maxLength={80}/>
  </label>
  <button type="submit" className={button} disabled={busy||!clean||tooLong}>{busy?'送出中…':'建立'}</button>
  {tooLong&&<span role="alert" className="text-xs text-amber-800 dark:text-amber-300">名稱最多 32 個字。</span>}
  {error&&<span role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</span>}
 </form>;
}

const STATUS_TONE={pending:'text-amber-800 bg-amber-50 dark:text-amber-200 dark:bg-amber-950',done:'text-emerald-800 bg-emerald-50 dark:text-emerald-200 dark:bg-emerald-950',failed:'text-red-800 bg-red-50 dark:text-red-200 dark:bg-red-950'} as const;
const STATUS_LABEL={pending:'等待中',done:'已套用',failed:'未套用'} as const;

/** The latest changes with their outcome; refreshes by itself while any is waiting, and tells the table when one was applied. */
function History({requests,error,names}:{requests:ChannelAdminRequest[]|null;error:string;names:{tag:(id:number)=>string;channel:(uId:number)=>string}}){
 if(error)return <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>;
 if(!requests)return <p role="status" className={note}>載入中…</p>;
 if(!requests.length)return <p className="text-sm text-zinc-500">還沒有變更紀錄。</p>;
 return <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800" aria-label="最近的變更">
  {requests.slice(0,15).map(r=><li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
   <span className={'rounded-full px-2 py-0.5 text-xs '+STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</span>
   <span className="min-w-0 break-words font-medium">{requestSummary(r,names)}</span>
   <span className="text-xs text-zinc-500">{requestOutcome(r)} · 帳號 {r.actor.replace('user:','#')} · {dateTime(r.appliedAt??r.createdAt)}</span>
  </li>)}
 </ul>;
}

export default function ChannelTools({data,editing,onEdit,onApplied}:{data:ManagedChannelList;editing:number|null;onEdit:(channelId:number|null)=>void;onApplied:()=>void}){
 const [requests,setRequests]=useState<ChannelAdminRequest[]|null>(null),[error,setError]=useState(''),[initialAdd]=useState(()=>typeof location==='undefined'?'':addParam(location.search)),[open,setOpen]=useState(initialAdd!=='');
 const waiting=useRef<Set<number>>(new Set()),applied=useRef(onApplied),timer=useRef<ReturnType<typeof setTimeout>|null>(null),alive=useRef(true);
 applied.current=onApplied;
 const tagName=useMemo(()=>new Map(data.tags.map(t=>[t.id,t.name])),[data.tags]),channelName=useMemo(()=>new Map(data.channels.map(c=>[c.channelId,c.channelTitle])),[data.channels]);
 const names=useMemo(()=>({tag:(id:number)=>tagName.get(id)??`#${id}`,channel:(uId:number)=>channelName.get(uId)??`頻道 #${uId}`}),[tagName,channelName]);
 const load=useCallback(async()=>{
  if(timer.current)clearTimeout(timer.current);
  try{
   const list=await fetchChannelRequests();if(!alive.current)return;
   const stillWaiting=new Set(list.requests.filter(r=>r.status==='pending').map(r=>r.id));
   // Something that was waiting a moment ago and is not any more has been applied: refresh the table behind it.
   if([...waiting.current].some(id=>!stillWaiting.has(id)))applied.current();
   waiting.current=stillWaiting;setRequests(list.requests);setError('');
   if(stillWaiting.size)timer.current=setTimeout(()=>void load(),POLL_MS);
  }catch(e){if(alive.current)setError(accountMessage(e));}
 },[]);
 useEffect(()=>{alive.current=true;void load();return()=>{alive.current=false;if(timer.current)clearTimeout(timer.current);};},[load]);
 const channel=editing===null?null:data.channels.find(c=>c.channelId===editing)??null;
 const queued=()=>{void load();};
 return <div className="grid gap-4">
  <div className="flex flex-wrap items-center gap-2">
   <button type="button" className={button} aria-expanded={open} onClick={()=>setOpen(v=>!v)}>{open?'收起新增':'新增頻道或分類'}</button>
   {requests&&requests.some(r=>r.status==='pending')&&<span role="status" className="text-sm text-amber-800 dark:text-amber-300">有 {requests.filter(r=>r.status==='pending').length} 項變更等待套用…</span>}
  </div>
  {open&&<div className={card+' grid gap-4 p-4'}><AddChannel tags={data.tags} channels={data.channels} initial={initialAdd} onQueued={queued} onEdit={id=>{onEdit(id);window.scrollTo({top:0,behavior:'smooth'});}}/><hr className="border-zinc-200 dark:border-zinc-800"/><NewTag onQueued={queued}/><hr className="border-zinc-200 dark:border-zinc-800"/><Bookmarklet/></div>}
  {channel&&<TagEditor key={channel.channelId} channel={channel} tags={data.tags} onClose={()=>onEdit(null)} onQueued={queued}/>}
  <details className="text-sm" open={Boolean(requests?.some(r=>r.status!=='done'))}><summary className="cursor-pointer font-medium">最近的變更</summary><div className="mt-2"><History requests={requests} error={error} names={names}/></div></details>
 </div>;
}
