import Link from 'next/link';
import {api} from '@/lib/api';
import {filterOptionsMatch,type FilterOptions} from '../../../shared/filter-options';
import {ChannelAvatar} from './ChannelAvatar';

/** Breadcrumb above a channel's sub-reports (videos, keywords, trends…), so the reader still
 * sees which channel the generic report title belongs to. A failed name lookup leaves the
 * report as it was; the same light filter-options read names categories on /tags pages. */
export async function ChannelContext({id}:{id:string}){
 const result=await api<FilterOptions>('filter-options/channels',{ids:id},{optional:true});
 const channel=result.ok&&filterOptionsMatch(result.response.data,{kind:'channels',ids:[id],limit:20})?result.response.data.rows.find(row=>row.id===id):undefined;
 if(!channel?.label)return null;
 return <nav aria-label="麵包屑" className="mb-3 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-zinc-500 dark:text-zinc-400">
  <Link href="/channels" className="hover:underline">頻道</Link><span aria-hidden="true">/</span>
  <Link href={`/channels/${id}`} className="inline-flex min-w-0 items-center gap-1.5 font-medium text-zinc-800 hover:underline dark:text-zinc-200"><ChannelAvatar avatar={channel.avatar??null} title={channel.label} size={20}/><span className="min-w-0 [overflow-wrap:anywhere]">{channel.label}</span></Link>
 </nav>;
}
