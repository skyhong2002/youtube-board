import {createHash} from 'node:crypto';
export class ReviewError extends Error {constructor(public code:string,public status=400){super(code);}}
export const fail=(code:string,status=400):never=>{throw new ReviewError(code,status);};
export const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
export type Context='youtube-ranking-display'|'youtube-text-matching';
export interface Evidence {vocabularyVersion:string;termKey:string;rawTerm:string;ruleVersion:string;payload:unknown;source:'https://tag.observe.tw';sha256:string}
export interface Review {id:string;revision:number;status:'pending'|'approved'|'rejected';decision:'keep'|'exclude';context:Context;evidence:Evidence;submittedBy:string;reason:string;applied:false;applicationStatus:'not-applied';createdAt:string;updatedAt:string}
export interface Command {requestId:string;id:string;action:'submit'|'approve'|'reject';reason:string;expectedRevision?:number;vocabularyVersion?:string;termKey?:string;ruleVersion?:string;context?:Context;decision?:'keep'|'exclude'}
export interface Plan {command:Command;before:Review|null;after:Review;actor:string;previewHash:string;writes:0;applied:false;applicationStatus:'not-applied';warnings:string[]}
export function parseCommand(raw:unknown):Command {
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return fail('INVALID_REVIEW_COMMAND');
 const r=raw as Record<string,unknown>,action=r.action;
 const fields=action==='submit'?['vocabularyVersion','termKey','ruleVersion','context','decision']:['expectedRevision'];
 if(typeof action!=='string'||!['submit','approve','reject'].includes(action)||Object.keys(r).some(k=>!['requestId','id','action','reason',...fields].includes(k))||!uuid(r.id)||!uuid(r.requestId)||typeof r.reason!=='string'||r.reason.trim().length<1||r.reason.length>2000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(r.reason))return fail('INVALID_REVIEW_COMMAND');
 if(action==='submit'){
  if(typeof r.vocabularyVersion!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(r.vocabularyVersion)||typeof r.termKey!=='string'||!/^[a-f0-9]{64}$/.test(r.termKey)||typeof r.ruleVersion!=='string'||!['exact-text-v1','youtube-quality-v2'].includes(r.ruleVersion)||typeof r.context!=='string'||!['youtube-ranking-display','youtube-text-matching'].includes(r.context)||typeof r.decision!=='string'||!['keep','exclude'].includes(r.decision))return fail('INVALID_REVIEW_TARGET');
 }else if(!Number.isSafeInteger(r.expectedRevision)||Number(r.expectedRevision)<1)return fail('REVISION_REQUIRED');
 // Fixed key ordering makes input hashes independent of JSON property order.
 return {requestId:r.requestId,id:r.id,action:action as Command['action'],reason:r.reason.trim(),...(action==='submit'?{vocabularyVersion:r.vocabularyVersion as string,termKey:r.termKey as string,ruleVersion:r.ruleVersion as string,context:r.context as Context,decision:r.decision as 'keep'|'exclude'}:{expectedRevision:r.expectedRevision as number})};
}
export function planReview(command:Command,before:Review|null,evidence:Evidence|null,actor:string,at:string):Plan {
 if(!/^user:[1-9]\d*$/.test(actor))return fail('ADMIN_ACTOR_REQUIRED',403);
 let after:Review;
 if(command.action==='submit'){
  if(before)return fail('REVIEW_EXISTS',409);
  if(!evidence||evidence.vocabularyVersion!==command.vocabularyVersion||evidence.termKey!==command.termKey||evidence.ruleVersion!==command.ruleVersion)return fail('REVIEW_SOURCE_CHANGED',409);
  after={id:command.id,revision:1,status:'pending',decision:command.decision!,context:command.context!,evidence,submittedBy:actor,reason:command.reason,applied:false,applicationStatus:'not-applied',createdAt:at,updatedAt:at};
 }else{
  if(!before)return fail('REVIEW_NOT_FOUND',404);
  if(before.revision!==command.expectedRevision)return fail('REVISION_CONFLICT',409);
  if(before.status!=='pending')return fail('REVIEW_ALREADY_DECIDED',409);
  after={...before,revision:before.revision+1,status:command.action==='approve'?'approved':'rejected',updatedAt:at};
 }
 const warnings=['覆核只記錄提案與決策，尚未套用排行或文字比對；原始詞彙與命中證據保留。'];
 // Clock is execution metadata, not a mutable preview identity.
 const canonicalState=(r:Review|null)=>r?{...r,createdAt:undefined,updatedAt:undefined}:null;
 const previewHash=hash({command,before:canonicalState(before),after:canonicalState(after),actor,warnings});
 return {command,before,after,actor,previewHash,writes:0,applied:false,applicationStatus:'not-applied',warnings};
}
