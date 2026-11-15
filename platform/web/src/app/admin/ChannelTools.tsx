'use client';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {type ChannelAdminRequest} from '../../../../shared/channel-admin';
import type {ManagedChannel,ManagedChannelList} from '../../../../shared/manage-contracts';
import {accountMessage} from '@/lib/account-client';
import {bookmarkletSource} from '@/lib/channel-bookmarklet';
import {fetchChannelRequests,requestOutcome,requestSummary,submitChannelRequest,tagChange} from '@/lib/channel-admin-client';
import {dateTime} from '@/lib/format';
import {button,note,primary} from '@/app/my/ReaderGate';
import ContentIntake from './ContentIntake';
import {TagPicker} from './TagPicker';
export {TagPicker} from './TagPicker';
import {channelTagOptions,type ChannelTagOption} from '@/lib/channel-tag-options';

const POLL_MS=4000;
type Tag=ChannelTagOption;

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
 return <section className="grid gap-3" aria-label={`編輯 ${channel.channelTitle} 的分類`}>
  <div className="flex flex-wrap items-baseline gap-x-3"><h3 className="font-semibold">編輯頻道標籤：{channel.channelTitle}</h3><span className="text-xs text-zinc-500">#{channel.channelId}</span></div>
  <p className="text-xs text-zinc-500">依頻道數由多到少排列（含封存頻道）</p>
  <TagPicker tags={tags} selected={wanted} onToggle={id=>setWanted(s=>flip(s,id))} label="分類"/>
  {orphans.length>0&&<p className="text-xs text-zinc-500">這個頻道還帶著已停用的分類（{orphans.join('、')}），不在上面的選項裡，會保持原樣。</p>}
  {change.problem==='full'&&<p role="alert" className="text-sm text-red-700 dark:text-red-300">分類已滿（上限約 20 個），請先取消幾個再加。</p>}
  {error&&<p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
  <div className="flex flex-wrap items-center gap-2">
   <button type="button" className={primary} disabled={busy||change.problem!==null} onClick={()=>void save()}>{busy?'送出中…':'儲存標籤'}</button>
   <button type="button" className={button} disabled={busy} onClick={()=>{setWanted(new Set(channel.tags));setError('');onClose();}}>取消變更</button>
   <span className="text-xs text-zinc-500">{change.problem==='none'?'沒有變動':`加入 ${change.add.length}、移除 ${change.remove.length}`}。套用約需 1 分鐘。</span>
  </div>
 </section>;
}

/** Drag-to-bookmarks-bar link. React refuses javascript: hrefs, so the attribute is set on the element directly. */
function Bookmarklet(){
 const link=useRef<HTMLAnchorElement>(null);
 useEffect(()=>{link.current?.setAttribute('href',bookmarkletSource(location.origin));},[]);
 return <div className="grid gap-1 text-sm"><span className="font-medium">安裝快速管理書籤</span>
  <p className="text-xs text-zinc-600 dark:text-zinc-400">把「管理這個 YouTube」拖到 Chrome 書籤列。拖入後可自行更名；在頻道、影片或直播頁點它，即可查收錄狀態、加入內容及編輯頻道標籤。<a ref={link} href="#" onClick={e=>e.preventDefault()} draggable className={button+' ml-2 align-middle'}>管理這個 YouTube</a></p></div>;
}

const STATUS_TONE={pending:'text-amber-800 bg-amber-50 dark:text-amber-200 dark:bg-amber-950',done:'text-emerald-800 bg-emerald-50 dark:text-emerald-200 dark:bg-emerald-950',failed:'text-red-800 bg-red-50 dark:text-red-200 dark:bg-red-950'} as const;
const STATUS_LABEL={pending:'等待中',done:'已套用',failed:'未套用'} as const;

