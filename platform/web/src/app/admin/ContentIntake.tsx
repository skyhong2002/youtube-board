'use client';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import Link from 'next/link';
import {parseChannelSource,sourceVideoId,type ChannelAdminPayload} from '../../../../shared/channel-admin';
import type {ContentLookup} from '../../../../shared/content-admin';
import type {ManagedChannel} from '../../../../shared/manage-contracts';
import {addParam} from '@/lib/channel-bookmarklet';
import {readerFetch} from '@/lib/reader';
import {accountMessage} from '@/lib/account-client';
import {submitChannelRequest} from '@/lib/channel-admin-client';
import {button,field,primary} from '@/app/my/ReaderGate';

type Tag={id:number;name:string};
const quiet='text-sm text-zinc-500';
const alert='text-sm text-red-700 dark:text-red-300';
const kindName={live:'直播',video:'影片',channel:'頻道'};

/** Shows stored source observations; report links can lag behind the source writer. */
export function ContentStatus({lookup,onEdit,showTagAction=true}:{lookup:ContentLookup;onEdit:(id:number)=>void;showTagAction?:boolean}){
 const {video,live,channel}=lookup;
 return <div className="grid gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-950" aria-label="收錄狀態">
  <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">本站收錄狀態</h3><span className="text-xs text-zinc-500">依目前資料庫紀錄</span></div>
  <div className="grid gap-2 sm:grid-cols-3">
   {lookup.videoId&&<><div className="grid content-start gap-1 rounded-lg bg-white p-3 dark:bg-zinc-900"><span className={quiet}>影片</span><strong className="text-sm">{video?'已收錄':'尚未收錄'}</strong>{video&&<Link className="break-words text-sm text-brand-700 underline dark:text-brand-400" href={`/videos/${video.videoId}`}>{video.title||'開啟影片頁'} ↗</Link>}</div>
   <div className="grid content-start gap-1 rounded-lg bg-white p-3 dark:bg-zinc-900"><span className={quiet}>直播追蹤</span><strong className="text-sm">{live?(live.retired?'已停止追蹤':'已納入追蹤'):'沒有直播追蹤紀錄'}</strong>{live&&<Link className="text-sm text-brand-700 underline dark:text-brand-400" href={`/live/videos/${live.videoId}/trend`}>開啟直播報表 ↗</Link>}</div></>}
   <div className="grid content-start gap-1 rounded-lg bg-white p-3 dark:bg-zinc-900"><span className={quiet}>所屬頻道</span><strong className="text-sm">{channel?(channel.archived?'已封存':'已納入頻道'):'尚無可確認的收錄紀錄'}</strong>{channel&&<><Link className="break-words text-sm text-brand-700 underline dark:text-brand-400" href={`/channels/${channel.channelId}`}>{channel.title} ↗</Link>{showTagAction&&<button type="button" className="w-fit text-sm underline" onClick={()=>onEdit(channel.channelId)}>增減頻道標籤</button>}</>}</div>
  </div>
  {!channel&&<p className="text-xs text-zinc-500">未收錄的影片或 @名稱可能還無法確認所屬頻道；送出後會由 YouTube 核對，並在需要時加入頻道。</p>}
  {(live||video)&&<p className="text-xs text-zinc-500">來源資料已建立；影片頁、直播報表與統計可能需要等下一輪快取更新。</p>}
 </div>;
}

