import type {ChannelAvatar,ChannelAvatarIdentity} from '../media-assets.js';
import {channelAvatarUrl,isChannelAssetId} from '../media-assets.js';
import {listAvatarRevisions,readManifest} from './store.js';
export async function readCachedChannelIds():Promise<ReadonlySet<number>>{
 const root=process.env.MEDIA_CACHE_ROOT,manifest=root?await readManifest(root):null;
 return new Set(manifest?Object.keys(manifest.entries).map(Number):[]);
}
/** Reads bounded local cache metadata only. Never fetches, enqueues or reads DB. */
export async function readChannelAvatars(identities:ChannelAvatarIdentity[]):Promise<Map<number,ChannelAvatar>>{
 const out=new Map<number,ChannelAvatar>(),root=process.env.MEDIA_CACHE_ROOT;
 if(!root||identities.length>5000)return out;
 const manifest=await readManifest(root);if(!manifest)return out;
 for(const identity of identities){
  if(!isChannelAssetId(identity.id)||typeof identity.channelId!=='string')continue;
  const item=manifest.entries[String(identity.id)];if(!item||item.channelId!==identity.channelId)continue;
  const url=channelAvatarUrl(identity.id,item.revision);if(url)out.set(identity.id,{url,revision:item.revision,width:192,height:192,cachedAt:item.cachedAt});
 }
 return out;
}
/** Retained logo revisions of one channel (oldest first); empty when the cache is absent or unreadable. */
export async function readChannelAvatarRevisions(id:number):Promise<ChannelAvatar[]>{
 const root=process.env.MEDIA_CACHE_ROOT;if(!root)return [];
 try{return (await listAvatarRevisions(root,id)).flatMap(r=>{const url=channelAvatarUrl(id,r.revision);return url?[{url,revision:r.revision,width:192 as const,height:192 as const,cachedAt:r.cachedAt}]:[];});}catch{return [];}
}
