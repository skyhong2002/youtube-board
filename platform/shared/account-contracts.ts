import type { ChannelAvatar } from './media-assets.js';
/** Wire contracts shared by the private account API and client-rendered UI. */
export type AccountFollowKind='channel'|'tag'|'event';
export type AccountSaveKind='video'|'event';
export interface AccountTarget {avatar?:ChannelAvatar|null;thumbnail?:string|null;kind:AccountFollowKind|AccountSaveKind;target:string;label:string;url:string;available:boolean}
export interface AccountFollow extends AccountTarget {kind:AccountFollowKind;createdAt:string}
export interface AccountSave extends AccountTarget {kind:AccountSaveKind;note:string;createdAt:string;updatedAt:string}
export interface AccountFeedItem {avatar?:ChannelAvatar|null;thumbnail?:string|null;kind:'video'|'event';target:string;title:string;url:string;publishedAt:string;updatedAt:string|null}
export interface AccountFeed {items:AccountFeedItem[];period:{from:string;to:string};coverage:{vocabularyVersion:string|null;status:'available'|'vocabulary-unavailable'|'changed';limit:number}}
export interface AccountSession {enabled:boolean;user:null|{id:number;email:string;name:string|null;picture:string|null;role:'reader'|'admin';adminSource:'config'|'granted'|null};csrfToken:string|null}
export interface AccountUserInfo {id:number;email:string;name:string|null;picture:string|null;role:'reader'|'admin';adminSource:'config'|'granted'|null;disabled:boolean;createdAt:string;lastLoginAt:string;grantedBy:number|null}
export interface AccountUsers {users:AccountUserInfo[]}
