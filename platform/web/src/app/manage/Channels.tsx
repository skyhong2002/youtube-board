'use client';
import {useEffect,useMemo,useState} from 'react';
import Link from 'next/link';
import type {ManagedChannel,ManagedChannelList,ManagedChannelStatus} from '../../../../shared/manage-contracts';
import {ChannelAvatar} from '@/components/ChannelAvatar';
import {pill,pillOff,pillOn} from '@/components/reader/FollowButton';
import {accountMessage} from '@/lib/account-client';
import {compact,count,dateTime} from '@/lib/format';
import {readerFetch} from '@/lib/reader';
import {table} from '@/lib/table-styles';
import {field,note} from '@/app/my/ReaderGate';
import SortTable,{type SortColumn} from './SortTable';
export const CHANNEL_STATUS:Record<ManagedChannelStatus,{label:string;tone:string;rank:number}>={
 stale:{label:'統計逾期',tone:'text-amber-800 bg-amber-50 dark:text-amber-200 dark:bg-amber-950',rank:0},
 empty:{label:'尚未抓到影片',tone:'text-amber-800 bg-amber-50 dark:text-amber-200 dark:bg-amber-950',rank:1},
 quiet:{label:'近 30 天無新片',tone:'text-zinc-700 bg-zinc-100 dark:text-zinc-300 dark:bg-zinc-800',rank:2},
 active:{label:'正常',tone:'text-emerald-800 bg-emerald-50 dark:text-emerald-200 dark:bg-emerald-950',rank:3},
 archived:{label:'已封存',tone:'text-zinc-500 bg-zinc-100 dark:text-zinc-400 dark:bg-zinc-800',rank:4},
};
const STATUSES=Object.keys(CHANNEL_STATUS) as ManagedChannelStatus[];
const time=(value:string|null)=>value?Date.parse(value):null;
/** Search matches the title, the YouTube channel ID or the local channel number. */
export function channelMatches(row:ManagedChannel,query:string){const q=query.trim().toLowerCase();return !q||row.channelTitle.toLowerCase().includes(q)||row.youtubeChannelId.toLowerCase()===q||String(row.channelId)===q;}
export default function Channels(){
 const [data,setData]=useState<ManagedChannelList|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0),[query,setQuery]=useState(''),[status,setStatus]=useState<ManagedChannelStatus|null>(null),[tag,setTag]=useState<number|0|null>(null);
 useEffect(()=>{const controller=new AbortController();setError('');void readerFetch<ManagedChannelList>('/auth/admin/channels',{signal:controller.signal}).then(value=>{if(!controller.signal.aborted)setData(value);}).catch(e=>{if(!controller.signal.aborted)setError(accountMessage(e));});return()=>controller.abort();},[retry]);
 const names=useMemo(()=>new Map(data?.tags.map(t=>[t.id,t.name])??[]),[data]);
 const searched=useMemo(()=>data?.channels.filter(row=>channelMatches(row,query))??[],[data,query]);
 const inTag=(row:ManagedChannel)=>tag===null||(tag===0?!row.tags.length:row.tags.includes(tag));
 const rows=searched.filter(row=>inTag(row)&&(status===null||row.status===status));
 // Each filter's counts apply the other filters, so a pill shows what picking it would leave.
 const statusCounts=new Map<ManagedChannelStatus,number>(),tagCounts=new Map<number,number>();
 for(const row of searched){if(inTag(row))statusCounts.set(row.status,(statusCounts.get(row.status)??0)+1);if(status===null||row.status===status){if(!row.tags.length)tagCounts.set(0,(tagCounts.get(0)??0)+1);for(const id of row.tags)tagCounts.set(id,(tagCounts.get(id)??0)+1);}}
 if(error)return <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}<button className="ml-2 underline" onClick={()=>setRetry(n=>n+1)}>重新讀取</button></p>;
 if(!data)return <p role="status" className={note}>載入中…</p>;
 const columns:SortColumn<ManagedChannel>[]=[
  {key:'title',label:'頻道',sort:r=>r.channelTitle,cell:r=><Link href={`/channels/${r.channelId}`} className="flex min-w-0 items-center gap-2 font-medium hover:underline" title={`${r.channelTitle}（${r.youtubeChannelId||'無 YouTube ID'} · #${r.channelId}）`}><ChannelAvatar avatar={r.channelAvatar} title={r.channelTitle} size={24}/><span className={`${table.leadText} sm:max-w-60`}>{r.channelTitle}</span></Link>},
  {key:'status',label:'收錄狀態',sort:r=>CHANNEL_STATUS[r.status].rank,first:'asc',cell:r=><span className={'rounded-full px-2 py-0.5 text-xs '+CHANNEL_STATUS[r.status].tone}>{CHANNEL_STATUS[r.status].label}</span>},
  {key:'tags',label:'分類',sort:r=>r.tags.length?r.tags.map(id=>names.get(id)??id).join('、'):null,cell:r=>r.tags.length?<span className={`${table.clip} text-xs text-zinc-600 dark:text-zinc-400`} title={r.tags.map(id=>names.get(id)??id).join('、')}>{r.tags.map(id=>names.get(id)??id).join('、')}</span>:<span className="text-xs text-zinc-400">未分類</span>},
  {key:'subscribers',label:'訂閱',num:true,sort:r=>r.subscribers,cell:r=>compact(r.subscribers)},
  {key:'videos',label:'影片',num:true,sort:r=>r.videos,cell:r=>count(r.videos)},
  {key:'week',label:'7 天新片',num:true,sort:r=>r.weekVideos,cell:r=>count(r.weekVideos)},
  {key:'latest',label:'最新影片',num:true,sort:r=>time(r.latestVideoAt),cell:r=>r.latestVideoAt?dateTime(r.latestVideoAt,true):'—'},
  {key:'stats',label:'統計更新',num:true,sort:r=>time(r.statsAt),cell:r=>r.statsAt?dateTime(r.statsAt):'—'},
  {key:'added',label:'加入',num:true,sort:r=>time(r.addedAt),cell:r=>r.addedAt?dateTime(r.addedAt,true):'—'},
 ];
 const sortedTags=[...data.tags].sort((a,b)=>(tagCounts.get(b.id)??0)-(tagCounts.get(a.id)??0)||a.id-b.id);
 return <div className="grid gap-4">
  <div className="flex flex-wrap items-center gap-2">
   <input type="search" className={field+' w-64 max-w-full'} placeholder="搜尋頻道名稱、YouTube ID 或編號" aria-label="搜尋頻道" value={query} onChange={e=>setQuery(e.target.value)}/>
   <select className={field} aria-label="頻道分類" value={tag===null?'':String(tag)} onChange={e=>setTag(e.target.value===''?null:Number(e.target.value))}>
    <option value="">全部分類</option><option value="0">未分類（{tagCounts.get(0)??0}）</option>
    {sortedTags.map(t=><option key={t.id} value={t.id}>{t.name}（{tagCounts.get(t.id)??0}）</option>)}
   </select>
  </div>
  <div className="flex flex-wrap gap-2" role="group" aria-label="收錄狀態">
   <button type="button" aria-pressed={status===null} className={pill+' '+(status===null?pillOn:pillOff)} onClick={()=>setStatus(null)}>全部 <span className="tabular-nums">{[...statusCounts.values()].reduce((a,b)=>a+b,0)}</span></button>
   {STATUSES.map(s=><button type="button" key={s} aria-pressed={status===s} className={pill+' '+(status===s?pillOn:pillOff)} onClick={()=>setStatus(status===s?null:s)}>{CHANNEL_STATUS[s].label} <span className="tabular-nums">{statusCounts.get(s)??0}</span></button>)}
  </div>
  <p className="text-sm text-zinc-600 dark:text-zinc-400">共 {count(data.channels.length)} 個頻道，符合條件 {count(rows.length)} 個 · 資料時間 {dateTime(data.generatedAt)}</p>
  {rows.length?<SortTable rows={rows} columns={columns} rowKey={r=>r.channelId} label="頻道管理表" initial={{key:'subscribers',dir:'desc'}} page={200}/>:<p className={note}>沒有符合條件的頻道。</p>}
 </div>;
}