export default function ContentIntake({tags,channels,onQueued,onEdit,refreshKey,renderChannelTags}:{tags:Tag[];channels:ManagedChannel[];onQueued:()=>void;onEdit:(id:number)=>void;refreshKey:string;renderChannelTags?:(channel:ManagedChannel)=>ReactNode}){
 const [mode,setMode]=useState<'source'|'search'>('source'),[text,setText]=useState(''),[pageTitle,setPageTitle]=useState(''),[query,setQuery]=useState(''),[kind,setKind]=useState<'live'|'video'|'channel'>('live');
 const [lookup,setLookup]=useState<ContentLookup|null>(null),[results,setResults]=useState<ContentLookup|null>(null),[loading,setLoading]=useState(false),[searching,setSearching]=useState(false),[error,setError]=useState(''),[searchError,setSearchError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[selected,setSelected]=useState<number[]>([]),[tagQuery,setTagQuery]=useState(''),[check,setCheck]=useState(0);
 const sequence=useRef(0);
 useEffect(()=>{setText(addParam(location.search));const value=new URLSearchParams(location.search).get('title');if(value&&value.length<=500)setPageTitle(value);},[]);
 useEffect(()=>{setNotice('');},[refreshKey]);
 const source=parseChannelSource(text),videoId=source?sourceVideoId(source):null;
 const currentLookup=lookup?.source===source?lookup:null;
 const archived=currentLookup?.channel?.archived||false;
 const known=currentLookup?.channel?channels.find(c=>c.channelId===currentLookup.channel!.channelId):source&&!videoId?channels.find(c=>c.youtubeChannelId===source):undefined;
 useEffect(()=>{
  const seq=++sequence.current,controller=new AbortController();setLookup(null);setError('');setLoading(Boolean(source));
  if(!source)return()=>controller.abort();
  const timer=setTimeout(()=>{void readerFetch<ContentLookup>('/auth/admin/content?'+new URLSearchParams({source}),{signal:controller.signal}).then(value=>{if(seq===sequence.current&&!controller.signal.aborted)setLookup(value);}).catch(e=>{if(!controller.signal.aborted&&seq===sequence.current)setError(accountMessage(e));}).finally(()=>{if(!controller.signal.aborted&&seq===sequence.current)setLoading(false);});},300);
  return()=>{clearTimeout(timer);controller.abort();};
 },[source,refreshKey,check]);
 async function submit(action:'add-channel'|'add-video'|'add-live'){
  if(!source||busy)return;setBusy(true);setError('');setNotice('');
  try{await submitChannelRequest({kind:action,source,tags:selected} as ChannelAdminPayload);setNotice(`已送出${action==='add-channel'?'加入頻道':action==='add-live'?'加入直播追蹤':'收錄影片'}，等待工作流程核對並套用，通常約 1 分鐘。`);onQueued();}
  catch(e){setError(accountMessage(e));}finally{setBusy(false);}
 }
 const searchSequence=useRef(0);
 async function search(){
  const q=query.trim();if(q.length<2||searching)return;const seq=++searchSequence.current;setSearching(true);setSearchError('');setResults(null);
  try{const value=await readerFetch<ContentLookup>('/auth/admin/content?'+new URLSearchParams({q,kind}));if(seq===searchSequence.current)setResults(value);}
  catch(e){if(seq===searchSequence.current)setSearchError(accountMessage(e));}finally{if(seq===searchSequence.current)setSearching(false);}
 }
 function choose(value:string){setMode('source');setText(value);setPageTitle('');setNotice('');setSelected([]);}
 return <div className="grid gap-4">
  <div className="flex gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-800" role="group" aria-label="管理方式">{([['source','貼上網址 / 加入內容'],['search','搜尋已收錄內容']] as const).map(([value,label])=><button type="button" key={value} aria-pressed={mode===value} disabled={busy} onClick={()=>setMode(value)} className={'min-h-9 px-5 rounded-lg px-3 text-sm font-medium '+(mode===value?'bg-white shadow-sm dark:bg-zinc-950':'text-zinc-500')}>{label}</button>)}</div>
  {mode==='source'?<div className="grid items-start gap-4 lg:grid-cols-2"><div className="grid gap-3">
   <label className="grid gap-2 text-sm font-medium">YouTube 影片、直播或頻道網址<input className={field+' min-h-10 w-full font-normal'} type="text" disabled={busy} value={text} onChange={e=>{setText(e.target.value);setPageTitle('');setNotice('');setSelected([]);}} placeholder="貼上 YouTube 網址、@名稱或 UC 頻道 ID" autoComplete="off" spellCheck={false} maxLength={300}/></label>
   {pageTitle&&<p className="break-words text-sm text-zinc-500">來自 YouTube：{pageTitle}</p>}
   {text.trim()&&!source&&<p role="alert" className={alert}>無法辨識這個網址。請使用 watch?v=、youtu.be、/live/、/shorts/、/channel/、@名稱或頻道 ID；舊式 /user/、/c/ 請改貼該頻道的影片。</p>}
   {!text.trim()&&<p className={quiet}>貼上網址後會自動檢查是否已收錄。也可以從 YouTube 點管理書籤直接帶入。</p>}
   {loading&&<p role="status" className={quiet}>正在查詢收錄狀態…</p>}
   {currentLookup&&<ContentStatus lookup={currentLookup} onEdit={onEdit} showTagAction={!renderChannelTags}/>}
   {source&&<div className="grid gap-4 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
    <div><h3 className="text-sm font-semibold">選擇要加入的內容</h3><p className="mt-1 text-xs text-zinc-500">加入影片或直播時，會一併納入尚未追蹤的所屬頻道。直播會先核對 YouTube 資料。</p></div>
    <div className="flex flex-wrap gap-2">
     {videoId&&<><button type="button" className={primary} disabled={busy||loading||Boolean(notice)||archived||known?.status==='archived'||Boolean(currentLookup?.video)} onClick={()=>void submit('add-video')}>{currentLookup?.video?'影片已收錄':'收錄這部影片'}</button><button type="button" className={button} disabled={busy||loading||Boolean(notice)||archived||known?.status==='archived'||Boolean(currentLookup?.live)} onClick={()=>void submit('add-live')}>{currentLookup?.live?(currentLookup.live.retired?'直播已停止追蹤':'直播已追蹤'):'加入直播追蹤'}</button></>}
     <button type="button" className={videoId?button:primary} disabled={busy||loading||Boolean(notice)||Boolean(known)||Boolean(currentLookup?.channel)} onClick={()=>void submit('add-channel')}>{known||currentLookup?.channel?'頻道已納入':'納入所屬頻道'}</button>
     {known&&!renderChannelTags&&<button type="button" className={button} onClick={()=>onEdit(known.channelId)}>編輯頻道標籤</button>}
    </div>
    {(archived||known?.status==='archived')&&<p className={alert}>此頻道已封存，無法透過這個工具重新加入內容。</p>}

   </div>}
   {error&&<p role="alert" className={alert}>{error}<button type="button" className="ml-2 underline" onClick={()=>setCheck(n=>n+1)}>重新查詢</button></p>}
   {notice&&<p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">{notice}</p>}
  </div><div className="grid gap-3">{known&&renderChannelTags?renderChannelTags(known):<section className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800" aria-label="加入時的頻道標籤"><h3 className="text-sm font-semibold">頻道標籤{selected.length?`（已選 ${selected.length}）`:''}</h3><p className="mt-2 text-xs text-zinc-500">所選標籤會加入所屬頻道；移除既有標籤請使用「編輯頻道標籤」。</p><input type="search" aria-label="搜尋加入時的頻道標籤" className={field+' my-2 w-full'} value={tagQuery} onChange={e=>setTagQuery(e.target.value)} placeholder="搜尋標籤"/><div className="flex max-h-96 flex-wrap gap-2 overflow-y-auto" role="group" aria-label="加入時的頻道標籤">{tags.filter(t=>t.name.includes(tagQuery.trim())).map(t=><label key={t.id} className="flex items-center gap-2 rounded-lg border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-700"><input type="checkbox" checked={selected.includes(t.id)} onChange={()=>setSelected(current=>current.includes(t.id)?current.filter(id=>id!==t.id):[...current,t.id])}/>{t.name}</label>)}</div></section>}</div></div>:<>
   <form className="flex flex-wrap gap-2" onSubmit={e=>{e.preventDefault();void search();}} aria-label="搜尋已收錄內容"><input type="search" aria-label="影片、直播或頻道關鍵字" className={field+' min-h-11 min-w-0 flex-1'} value={query} onChange={e=>{searchSequence.current++;setSearching(false);setQuery(e.target.value);setResults(null);}} placeholder="輸入標題、頻道名稱或 YouTube ID" maxLength={100}/><select aria-label="搜尋內容類型" className={field} value={kind} onChange={e=>{searchSequence.current++;setSearching(false);setKind(e.target.value as typeof kind);setResults(null);}}><option value="live">直播</option><option value="video">影片</option><option value="channel">頻道</option></select><button type="submit" className={primary} disabled={searching||query.trim().length<2}>{searching?'搜尋中…':'搜尋'}</button></form>
   <p className={quiet}>搜尋本站已收錄資料，包含歷史直播。要加入尚未收錄的內容，請切換至貼上網址。</p>
   {searchError&&<p role="alert" className={alert}>{searchError}</p>}
   {results&&<div className="grid gap-2" aria-live="polite">{results.matches.length?<><p className={quiet}>找到 {results.matches.length} 筆，最多顯示 25 筆。</p><ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">{results.matches.map(row=><li key={row.kind+row.id} className="flex flex-wrap items-center justify-between gap-3 p-3"><div className="min-w-0"><span className="text-xs text-zinc-500">{kindName[row.kind]}{row.retired?' · 已停止追蹤':''}</span><Link href={row.href} className="ml-2 break-words text-sm font-medium hover:underline">{row.title}</Link></div><button type="button" className={button} onClick={()=>choose(row.kind==='channel'?row.youtubeChannelId??channels.find(c=>c.channelId===row.channelId)?.youtubeChannelId??'':`https://youtu.be/${row.id}`)}>管理與標籤</button></li>)}</ul></>:<p className={quiet}>沒有符合條件的收錄紀錄。可改用影片網址確認，或縮短關鍵字。</p>}</div>}
  </>}
 </div>;
}