/** The latest changes with their outcome; refreshes by itself while any is waiting, and tells the table when one was applied. */
function History({requests,error,names}:{requests:ChannelAdminRequest[]|null;error:string;names:{tag:(id:number)=>string;channel:(uId:number)=>string}}){
 if(error)return <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>;
 if(!requests)return <p role="status" className={note}>載入中…</p>;
 if(!requests.length)return <p className="text-sm text-zinc-500">還沒有變更紀錄。</p>;
 return <ul className="divide-y divide-zinc-100 dark:divide-zinc-800" aria-label="最近的變更">
  {requests.slice(0,15).map(r=><li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
   <span className={'rounded-full px-2 py-0.5 text-xs '+STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</span>
   <span className="min-w-0 break-words font-medium">{requestSummary(r,names)}</span>
   <span className="text-xs text-zinc-500">{requestOutcome(r)} · {r.actor==='live-playlist'?'來源 加入直播清單':'帳號 '+r.actor.replace('user:','#')} · {dateTime(r.appliedAt??r.createdAt)}</span>
  </li>)}
 </ul>;
}

export default function ChannelTools({data,editing,onEdit,onApplied}:{data:ManagedChannelList;editing:number|null;onEdit:(channelId:number|null)=>void;onApplied:()=>void}){
 const [requests,setRequests]=useState<ChannelAdminRequest[]|null>(null),[error,setError]=useState('');
 const editor=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(editing!==null)editor.current?.scrollIntoView({behavior:'smooth',block:'center'});},[editing]);
 const loadSequence=useRef(0),queuedRefresh=useRef(false),waiting=useRef<Set<number>>(new Set()),applied=useRef(onApplied),timer=useRef<ReturnType<typeof setTimeout>|null>(null),alive=useRef(true);
 applied.current=onApplied;
 const tagName=useMemo(()=>new Map(data.tags.map(t=>[t.id,t.name])),[data.tags]),channelName=useMemo(()=>new Map(data.channels.map(c=>[c.channelId,c.channelTitle])),[data.channels]);
 const names=useMemo(()=>({tag:(id:number)=>tagName.get(id)??`#${id}`,channel:(uId:number)=>channelName.get(uId)??`頻道 #${uId}`}),[tagName,channelName]);
 const load=useCallback(async()=>{
  const sequence=++loadSequence.current;
  if(timer.current)clearTimeout(timer.current);
  try{
   const list=await fetchChannelRequests();if(!alive.current||sequence!==loadSequence.current)return;
   const stillWaiting=new Set(list.requests.filter(r=>r.status==='pending').map(r=>r.id));
   // Something that was waiting a moment ago and is not any more has been applied: refresh the table behind it.
   if([...waiting.current].some(id=>!stillWaiting.has(id))||(queuedRefresh.current&&!stillWaiting.size)){queuedRefresh.current=false;applied.current();}
   waiting.current=stillWaiting;setRequests(list.requests);setError('');
   if(stillWaiting.size)timer.current=setTimeout(()=>void load(),POLL_MS);
  }catch(e){if(alive.current&&sequence===loadSequence.current)setError(accountMessage(e));}
 },[]);
 useEffect(()=>{alive.current=true;void load();return()=>{alive.current=false;if(timer.current)clearTimeout(timer.current);};},[load]);
 const tags=useMemo(()=>channelTagOptions(data.tags,data.channels),[data.tags,data.channels]);
 const channel=editing===null?null:data.channels.find(c=>c.channelId===editing)??null;
 const queued=()=>{queuedRefresh.current=true;void load();};
 return <div className="grid gap-4">
  <section className="grid gap-3" aria-label="YouTube 內容管理">
   <div className="flex flex-wrap items-center justify-between gap-2">
    <h2 className="text-base font-semibold">YouTube 內容與頻道標籤</h2>
   </div>
   <div className="grid gap-4"><ContentIntake tags={tags} channels={data.channels} onQueued={queued} onEdit={onEdit} refreshKey={data.generatedAt} renderChannelTags={known=><TagEditor key={known.channelId+data.generatedAt} channel={known} tags={tags} onClose={()=>onEdit(null)} onQueued={queued}/>}/><Bookmarklet/></div>
  </section>
  {requests&&requests.some(r=>r.status==='pending')&&<p role="status" className="text-sm text-amber-800 dark:text-amber-200">有 {requests.filter(r=>r.status==='pending').length} 項操作等待套用，通常約 1 分鐘。完成後會自動更新。</p>}
  {channel&&<div ref={editor}><TagEditor key={channel.channelId} channel={channel} tags={tags} onClose={()=>onEdit(null)} onQueued={queued}/></div>}
  <section className="text-sm" aria-label="最近的變更"><h2 className="font-medium">最近的變更</h2><div className="mt-2"><History requests={requests} error={error} names={names}/>{error&&<button type="button" className={button+' mt-2'} onClick={()=>void load()}>重新讀取變更</button>}</div></section>
 </div>;
}
