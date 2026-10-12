import {createHash} from 'node:crypto';
export class EditorialError extends Error {constructor(public code:string,public status=400){super(code);}}
export const fail=(code:string,status=400):never=>{throw new EditorialError(code,status);};
export const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
export const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
export function canonical(v:unknown):string {return JSON.stringify(sort(v));}
function sort(v:unknown):unknown {return Array.isArray(v)?v.map(sort):object(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v;}
function text(v:unknown,max:number){return typeof v==='string'&&v.trim().length>0&&v.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v);}
export const sqlTime=(d:Date)=>d.toISOString().slice(0,23).replace('T',' ');
export const decode=(v:unknown)=>typeof v==='string'?JSON.parse(v):v;
export interface SourceInput {kind:'video'|'daily'|'event'|'story'|'article';sourceId:string;headline?:string;url?:string;publishedAt?:string;observedAt?:string;sourceVersion?:string;sourceSha256?:string;publisher?:string}
export interface Command {requestId:string;action:'create'|'rename'|'attach'|'refresh'|'merge'|'split'|'candidate.submit'|'candidate.approve'|'candidate.reject';reason:string;id:string;title?:string;targetId?:string;expectedVersion?:number;targetVersion?:number;sourceIds?:string[];sources?:SourceInput[];channelId?:string;proposedName?:string}
export function parseCommand(raw:unknown):Command {
 if(!object(raw))return fail('INVALID_COMMAND');
 const allowed=['requestId','action','reason','id','title','targetId','expectedVersion','targetVersion','sourceIds','sources','channelId','proposedName'];
 if(Object.keys(raw).some(k=>!allowed.includes(k))||!uuid(raw.requestId)||!uuid(raw.id)||!text(raw.reason,2000)||!['create','rename','attach','refresh','merge','split','candidate.submit','candidate.approve','candidate.reject'].includes(String(raw.action)))return fail('INVALID_COMMAND');
 const c=raw as unknown as Command;
 const fields:Record<Command['action'],string[]>={create:['title','sources'],rename:['title','expectedVersion'],attach:['sources','expectedVersion'],refresh:['sources','expectedVersion'],merge:['targetId','expectedVersion','targetVersion'],split:['targetId','title','expectedVersion','sourceIds'],'candidate.submit':['channelId','proposedName'],'candidate.approve':['expectedVersion'],'candidate.reject':['expectedVersion']};
 const extra=fields[c.action];if(Object.keys(raw).some(k=>!['requestId','action','reason','id',...extra].includes(k)))return fail('UNEXPECTED_FIELD');
 if(extra.includes('title')&&!text(c.title,300))return fail('INVALID_TITLE');
 for(const field of ['expectedVersion','targetVersion'] as const)if(extra.includes(field)&&(!Number.isSafeInteger(c[field])||c[field]!<1))return fail('VERSION_REQUIRED');
 if(extra.includes('targetId')&&(!uuid(c.targetId)||c.targetId===c.id))return fail('INVALID_TARGET');
 if(c.action==='candidate.submit'&&(!/^UC[A-Za-z0-9_-]{22}$/.test(c.channelId??'')||!text(c.proposedName,300)))return fail('INVALID_CHANNEL');
 if(extra.includes('sources')){if(!Array.isArray(c.sources)||c.sources.length<1||c.sources.length>25)return fail('SOURCE_LIMIT');c.sources=c.sources.map(parseSource);if(new Set(c.sources.map(s=>s.kind+':'+s.sourceId)).size!==c.sources.length)return fail('DUPLICATE_SOURCE');}
 if(c.action==='split'&&(!Array.isArray(c.sourceIds)||c.sourceIds.length<1||c.sourceIds.length>100||c.sourceIds.some(s=>!uuid(s))||new Set(c.sourceIds).size!==c.sourceIds.length))return fail('INVALID_SPLIT_SELECTION');
 return c;
}
function parseSource(v:unknown):SourceInput {
 if(!object(v)||Object.keys(v).some(k=>!['kind','sourceId','headline','url','publishedAt','observedAt','sourceVersion','sourceSha256','publisher'].includes(k))||!['video','daily','event','story','article'].includes(String(v.kind))||!text(v.sourceId,500))return fail('INVALID_SOURCE');
 if(v.kind!=='article'){if(Object.keys(v).some(k=>!['kind','sourceId'].includes(k)))return fail('LOCAL_SOURCE_IS_SERVER_RESOLVED');const pattern=v.kind==='video'?/^[A-Za-z0-9_-]{11}$/:v.kind==='daily'?/^[1-9]\d{0,14}:(?:0|[1-9]\d{0,3})$/:/^[1-9]\d{0,14}$/;if(!pattern.test(String(v.sourceId)))return fail('INVALID_SOURCE_ID');}
 else {if(Object.keys(v).some(k=>!['kind','sourceId','headline','url','sourceVersion'].includes(k))||!text(v.headline,1000)||!text(v.sourceVersion,100)||!/^\d{1,24}$/.test(String(v.sourceId)))return fail('ARTICLE_PROVENANCE_REQUIRED');safeUrl(v.url);}
 return v as unknown as SourceInput;
}
export function safeUrl(value:unknown):string {if(typeof value!=='string'||value.length>2000)return fail('INVALID_SOURCE_URL');try{const u=new URL(value);if(!['https:','http:'].includes(u.protocol)||u.username||u.password||!u.hostname)return fail('INVALID_SOURCE_URL');return u.href;}catch{return fail('INVALID_SOURCE_URL');}}
export function actorFrom(env:NodeJS.ProcessEnv){if(!text(env.TS_OPS_ACTOR,100))return fail('ACTOR_NOT_CONFIGURED',503);return env.TS_OPS_ACTOR!;}
