'use client';
import {useEffect,useRef,useState,type SyntheticEvent} from 'react';
import type {ChannelAvatar as AvatarAsset} from '../../../shared/media-assets';
import {firstGrapheme,localAvatarSource} from '@/lib/media-presentation';
export interface ChannelAvatarProps {avatar?:AvatarAsset|null;title?:string|null;size?:number;decorative?:boolean;className?:string}
export const AVATAR_WEBP_WIDTHS=[48,96,192] as const;
/** Precomputed WebP derivatives live beside the immutable 192px PNG; derived only from an already validated local PNG path. */
export function avatarWebpSrcSet(src:string|null):string|null {
 const match=src?.match(/^(\/media\/channels\/[1-9]\d*\/[a-f0-9]{64})\.png$/);
 return match?AVATAR_WEBP_WIDTHS.map(w=>`${match[1]}/${w}.webp ${w}w`).join(', '):null;
}
/** A cached branding asset is presentation, never evidence of historical identity. */
export function ChannelAvatar({avatar,title,size=24,decorative=true,className=''}:ChannelAvatarProps){
 const src=localAvatarSource(avatar);
 // Remount on source/revision changes, including A→B→A after an image failure.
 return <AvatarImage key={src??'fallback'} src={src} title={title} size={size} decorative={decorative} className={className}/>;
}
// webp → PNG only → placeholder; stages only advance, so a failing image can never loop.
type Stage='webp'|'png'|'failed';
// currentSrc may be the WebP candidate while src stays the PNG: only a WebP failure earns a PNG retry.
export const nextAvatarStage=(stage:Stage,currentSrc:string|undefined):Stage=>stage==='webp'&&!currentSrc?.endsWith('.png')?'png':'failed';
function AvatarImage({src,title,size,decorative,className}:{src:string|null;title?:string|null;size:number;decorative:boolean;className:string}){
 const srcSet=avatarWebpSrcSet(src),[stage,setStage]=useState<Stage>(srcSet?'webp':'png'),ref=useRef<HTMLImageElement>(null),label=title||'頻道';
 useEffect(()=>{const el=ref.current;if(el?.complete&&el.naturalWidth===0)setStage(s=>nextAvatarStage(s,el.currentSrc));},[]);
 const img=src&&stage!=='failed'?<img ref={ref} key={stage} src={src} alt={decorative?'':label} width={size} height={size} loading="lazy" decoding="async" style={{width:size,height:size,objectFit:'contain'}} onError={(e:SyntheticEvent<HTMLImageElement>)=>{const current=e.currentTarget.currentSrc;setStage(s=>nextAvatarStage(s,current));}}/>:null;
 return <span className={'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-sm bg-zinc-100 align-middle text-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 '+className} style={{width:size,height:size,minWidth:size}}>
  {img?stage==='webp'&&srcSet?<picture style={{display:'contents'}}><source type="image/webp" srcSet={srcSet} sizes={`${size}px`}/>{img}</picture>:img:<span aria-hidden={decorative||undefined} role={decorative?undefined:'img'} aria-label={decorative?undefined:label} style={{fontSize:Math.round(size*.6),lineHeight:1}}>{firstGrapheme(title)}</span>}
 </span>;
}
