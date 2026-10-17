import "server-only";
import {api,type ChannelRow,type ChannelTag,type Collection,type TagRow} from "./api";
import {tagLookupSearch,visibleChannelTags,type AspectFilters} from "./ai-aspects-board";

/** What the Laravel table needs beyond /ai/aspects, from existing public endpoints: tag names
 * (title and filter chips) from /tags, and each channel's visible tags from the /channels
 * directory. Failed reads leave names as ids and tags empty (tagsComplete=false). */
export async function aiAspectsSources(f:AspectFilters){
    const lookup=tagLookupSearch(f);
    const page=(offset:number)=>api<Collection<ChannelRow>>("channels",{...lookup,offset:String(offset)},{optional:true});
    const [tags,first]=await Promise.all([api<Collection<TagRow>>("tags",{limit:"200"},{optional:true}),page(0)]);
    const names=new Map<number,string>(tags.ok?tags.response.data.rows.map(t=>[t.id,t.name]):[]);
    if(!first.ok)return {names,channelTags:new Map<number,ChannelTag[]>(),tagsComplete:false};
    const {total,limit}=first.response.data,offsets:number[]=[];
    for(let offset=limit;offset<Math.min(total,2000);offset+=limit)offsets.push(offset);
    const rest=await Promise.all(offsets.map(page));
    const rows=[first,...rest].flatMap(r=>r.ok?r.response.data.rows:[]);
    return {names,channelTags:visibleChannelTags(rows),tagsComplete:rest.every(r=>r.ok)&&total<=2000};
}
