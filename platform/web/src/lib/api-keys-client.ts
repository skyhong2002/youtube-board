import type {IssuedPersonalApiKey,PersonalApiKey,PersonalApiKeys} from '../../../shared/api-key-contracts';
import {PERSONAL_API_KEY_LABEL_MAX,PERSONAL_API_KEYS_MAX} from '../../../shared/api-key-contracts';
import {AccountError} from './account-client';
/** Pure response checks for /auth/me/api-keys. IDs stay decimal strings (BIGINT): never Number(). */
const ID=/^[1-9]\d{0,19}$/,TIME=(v:unknown)=>typeof v==='string'&&!Number.isNaN(Date.parse(v));
export function isPersonalApiKey(value:unknown):value is PersonalApiKey{if(!value||typeof value!=='object')return false;const k=value as PersonalApiKey;return typeof k.id==='string'&&ID.test(k.id)&&typeof k.prefix==='string'&&typeof k.label==='string'&&TIME(k.createdAt)&&(k.lastUsedAt===null||TIME(k.lastUsedAt))&&(k.revokedAt===null||TIME(k.revokedAt));}
export function parseApiKeys(value:unknown):PersonalApiKey[]{const keys=(value as PersonalApiKeys|null)?.keys;if(!Array.isArray(keys)||!keys.every(isPersonalApiKey))throw new AccountError('ACCOUNT_UNAVAILABLE');return keys;}
export function parseIssuedKey(value:unknown):IssuedPersonalApiKey{const v=value as IssuedPersonalApiKey|null;if(!v||!isPersonalApiKey(v.key)||typeof v.token!=='string'||!v.token.startsWith('ytb_')||v.key.revokedAt!==null)throw new AccountError('ACCOUNT_UNAVAILABLE');return {key:v.key,token:v.token};}
export const activeKeys=(keys:PersonalApiKey[])=>keys.filter(k=>k.revokedAt===null);
export const canCreateKey=(keys:PersonalApiKey[])=>activeKeys(keys).length<PERSONAL_API_KEYS_MAX;
/** Trimmed label, or null when empty, too long or carrying control characters. */
export function cleanLabel(value:string):string|null{const label=value.trim();return label&&[...label].length<=PERSONAL_API_KEY_LABEL_MAX&&!/[\u0000-\u001f\u007f]/.test(label)?label:null;}
export const keyPath=(id?:string)=>{if(id!==undefined&&!ID.test(id))throw new AccountError('INVALID_REQUEST');return id===undefined?'/auth/me/api-keys':`/auth/me/api-keys/${id}`;};
