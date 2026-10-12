'use client';
import Image from 'next/image';
import {useEffect,useRef,useState} from 'react';
import {canonicalVideoThumbnail} from '../../../shared/media-assets';
export interface VideoThumbnailProps {videoId?:string|null;title?:string;decorative?:boolean;width?:number;height?:number;fill?:boolean;sizes?:string;priority?:boolean;className?:string}
export function VideoThumbnail({videoId,...props}:VideoThumbnailProps){
 const src=canonicalVideoThumbnail(videoId??'');
 return <ThumbnailImage key={src??'fallback'} src={src} {...props}/>;
}
function ThumbnailImage({src,title='影片縮圖',decorative=true,width=96,height=54,fill=false,sizes,priority=false,className=''}:Omit<VideoThumbnailProps,'videoId'>&{src:string|null}){
 const [failed,setFailed]=useState(false),ref=useRef<HTMLImageElement>(null);
 useEffect(()=>{if(ref.current?.complete&&ref.current.naturalWidth===0)setFailed(true);},[]);
 return <span className={'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-zinc-100 align-middle text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 '+className} style={fill?{width:'100%',height:'100%'}:{width,height,minWidth:width}}>
  {src&&!failed?<Image ref={ref} src={src} alt={decorative?'':title} {...(fill?{fill:true,sizes:sizes??'(max-width: 640px) 100vw, 640px'}:{width,height,sizes:sizes??`${width}px`})} quality={75} loading={priority?'eager':'lazy'} fetchPriority={priority?'high':'auto'} style={{objectFit:'cover',width:'100%',height:'100%'}} onError={()=>setFailed(true)}/>:<span className="flex h-full w-full items-center justify-center" role={decorative?undefined:'img'} aria-hidden={decorative||undefined} aria-label={decorative?undefined:title}><svg viewBox="0 0 48 32" width={Math.min(width*.45,64)} height={Math.min(height*.6,48)} aria-hidden="true"><rect x="2" y="2" width="44" height="28" rx="6" fill="none" stroke="currentColor" strokeWidth="1.5"/><path d="M19 10v12l12-6Z" fill="currentColor"/></svg></span>}
 </span>;
}
