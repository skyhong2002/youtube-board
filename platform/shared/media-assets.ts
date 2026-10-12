/** Public presentation metadata, independent of report/source freshness. */
export interface ChannelAvatar {url:string;revision:string;width:192;height:192;cachedAt:string}
/** A display label is unresolved unless its explicit source identifies one local channel. */
export interface ChannelSource {channelId:number|null;channelTitle:string;channelAvatar:ChannelAvatar|null;youtubeChannelId?:string}
export interface ChannelAvatarIdentity {id:number;channelId:string}
export const AVATAR_SIZE=192 as const;
export const isChannelAssetId=(id:unknown):id is number=>typeof id==='number'&&Number.isSafeInteger(id)&&id>0;
export const isMediaRevision=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export function channelAvatarUrl(id:number,revision:string):string|null{return isChannelAssetId(id)&&isMediaRevision(revision)?`/media/channels/${id}/${revision}.png`:null;}
export function canonicalVideoThumbnail(videoId:string):string|null{return /^[A-Za-z0-9_-]{11}$/.test(videoId)?`https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`:null;}
export function isChannelAvatar(value:unknown):value is ChannelAvatar{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const a=value as ChannelAvatar,path=typeof a.url==='string'?/^\/media\/channels\/([1-9]\d*)\/([a-f0-9]{64})\.png$/.exec(a.url):null;
 return !!path&&isChannelAssetId(Number(path[1]))&&path[2]===a.revision&&isMediaRevision(a.revision)&&a.width===192&&a.height===192&&typeof a.cachedAt==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(a.cachedAt)&&Number.isFinite(Date.parse(a.cachedAt))&&new Date(a.cachedAt).toISOString()===a.cachedAt;
}

/** Finite precomputed derivative set; the immutable PNG identity remains canonical. */
export const AVATAR_WEBP_WIDTHS=[48,96,192] as const;
export type AvatarWebpWidth=typeof AVATAR_WEBP_WIDTHS[number];
export function isAvatarWebpWidth(value:unknown):value is AvatarWebpWidth{return AVATAR_WEBP_WIDTHS.some(width=>width===value);}
export function channelAvatarWebpUrl(id:number,revision:string,width:number):string|null{return isChannelAssetId(id)&&isMediaRevision(revision)&&isAvatarWebpWidth(width)?`/media/channels/${id}/${revision}/${width}.webp`:null;}
