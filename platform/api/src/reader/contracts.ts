import type { AccountTarget } from '../../../shared/account-contracts.js';
export type FollowKind='channel'|'tag'|'event';
export type SaveKind='video'|'event';
export interface Follow {kind:FollowKind;target:string;createdAt:string}
export interface Saved {kind:SaveKind;target:string;note:string;createdAt:string;updatedAt:string}
export interface Target extends AccountTarget {}
export class AccountError extends Error {constructor(public code:string,public status=400){super(code);}}
export const FOLLOWS_MAX=200,SAVES_MAX=500;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function target(kind:unknown,value:unknown,save=false):{kind:FollowKind|SaveKind;target:string}{
 if(typeof kind!=='string'||!(save?['video','event']:['channel','tag','event']).includes(kind)||typeof value!=='string')throw new AccountError('INVALID_TARGET');
 if(kind==='channel'&&(!/^[1-9]\d{0,14}$/.test(value)||!Number.isSafeInteger(Number(value))))throw new AccountError('INVALID_CHANNEL');
 if(kind==='video'&&!/^[A-Za-z0-9_-]{11}$/.test(value))throw new AccountError('INVALID_VIDEO');
 if(kind==='event'&&!uuid.test(value))throw new AccountError('INVALID_EVENT');
 if(kind==='tag'&&(!value.trim()||value!==value.trim()||value.length>240||/[\u0000-\u001f\u007f]/.test(value)))throw new AccountError('INVALID_TAG');
 return {kind:kind as FollowKind|SaveKind,target:value};
}
export function record(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new AccountError('INVALID_REQUEST');return value as Record<string,unknown>;}
export function fields(value:Record<string,unknown>,keys:string[]){if(Object.keys(value).some(k=>!keys.includes(k)))throw new AccountError('INVALID_REQUEST');}
export function note(value:unknown){if(value===undefined)return '';if(typeof value!=='string'||value.length>500||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))throw new AccountError('INVALID_NOTE');return value;}
export const utcSql=(date:Date)=>date.toISOString().slice(0,23).replace('T',' ');
export const utc=(value:unknown)=>String(value).replace(' ','T')+'Z';
export function targetUrl(kind:FollowKind|SaveKind,value:string){return kind==='channel'?`/channels/${value}`:kind==='tag'?`/keywords/${encodeURIComponent(value)}/videos`:kind==='video'?`/videos/${value}`:`/events/${value}`;}
