import {CHANNEL_ADMIN_ERRORS,applyTagDelta,type ChannelAdminAccepted,type ChannelAdminPayload,type ChannelAdminRequest,type ChannelAdminRequestList} from '../../../shared/channel-admin';
import {commandId} from './account-client';
import {readerFetch} from './reader';

export const fetchChannelRequests=(signal?:AbortSignal)=>readerFetch<ChannelAdminRequestList>('/auth/admin/channel-requests',signal?{signal}:{});
/** Queue one edit. The id makes a double click or a retry after a lost answer a replay, never a second change. */
export function submitChannelRequest(payload:ChannelAdminPayload,requestId:string=commandId()){
 const {kind,...fields}=payload;
 return readerFetch<ChannelAdminAccepted>('/auth/admin/channel-requests',{method:'POST',body:{requestId,kind,payload:fields}});
}

type Names={tag:(id:number)=>string;channel:(uId:number)=>string};
const list=(ids:number[],tag:Names['tag'])=>ids.map(id=>`「${tag(id)}」`).join('、');
/** What the request asked for, in the words of the page. */
export function requestSummary(request:ChannelAdminRequest,names:Names):string{
 const p=request.payload;
 if(p.kind==='add-channel')return `新增頻道 ${p.source}${p.tags.length?`，分類 ${list(p.tags,names.tag)}`:''}`;
 if(p.kind==='create-tag')return `新增分類「${p.name}」`;
 return `${names.channel(p.uId)}：${[p.add.length?`加入 ${list(p.add,names.tag)}`:'',p.remove.length?`移除 ${list(p.remove,names.tag)}`:''].filter(Boolean).join('，')}`;
}
const num=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)?value:null;
/** How it ended: waiting, applied (with what the worker did) or refused (with the reason). */
export function requestOutcome(request:ChannelAdminRequest):string{
 if(request.status==='pending')return '等待套用，約 1 分鐘內';
 if(request.status==='failed')return request.errorCode?CHANNEL_ADMIN_ERRORS[request.errorCode]:'未能套用';
 const r=request.result??{};
 if(request.kind==='add-channel'){const uId=num(r.uId);return r.created===false?`已有此頻道${uId?`（#${uId}）`:''}，沒有重複新增`:`已新增${uId?`為 #${uId}`:''}，統計與影片稍後補齊`;}
 if(request.kind==='create-tag'){const id=num(r.tagId);return r.created===false?`已有同名分類${id?`（#${id}）`:''}`:`已建立${id?`，編號 ${id}`:''}`;}
 const added=Array.isArray(r.added)?r.added.length:0,removed=Array.isArray(r.removed)?r.removed.length:0;
 return added+removed?`已套用（加入 ${added}、移除 ${removed}）`:'沒有變動，分類本來就是這樣';
}
/** The stored tag string of a channel, as the worker keeps it: one `[id]` marker per tag. */
export const tagString=(ids:number[])=>ids.map(id=>`[${id}]`).join('');
/** What toggling to `wanted` would change for a channel carrying `current`, or why it cannot be saved. */
export function tagChange(current:number[],wanted:number[]){
 const add=wanted.filter(id=>!current.includes(id)),remove=current.filter(id=>!wanted.includes(id));
 if(!add.length&&!remove.length)return {add,remove,problem:'none' as const};
 try{applyTagDelta(tagString(current),add,remove);return {add,remove,problem:null};}catch{return {add,remove,problem:'full' as const};}
}
