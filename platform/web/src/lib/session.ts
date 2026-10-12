'use client';
import {useEffect,useSyncExternalStore} from 'react';
import type {AccountSession} from '../../../shared/account-contracts';
import {AccountError,accountMessage,isAccountSession} from './account-client';
export {loginHref} from './account-client';
type State={session:AccountSession|null;loading:boolean;error:string};
const initial:State={session:null,loading:true,error:''};let state=initial,pending:Promise<AccountSession|null>|null=null;const listeners=new Set<()=>void>();
const emit=(next:State)=>{state=next;listeners.forEach(listener=>listener());};
export const sessionSnapshot=()=>state.session;
export function refreshSession(){if(pending)return pending;emit({...state,loading:true,error:''});pending=fetch('/auth/me',{cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(12000)}).then(async r=>{const value:unknown=await r.json();if(!r.ok||!isAccountSession(value))throw new AccountError('AUTH_UNAVAILABLE');emit({session:value,loading:false,error:''});return value;}).catch(error=>{emit({session:null,loading:false,error:accountMessage(error)});return null;}).finally(()=>{pending=null;});return pending;}
export const subscribeSession=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
export function useSessionState(){const value=useSyncExternalStore(subscribeSession,()=>state,()=>initial);useEffect(()=>{if(state===initial)void refreshSession();const focus=()=>void refreshSession();window.addEventListener('focus',focus);return()=>window.removeEventListener('focus',focus);},[]);return value;}
export function useSession(){return useSessionState().session;}
export async function logout(){const session=state.session;if(!session?.csrfToken)throw new AccountError('SIGN_IN_REQUIRED');let r:Response;try{r=await fetch('/auth/logout',{method:'POST',headers:{'x-csrf-token':session.csrfToken},cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(12000)});}catch{throw new AccountError('ACCOUNT_UNAVAILABLE');}if(!r.ok)throw new AccountError('ACCOUNT_UNAVAILABLE');emit({session:{enabled:true,user:null,csrfToken:null},loading:false,error:''});window.location.assign('/');}
