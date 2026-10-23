'use client';
import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {VideoThumbnail} from './VideoThumbnail';

const PLAYER_MAX_WIDTH=720,OPEN_DELAY=350,CLOSE_DELAY=200,PLAYER_ORIGIN='https://www.youtube-nocookie.com',AUDIO_KEY='livePreviewAudio';
type Place={left:number;top:number;width:number;height:number};
/** Where the floating player goes: a large 16:9 player under the thumbnail, above it when the viewport has
 * no room below, shrunk to fit and kept inside the viewport and below the site header. */
export function previewPlace(rect:{left:number;top:number;bottom:number},viewport:{width:number;height:number},header=64):Place{
 const below=viewport.height-rect.bottom-16,above=rect.top-header-16;
 const width=Math.round(Math.max(240,Math.min(PLAYER_MAX_WIDTH,viewport.width-16,Math.max(below,above)*16/9))),height=Math.round(width*9/16);
 const left=Math.min(Math.max(8,rect.left),Math.max(8,viewport.width-width-8));
 const top=below>=height||below>=above?rect.bottom+8:rect.top-8-height;
 return {left,top,width,height};
}
export interface PreviewAudio{muted:boolean;volume:number|null}
/** The reader's last player choice, if any; unreadable or malformed storage counts as none. */
export function readPreviewAudio(raw:string|null):PreviewAudio|null{
 try{const value=JSON.parse(raw??'null') as Partial<PreviewAudio>|null;if(!value||typeof value.muted!=='boolean')return null;return {muted:value.muted,volume:typeof value.volume==='number'&&value.volume>=0&&value.volume<=100?value.volume:null};}catch{return null;}
}
/** Sound by default once the reader has used the page (browsers refuse unmuted autoplay before that);
 * after that the reader's own mute and volume choice wins. */
export function previewAudio(saved:PreviewAudio|null,activated:boolean):PreviewAudio{
 return {muted:!activated||(saved?.muted??false),volume:saved?.volume??null};
}
/** The YouTube embed's postMessage reports (the protocol its iframe API speaks); null for anything else. */
export function playerReport(data:unknown):{muted?:boolean;volume?:number;playerState?:number}|null{
 try{const message=typeof data==='string'?JSON.parse(data):data;if(message?.event!=='infoDelivery'&&message?.event!=='initialDelivery')return null;const info=message.info??{};return {...(typeof info.muted==='boolean'?{muted:info.muted}:{}),...(typeof info.volume==='number'?{volume:info.volume}:{}),...(typeof info.playerState==='number'?{playerState:info.playerState}:{})};}catch{return null;}
}
const storage=()=>{try{return window.localStorage;}catch{return null;}};
/** Muted-or-not is fixed in the embed URL; volume, the saved choice and the autoplay fallback go over postMessage. */
function PreviewPlayer({videoId,title}:{videoId:string;title:string}){
 const frame=useRef<HTMLIFrameElement>(null);
 const [audio]=useState(()=>previewAudio(readPreviewAudio(storage()?.getItem(AUDIO_KEY)??null),navigator.userActivation?.hasBeenActive??false));
 useEffect(()=>{
  const target=frame.current?.contentWindow;if(!target)return;
  const send=(message:object)=>target.postMessage(JSON.stringify({...message,id:videoId,channel:'widget'}),PLAYER_ORIGIN);
  let heard=false,last:PreviewAudio|null=null,state=-1,own:Partial<PreviewAudio>|null=null;
  const listen=setInterval(()=>{if(heard)clearInterval(listen);else send({event:'listening'});},250);
  // Some browsers still refuse sound (e.g. no prior click on this site): fall back to a muted start.
  const fallback=setTimeout(()=>{if(!audio.muted&&state!==1){own={muted:true};send({event:'command',func:'mute',args:[]});send({event:'command',func:'playVideo',args:[]});}},2500);
  const receive=(event:MessageEvent)=>{
   if(event.origin!==PLAYER_ORIGIN||event.source!==target)return;
   const report=playerReport(event.data);if(!report)return;
   if(!heard){heard=true;if(audio.volume!==null){own={volume:audio.volume};send({event:'command',func:'setVolume',args:[audio.volume]});}}
   if(report.playerState!==undefined)state=report.playerState;
   if(report.muted===undefined&&report.volume===undefined)return;
   const now={muted:report.muted??last?.muted??audio.muted,volume:report.volume??last?.volume??audio.volume};
   // The first report is the state we asked for, and a change we made ourselves (the muted fallback) is not
   // the reader's either; only other changes are saved as the reader's choice.
   const ours=own!==null&&(own.muted===undefined||own.muted===now.muted)&&(own.volume===undefined||own.volume===now.volume);
   if(ours)own=null;
   else if(last&&(now.muted!==last.muted||now.volume!==last.volume))storage()?.setItem(AUDIO_KEY,JSON.stringify(now));
   last=now;
  };
  addEventListener('message',receive);
  return()=>{clearInterval(listen);clearTimeout(fallback);removeEventListener('message',receive);};
 },[audio,videoId]);
 const query=new URLSearchParams({autoplay:'1',mute:audio.muted?'1':'0',playsinline:'1',enablejsapi:'1',origin:location.origin});
 return <iframe ref={frame} className="h-full w-full border-0" src={`${PLAYER_ORIGIN}/embed/${encodeURIComponent(videoId)}?${query}`} title={`直播預覽：${title}`} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin"/>;
}
/** Live row thumbnail, two text lines tall. Resting the pointer on it opens a large player of the stream below
 * it (sound per previewAudio), portalled to <body> so the table's sideways scroller cannot clip it; it closes on
 * leave or scroll. Mouse only: touch screens keep the plain thumbnail (phones get the inline player card instead). */
export function LivePreviewThumb({videoId,title}:{videoId:string;title:string}){
 const anchor=useRef<HTMLSpanElement>(null),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),[place,setPlace]=useState<Place|null>(null);
 const later=(action:()=>void,delay:number)=>{clearTimeout(timer.current);timer.current=setTimeout(action,delay);};
 const open=()=>later(()=>{const rect=anchor.current?.getBoundingClientRect();if(!rect)return;const header=document.querySelector('[data-site-header]')?.getBoundingClientRect().height??64;setPlace(previewPlace(rect,{width:innerWidth,height:innerHeight},header));},OPEN_DELAY);
 const close=()=>later(()=>setPlace(null),CLOSE_DELAY);
 useEffect(()=>()=>clearTimeout(timer.current),[]);
 useEffect(()=>{if(!place)return;const hide=()=>{clearTimeout(timer.current);setPlace(null);};addEventListener('scroll',hide,{passive:true,capture:true});return()=>removeEventListener('scroll',hide,{capture:true});},[place]);
 return <span ref={anchor} className="relative inline-block" onPointerEnter={e=>{if(e.pointerType==='mouse')open();}} onPointerLeave={close}>
  <VideoThumbnail videoId={videoId} width={72} height={40}/>
  {place&&createPortal(<div className="fixed z-50 overflow-hidden rounded-xl border border-zinc-300 bg-black shadow-2xl dark:border-zinc-700" style={place} onPointerEnter={()=>clearTimeout(timer.current)} onPointerLeave={close}>
   <PreviewPlayer videoId={videoId} title={title}/>
  </div>,document.body)}
 </span>;
}
