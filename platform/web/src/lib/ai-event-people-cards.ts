import type {ReportCell,ReportValue} from "../../../api/src/report-contracts";
import type {ChannelSource} from "../../../shared/media-assets";

type Row=Record<string,ReportValue|ReportCell>;
export type StanceKind="supporting"|"opposing"|"other";
/** Laravel's section order and headings; the API row carries the short AI-category label. */
const KINDS:{kind:StanceKind;api:string;people:string;media:string}[]=[
    {kind:"supporting",api:"支持",people:"支持者",media:"支持媒體"},
    {kind:"opposing",api:"反對",people:"反對者",media:"反對媒體"},
    {kind:"other",api:"其他觀點",people:"其他觀點",media:"其他媒體"},
];
export interface PersonVideo { videoId:string|null; rawId:string; media:string; source:ChannelSource|null; status:string }
export interface PersonCard { person:string; role:string; stance:string; strength:string; description:string; videos:PersonVideo[] }
export interface MediaCard { media:string; source:ChannelSource|null; stance:string; strength:string; description:string }
export interface Section<T> { kind:StanceKind; label:string; rows:T[] }

const VIDEO_ID=/^[A-Za-z0-9_-]{11}$/;
const isCell=(v:ReportValue|ReportCell|undefined):v is ReportCell=>typeof v==="object"&&v!==null;
const text=(v:ReportValue|ReportCell|undefined)=>{const raw=isCell(v)?v.value:v;return raw===null||raw===undefined?"":String(raw).trim();};
const source=(v:ReportValue|ReportCell|undefined)=>isCell(v)?v.sources?.[0]??null:null;
const kindOf=(label:string):StanceKind=>KINDS.find(k=>k.api===label)?.kind??"other";
function sections<T>(groups:Map<StanceKind,T[]>,heading:"people"|"media"):Section<T>[]{
    return KINDS.flatMap(k=>groups.get(k.kind)?.length?[{kind:k.kind,label:k[heading],rows:groups.get(k.kind)!}]:[]);
}

/** The people report lists one row per (person, cited video); Laravel drew one card per
 * person with its videos underneath. Rows regroup in API order, split by AI category. */
export function peopleSections(rows:Row[]):Section<PersonCard>[]{
    const groups=new Map<StanceKind,PersonCard[]>(),byKey=new Map<string,PersonCard>();
    for(const row of rows){
        const card:PersonCard={person:text(row.person),role:text(row.role),stance:text(row.stance),strength:text(row.strength),description:text(row.description),videos:[]};
        if(!card.person)continue;
        const kind=kindOf(text(row.section)),key=JSON.stringify([kind,card.person,card.role,card.stance,card.strength,card.description]);
        let target=byKey.get(key);
        if(!target){target=card;byKey.set(key,card);groups.set(kind,[...groups.get(kind)??[],card]);}
        const rawId=text(row.video);
        if(!rawId)continue;
        const videoId=isCell(row.video)&&row.video.href&&VIDEO_ID.test(rawId)?rawId:null,media=text(row.media);
        if(target.videos.some(v=>v.rawId===rawId&&v.media===media))continue;
        target.videos.push({videoId,rawId,media,source:source(row.media),status:text(row.citationStatus)});
    }
    return sections(groups,"people");
}
export function mediaSections(rows:Row[]):Section<MediaCard>[]{
    const groups=new Map<StanceKind,MediaCard[]>();
    for(const row of rows){
        const card:MediaCard={media:text(row.media),source:source(row.media),stance:text(row.stance),strength:text(row.strength),description:text(row.description)};
        if(!card.media)continue;
        const kind=kindOf(text(row.section));
        groups.set(kind,[...groups.get(kind)??[],card]);
    }
    return sections(groups,"media");
}
/** The report states each analysis's main subject only in its notes, and only when that
 * analysis exists: null means no analysis, "" means it did not record a subject. */
export function analysisSubjects(notes:readonly string[]):{people:string|null;media:string|null}{
    const read=(prefix:string,cut?:string)=>{
        const note=notes.find(n=>n.startsWith(prefix));
        if(note===undefined)return null;
        let value=note.slice(prefix.length);
        if(cut&&value.lastIndexOf(cut)>=0)value=value.slice(0,value.lastIndexOf(cut));
        value=value.replace(/。$/,"").trim();
        return value==="未記錄"?"":value;
    };
    return {people:read("人物分析主體："),media:read("媒體分析主體：","；列示媒體：")};
}
