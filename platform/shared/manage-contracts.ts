import type {ChannelAvatar} from './media-assets.js';
/** Wire contracts for the session-admin /manage overview tables. */
export type EditorialActivityKind='event'|'nomination'|'decision';
export interface AccountActivity {userId:number;follows:number;saves:number;apiKeys:number;feed:boolean;sessions:number;editorial:Record<EditorialActivityKind,number>;roleChanges:number;lastActiveAt:string|null}
export interface AccountActivityList {activity:AccountActivity[];generatedAt:string}
export type ManagedChannelStatus='active'|'stale'|'quiet'|'empty'|'archived';
export interface ManagedChannel {channelId:number;channelTitle:string;youtubeChannelId:string;channelAvatar?:ChannelAvatar|null;status:ManagedChannelStatus;tags:number[];subscribers:number|null;videos:number|null;weekVideos:number;latestVideoAt:string|null;statsAt:string|null;addedAt:string|null}
export interface ManagedChannelList {channels:ManagedChannel[];tags:{id:number;name:string}[];generatedAt:string;quietDays:number;staleDays:number}
