import type {EventCitation,EventPresentation} from "../../../api/src/contracts";
import type {ChannelSource} from "../../../shared/media-assets";

export type StanceKind="supporting"|"opposing"|"other";
/** Laravel's section order and headings. */
const KINDS:{kind:StanceKind;people:string;media:string}[]=[
    {kind:"supporting",people:"支持者",media:"支持媒體"},
    {kind:"opposing",people:"反對者",media:"反對媒體"},
    {kind:"other",people:"其他觀點",media:"其他媒體"},
];
const UNLINKED:Partial<Record<EventCitation["verification"],string>>={invalid:"識別格式無效","outside-snapshot":"不屬於生成時來源"};
export interface PersonVideo { videoId:string|null; rawId:string; media:string; source:ChannelSource|null; status:string }
export interface PersonCard { person:string; role:string; stance:string; strength:string; description:string; videos:PersonVideo[] }
export interface MediaCard { media:string; source:ChannelSource|null; stance:string; strength:string; description:string }
export interface Section<T> { kind:StanceKind; label:string; rows:T[] }
type Groups<T>={kind:StanceKind;rows:T[]}[];

function sections<R,T>(groups:Groups<R>,heading:"people"|"media",card:(row:R)=>T):Section<T>[]{
    return KINDS.flatMap(k=>{const rows=groups.filter(g=>g.kind===k.kind).flatMap(g=>g.rows.map(card));return rows.length?[{kind:k.kind,label:k[heading],rows}]:[];});
}
/** Laravel listed every stored video with a video id under its person; only ids that are valid
 * and belong to the generation-time sources link out, the rest keep their raw id and status. */
const personVideo=(c:EventCitation):PersonVideo=>({videoId:c.href&&c.id?c.id:null,rawId:c.rawId,media:c.media,source:c.sourceChannel??null,status:c.href?"":UNLINKED[c.verification]??""});
export function peopleSections(people:EventPresentation["people"]):Section<PersonCard>[]{
    return sections(people?.groups??[],"people",r=>({person:r.person,role:r.role,stance:r.stance,strength:r.strength,description:r.description,videos:r.citations.filter(c=>c.rawId).map(personVideo)}));
}
export function mediaSections(media:EventPresentation["media"]):Section<MediaCard>[]{
    return sections(media?.groups??[],"media",r=>({media:r.media,source:r.sourceChannel??null,stance:r.stance,strength:r.strength,description:r.description}));
}
