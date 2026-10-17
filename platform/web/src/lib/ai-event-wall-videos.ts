import type {AiEventData,EventCitation} from "../../../api/src/contracts";
import type {ChannelSource} from "../../../shared/media-assets";

export type WallKind="fact"|"opinion"|"supporting"|"opposing"|"other"|"source";
export const WALL_KIND_LABELS:Record<WallKind,string>={fact:"事實",opinion:"觀點",supporting:"支持者",opposing:"反對者",other:"其他觀點",source:"來源分組"};
export interface WallVideo { videoId:string; label:string; media:string; source:ChannelSource|null; kind:WallKind; title:string|null }
export const OTHER_VIDEO_LIMIT=48;

const VIDEO_ID=/^[A-Za-z0-9_-]{11}$/;
/** Laravel's wall order: each summary's fact then opinion citations, then the people
 * analysis's supporting, opposing and other persons' videos; a video keeps its first card.
 * Videos the analyses do not cite (daily grouping and analysis sources) follow separately,
 * newest first as the event report returns them, at most OTHER_VIDEO_LIMIT. */
export function wallVideos(data:Pick<AiEventData,"presentation"|"videos">){
    const local=new Map(data.videos.map(v=>[v.id,v])),seen=new Set<string>(),cited:WallVideo[]=[];
    const add=(citation:EventCitation,label:string,kind:WallKind)=>{
        const id=citation.id;
        if(!id||!citation.href||!VIDEO_ID.test(id)||seen.has(id))return;
        seen.add(id);
        const video=local.get(id);
        cited.push({videoId:id,label:label.trim()||video?.title||id,media:citation.media||video?.channelTitle||"",
            source:citation.sourceChannel??(video?{channelId:video.channelId,channelTitle:video.channelTitle,channelAvatar:video.channelAvatar??null}:null),kind,title:video?.title||null});
    };
    for(const summary of data.presentation.summaries){
        for(const fact of summary.facts)add(fact.citation,fact.headline,"fact");
        for(const opinion of summary.opinions)add(opinion.citation,opinion.content,"opinion");
    }
    for(const kind of ["supporting","opposing","other"] as const)
        for(const group of data.presentation.people?.groups.filter(g=>g.kind===kind)??[])
            for(const person of group.rows)for(const citation of person.citations)add(citation,person.person,kind);
    const rest=data.videos.filter(v=>VIDEO_ID.test(v.id)&&!seen.has(v.id));
    const others:WallVideo[]=rest.slice(0,OTHER_VIDEO_LIMIT).map(v=>({videoId:v.id,label:v.title||v.id,media:v.channelTitle,
        source:{channelId:v.channelId,channelTitle:v.channelTitle,channelAvatar:v.channelAvatar??null},kind:"source",title:v.title||null}));
    return {cited,others,othersTotal:rest.length};
}
