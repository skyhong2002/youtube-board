'use client';
import {useState} from 'react';
import {VideoThumbnail} from '@/components/VideoThumbnail';

/** A representative video as its thumbnail with a play button; the YouTube player loads only
 * when the reader asks for it, so a day with 27 topics does not start 81 players at once. */
export function YouTubeFacade({videoId,title}:{videoId:string;title:string}){
    const [playing,setPlaying]=useState(false);
    if(playing)return <iframe className="aspect-video w-full rounded-md border-0 bg-zinc-900" src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1`} title={title} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin"/>;
    return <button type="button" className="group relative block aspect-video w-full overflow-hidden rounded-md bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 dark:bg-zinc-800" onClick={()=>setPlaying(true)} aria-label={`播放影片：${title}`}>
        <VideoThumbnail videoId={videoId} title={title} fill sizes="(min-width: 640px) 33vw, 75vw" className="rounded-none"/>
        <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/65 text-white transition group-hover:bg-brand-700"><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span>
        </span>
    </button>;
}
