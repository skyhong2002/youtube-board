'use client';
import {useEffect,useSyncExternalStore} from 'react';
import type {AccountFollow,AccountFollowKind,AccountSave,AccountSaveKind} from '../../../shared/account-contracts';
import {AccountError,accountFetch,accountMessage} from './account-client';
import {refreshSession,sessionSnapshot,subscribeSession,useSession} from './session';
export const FOLLOW_NOUN={channel:'頻道',tag:'標籤',event:'事件'};
export const when=(value:string)=>new Date(value).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',dateStyle:'medium',timeStyle:'short'});
export async function readerFetch<T>(path:string,options:Parameters<typeof accountFetch>[2]={}):Promise<T>{try{return await accountFetch<T>(path,sessionSnapshot(),options);}catch(error){if(error instanceof AccountError&&error.code==='SIGN_IN_REQUIRED')void refreshSession();throw error;}}
function resource<T>(key:'follows'|'saves'){
 type State={owner:number|null;data:T[]|null;error:string;loading:boolean};const initial:State={owner:null,data:null,error:'',loading:false};let state=initial,pending:Promise<void>|null=null,generation=0;const listeners=new Set<()=>void>();
 const emit=(value:State)=>{state=value;listeners.forEach(fn=>fn());};
 subscribeSession(()=>{const owner=sessionSnapshot()?.user?.id??null;if(owner!==state.owner){generation++;pending=null;emit({...initial,owner});}});
 async function load(){const owner=sessionSnapshot()?.user?.id??null;if(!owner)return;if(pending)return pending;const seq=generation;emit({...state,owner,loading:true,error:''});pending=readerFetch<Record<string,T[]>>('/auth/me/'+key).then(data=>{if(seq===generation&&owner===sessionSnapshot()?.user?.id){if(!Array.isArray(data[key]))throw new AccountError('ACCOUNT_UNAVAILABLE');emit({owner,data:data[key],error:'',loading:false});}}).catch(error=>{if(seq===generation)emit({...state,loading:false,error:accountMessage(error)});}).finally(()=>{if(seq===generation)pending=null;});return pending;}
 function useValue(){const session=useSession(),value=useSyncExternalStore(fn=>{listeners.add(fn);return()=>{listeners.delete(fn);};},()=>state,()=>initial);useEffect(()=>{if(session?.user&&!state.data&&!state.loading&&!state.error)void load();},[session?.user?.id,value]);return value.owner===(session?.user?.id??null)?value:initial;}
 let mutations=Promise.resolve();
 async function write(body:unknown){const owner=sessionSnapshot()?.user?.id;if(!owner)throw new AccountError('SIGN_IN_REQUIRED');const result=mutations.then(async()=>{if(owner!==sessionSnapshot()?.user?.id)throw new AccountError('SIGN_IN_REQUIRED');const data=await readerFetch<Record<string,T[]>>('/auth/me/'+key,{method:'PUT',body});if(owner!==sessionSnapshot()?.user?.id)return;if(!Array.isArray(data[key]))throw new AccountError('ACCOUNT_UNAVAILABLE');generation++;pending=null;emit({owner,data:data[key],loading:false,error:''});});mutations=result.catch(()=>{});return result;}
 return {useValue,reload:load,write};
}
export const follows=resource<AccountFollow>('follows'),saves=resource<AccountSave>('saves');
export const setFollow=(kind:AccountFollowKind,target:string,follow:boolean)=>follows.write({kind,target,follow});
export const setSave=(kind:AccountSaveKind,target:string,saved:boolean,note?:string)=>saves.write({kind,target,saved,...(note===undefined?{}:{note})});
