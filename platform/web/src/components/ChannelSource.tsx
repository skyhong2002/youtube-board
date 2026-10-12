import Link from 'next/link';
import {Fragment} from 'react';
import {ChannelAvatar} from './ChannelAvatar';
import {isChannelAssetId,type ChannelAvatar as AvatarAsset,type ChannelSource} from '../../../shared/media-assets';
import type {ReportCell} from '@/lib/report-contract';
/** A bare label from a contract without source metadata; it never gains an ID or logo here. */
export function unresolvedSource(channelTitle:string):ChannelSource{return {channelId:null,channelTitle,channelAvatar:null};}
const sourceTitle=(source:ChannelSource|null|undefined)=>typeof source?.channelTitle==='string'?source.channelTitle.trim():'';
/** Link and logo come only from the source's own positive local ID; an avatar cached for another channel is dropped. */
export function sourceIdentity(source:ChannelSource):{id:number|null;avatar:AvatarAsset|null}{
 const id=isChannelAssetId(source.channelId)?source.channelId:null,url=source.channelAvatar?.url;
 const owner=typeof url==='string'?/^\/media\/channels\/([1-9]\d*)\//.exec(url)?.[1]:undefined;
 return {id,avatar:id!==null&&owner!==undefined&&Number(owner)===id?source.channelAvatar:null};
}
/** Whether a source has anything worth a byline: a label or an exact local channel. */
export function hasSource(source:ChannelSource|null|undefined):source is ChannelSource{return !!source&&(!!sourceTitle(source)||isChannelAssetId(source.channelId));}
/** Small inline icon + name. Unresolved labels keep the letter fallback and stay unlinked. */
export function ChannelSourceLabel({source,size=16,className=''}:{source:ChannelSource;size?:number;className?:string}){
 const {id,avatar}=sourceIdentity(source),title=sourceTitle(source)||'頻道名稱尚未取得';
 const body=<><ChannelAvatar className="mr-1" avatar={avatar} title={title} size={size}/>{title}</>;
 return id!==null
  ?<Link className={'hover:underline'+(className?' '+className:'')} href={`/channels/${id}`} title={title}>{body}</Link>
  :<span className={className||undefined} title={`${title}（未對應到本站頻道）`}>{body}</span>;
}
/** `sources` marks a channel-label report cell. An empty list keeps the explicit `.value`
 * as one unresolved label; it is never split or matched to a channel by name. */
export function cellSources(cell:ReportCell):ChannelSource[]|null{
 if(!Array.isArray(cell.sources))return null;
 const listed=cell.sources.filter(hasSource);
 if(listed.length)return listed;
 return typeof cell.value==='string'&&cell.value.trim()?[unresolvedSource(cell.value.trim())]:null;
}
/** Several sources as one inline run; the container title keeps every name when a table cuts the line. */
export function ChannelSourceList({sources,size=16,className=''}:{sources:ChannelSource[];size?:number;className?:string}){
 const named=sources.filter(hasSource);
 return <span className={className||undefined} title={named.map(s=>sourceTitle(s)||'頻道名稱尚未取得').join('、')}>{named.map((s,i)=><Fragment key={i}>{i>0&&'、'}<ChannelSourceLabel source={s} size={size}/></Fragment>)}</span>;
}
