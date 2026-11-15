import type {ManagedChannel} from '../../../shared/manage-contracts';
export type ChannelTagOption={id:number;name:string;channelCount?:number};
/** Counts every managed channel, including archived ones, once per tag. */
export function channelTagOptions(tags:readonly ChannelTagOption[],channels:readonly Pick<ManagedChannel,'tags'>[]):ChannelTagOption[]{
 const counts=new Map<number,number>();
 for(const channel of channels)for(const id of new Set(channel.tags))counts.set(id,(counts.get(id)??0)+1);
 return tags.map(tag=>({...tag,channelCount:counts.get(tag.id)??0})).sort((a,b)=>b.channelCount-a.channelCount||a.id-b.id);
}
