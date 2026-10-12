import {createHmac,hkdfSync,randomBytes,timingSafeEqual} from 'node:crypto';
import type {AuthConfig} from './types.js';
export const PRODUCTION_ORIGIN='https://youtube.observe.tw';
export function authConfig(env:NodeJS.ProcessEnv=process.env):{config:AuthConfig|null;reason?:string}{
 const clientId=env.GOOGLE_CLIENT_ID?.trim(),clientSecret=env.GOOGLE_CLIENT_SECRET?.trim(),secret=env.AUTH_SESSION_SECRET;
 if(!clientId&&!clientSecret&&!secret)return{config:null,reason:'unconfigured'};
 if(!clientId||!clientSecret||!secret)return{config:null,reason:'incomplete_config'};
 if(Buffer.byteLength(secret)<32||Buffer.byteLength(secret)>4096)return{config:null,reason:'invalid_session_secret'};
 const mode=env.APP_ENV??(env.NODE_ENV==='production'?'production':'local');
 if(!['production','preview','local'].includes(mode)&&!(mode==='test'&&env.NODE_ENV==='test'))return{config:null,reason:'invalid_environment'};
 if(mode!=='production'&&!env.AUTH_PUBLIC_ORIGIN)return{config:null,reason:'invalid_origin'};
 try{const raw=env.AUTH_PUBLIC_ORIGIN??PRODUCTION_ORIGIN,url=new URL(raw);
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash||url.origin!==raw)return{config:null,reason:'invalid_origin'};
  if(mode==='production'&&url.origin!==PRODUCTION_ORIGIN)return{config:null,reason:'invalid_production_origin'};
  if(mode==='preview'&&(url.protocol!=='https:'||url.origin===PRODUCTION_ORIGIN))return{config:null,reason:'invalid_preview_origin'};
  if((mode==='local'||mode==='test')&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))return{config:null,reason:'invalid_local_origin'};
  const admins=new Set((env.AUTH_ADMIN_EMAILS??'').split(',').map(v=>v.trim().toLowerCase()).filter(Boolean));
  if(admins.size>100||[...admins].some(v=>v.length>255||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)))return{config:null,reason:'invalid_admin_allowlist'};
  return{config:{clientId,clientSecret,secret,origin:url.origin,admins}};
 }catch{return{config:null,reason:'invalid_origin'};}
}
export const callbackUrl=(config:Pick<AuthConfig,'origin'>)=>config.origin+'/auth/google/callback';
export const opaqueToken=()=>randomBytes(32).toString('base64url');
export const validToken=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value);
export function tokenDigest(config:Pick<AuthConfig,'secret'>,purpose:'session'|'flow'|'state'|'csrf',value:string){
 const key=hkdfSync('sha256',config.secret,'youtube-board-auth-v1',purpose,32);return createHmac('sha256',Buffer.from(key)).update(value).digest('hex');
}
export function equalToken(a:unknown,b:string){if(typeof a!=='string'||a.length!==b.length)return false;const left=Buffer.from(a),right=Buffer.from(b);return left.length===right.length&&timingSafeEqual(left,right);}
export function safeNext(value:unknown,origin=PRODUCTION_ORIGIN){
 if(typeof value!=='string'||value.length>512||!value.startsWith('/')||value.startsWith('//')||/[\\\u0000-\u001f\u007f]/.test(value))return'/my';
 try{const url=new URL(value,origin),decoded=decodeURIComponent(url.pathname);if(url.origin!==origin||decoded.startsWith('//')||/[\\\u0000-\u001f\u007f]/.test(decoded)||/^\/auth(?:\/|$)/i.test(decoded))return'/my';return url.pathname+url.search+url.hash;}catch{return'/my';}
}
export function cookieNames(origin:string){return origin.startsWith('https:')?{session:'__Host-yt_session',flow:'__Host-yt_oauth'}:{session:'yt_dev_session',flow:'yt_dev_oauth'};}
export function authCookie(origin:string,name:string,value:string,maxAge:number){return`${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${origin.startsWith('https:')?'; Secure':''}`;}
export function readCookie(header:string|undefined,name:string){
 const found=(header??'').split(';').map(v=>v.trim()).filter(v=>v.startsWith(name+'='));if(found.length!==1)return null;const value=found[0]!.slice(name.length+1);return validToken(value)?value:null;
}

/** Verify opaque cookie in memory before DB lookup. */
export function signedCookieToken(config:Pick<AuthConfig,'secret'>,name:string,raw:string){
 const tag=createHmac('sha256',Buffer.from(hkdfSync('sha256',config.secret,'youtube-board-auth-v1','cookie:'+name,32))).update(raw).digest('base64url').slice(0,22);return raw+'.'+tag;
}
export function readSignedCookie(config:Pick<AuthConfig,'secret'>,header:string|undefined,name:string){
 const found=(header??'').split(';').map(v=>v.trim()).filter(v=>v.startsWith(name+'='));if(found.length!==1)return null;
 const value=found[0]!.slice(name.length+1);if(!/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{22}$/.test(value))return null;
 const raw=value.slice(0,43);return equalToken(value,signedCookieToken(config,name,raw))?raw:null;
}
