import Link from "next/link";
import {reportStyle as ui} from "@/lib/report-styles";
import {descriptionParts} from "@/lib/description-videos";

/** An AI description with its raw video ids shown as channel-named links to the site's video page. */
export function DescriptionText({text,channelOf}:{text:string;channelOf:(videoId:string)=>string|undefined}){
    return <>{descriptionParts(text,channelOf).map((p,i)=>"text" in p
        ?<span key={i}>{p.text}</span>
        :<Link key={i} className={ui.link} href={`/videos/${encodeURIComponent(p.videoId)}`} prefetch={false}>{p.label}</Link>)}</>;
}
/** Person cards know each cited video's channel from their citations. */
export const citedChannels=(citations:{id?:string|null;rawId:string;media:string}[])=>{
    const m=new Map<string,string>();
    for(const c of citations){if(c.media){m.set(c.rawId,c.media);if(c.id)m.set(c.id,c.media);}}
    return (id:string)=>m.get(id);
};
