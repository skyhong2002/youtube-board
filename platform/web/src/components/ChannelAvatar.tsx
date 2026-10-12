'use client';
import Image from 'next/image';
import {useEffect,useRef,useState} from 'react';
import type {ChannelAvatar as AvatarAsset} from '../../../shared/media-assets';
import {firstGrapheme,localAvatarSource} from '@/lib/media-presentation';
export interface ChannelAvatarProps {avatar?:AvatarAsset|null;title?:string|null;size?:number;decorative?:boolean;className?:string}
/** A cached branding asset is presentation, never evidence of historical identity. */
export function ChannelAvatar({avatar,title,size=24,decorative=true,className=''}:ChannelAvatarProps){
 const src=localAvatarSource(avatar);
 // Remount on source/revision changes, including A→B→A after an image failure.
 return <AvatarImage key={src??'fallback'} src={src} title={title} size={size} decorative={decorative} className={className}/>;
}
function AvatarImage({src,title,size,decorative,className}:{src:string|null;title?:string|null;size:number;decorative:boolean;className:string}){
 const [failed,setFailed]=useState(false),ref=useRef<HTMLImageElement>(null),label=title||'頻道';
 useEffect(()=>{if(ref.current?.complete&&ref.current.naturalWidth===0)setFailed(true);},[]);
 return <span className={'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-sm bg-zinc-100 align-middle text-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 '+className} style={{width:size,height:size,minWidth:size}}>
  {src&&!failed?<Image ref={ref} src={src} alt={decorative?'':label} width={size} height={size} unoptimized loading="lazy" style={{width:size,height:size,objectFit:'contain'}} onError={()=>setFailed(true)}/>:<span aria-hidden={decorative||undefined} role={decorative?undefined:'img'} aria-label={decorative?undefined:label} style={{fontSize:Math.round(size*.6),lineHeight:1}}>{firstGrapheme(title)}</span>}
 </span>;
}
