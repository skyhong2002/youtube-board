/** Adapted from tag.analysis.tw afe0a653 app/src/auth/{google-login,store}.ts. */
import type {AccountSession} from '../../../shared/account-contracts.js';
import type {FastifyReply,FastifyRequest} from 'fastify';
export type Role='admin'|'reader';
export interface GoogleIdentity{sub:string;email:string;name:string|null;picture:string|null}
export interface AuthConfig{clientId:string;clientSecret:string;origin:string;secret:string;admins:Set<string>}
export interface StoredUser extends GoogleIdentity{id:number;adminGrantedBy:number|null;adminGrantedAt:string|null;configAdminEmail:string|null;disabledAt:string|null;createdAt:string;lastLoginAt:string}
export type SessionUser=NonNullable<AccountSession['user']>;
export interface OAuthFlow{bindingHash:string;stateHash:string;nonce:string;verifier:string;next:string;createdAt:Date;expiresAt:Date}
export interface GoogleProvider{authenticate(input:{code:string;verifier:string;nonce:string;now:Date}):Promise<GoogleIdentity>}
export interface AuthStore{
 ready():Promise<boolean>;close():Promise<void>;
 putFlow(flow:OAuthFlow):Promise<boolean>;consumeFlow(bindingHash:string,stateHash:string,at:Date):Promise<OAuthFlow|null>;
 upsertUser(identity:GoogleIdentity,admins:ReadonlySet<string>,at:Date):Promise<StoredUser>;
 rotateSession(hash:string,userId:number,expiresAt:Date,oldHash:string|null,at:Date):Promise<boolean>;
 sessionUser(hash:string,at:Date):Promise<StoredUser|null>;deleteSession(hash:string):Promise<void>;
 listUsers():Promise<StoredUser[]>;
 setAdmin(targetId:number,admin:boolean,actorId:number,admins:ReadonlySet<string>,at:Date):Promise<'ok'|'not_found'|'forbidden'|'self'|'config'>;
}
export interface AuthRuntime{
 enabled:boolean;origin:string;
 currentUser(request:FastifyRequest):Promise<SessionUser|null>;
 requireReader(request:FastifyRequest,reply:FastifyReply,write?:boolean):Promise<SessionUser|null>;
 requireAdmin(request:FastifyRequest,reply:FastifyReply,write?:boolean):Promise<SessionUser|null>;
 actor(user:Pick<SessionUser,'id'>):string;
}
export function sessionView(user:StoredUser,admins:ReadonlySet<string>):SessionUser|null{
 if(user.disabledAt)return null;
 const adminSource=user.configAdminEmail===user.email&&admins.has(user.email)?'config':user.adminGrantedAt&&user.adminGrantedBy!==null?'granted':null;
 return{id:user.id,email:user.email,name:user.name,picture:user.picture,role:adminSource?'admin':'reader',adminSource};
}
