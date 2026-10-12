import {createRemoteJWKSet,customFetch,jwtVerify,type JWTVerifyGetKey} from 'jose';
import {callbackUrl,equalToken} from './config.js';
import type {AuthConfig,GoogleIdentity,GoogleProvider} from './types.js';
const JWKS='https://www.googleapis.com/oauth2/v3/certs',TOKEN='https://oauth2.googleapis.com/token';
export class ProviderFailure extends Error{constructor(){super('google_provider_failed');}}
async function boundedBody(response:Response,max=65536){
 if(!response.ok||Number(response.headers.get('content-length')??0)>max)throw new ProviderFailure();
 const reader=response.body?.getReader();if(!reader)throw new ProviderFailure();const chunks:Uint8Array[]=[];let size=0;
 try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>max)throw new ProviderFailure();chunks.push(part.value);}return Buffer.concat(chunks).toString('utf8');}finally{await reader.cancel().catch(()=>{});}
}
export function verifiedIdentity(claims:Record<string,unknown>,config:AuthConfig,nonce:string,now:Date):GoogleIdentity|null{
 const{iss,aud,azp,exp,iat,sub,email,email_verified:verified,name,picture}=claims,seconds=+now/1000;
 if(!['https://accounts.google.com','accounts.google.com'].includes(String(iss)))return null;
 const audiences=typeof aud==='string'?[aud]:Array.isArray(aud)?aud:[];
 if(!audiences.includes(config.clientId)||(azp!==undefined&&azp!==config.clientId)||(audiences.length>1&&azp!==config.clientId))return null;
 if(typeof exp!=='number'||typeof iat!=='number'||!Number.isFinite(exp)||!Number.isFinite(iat)||exp<=seconds||iat>seconds+60||iat<seconds-3660||exp>iat+7200||!equalToken(claims.nonce,nonce))return null;
 if(typeof sub!=='string'||!/^[A-Za-z0-9_-]{1,255}$/.test(sub)||verified!==true||typeof email!=='string')return null;
 const normalized=email.trim().toLowerCase();if(normalized.length>255||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized))return null;
 let photo:string|null=null;if(typeof picture==='string'&&picture.length<=512)try{const url=new URL(picture);if(url.protocol==='https:'&&!url.username&&!url.password)photo=url.href;}catch{}
 return{sub,email:normalized,name:typeof name==='string'&&name.trim()?name.trim().slice(0,255):null,picture:photo};
}
/** Test overrides are constructor-injected only; request/env cannot choose endpoints or verification keys. */
export function googleProvider(config:AuthConfig,options:{fetcher?:typeof fetch;keyResolver?:JWTVerifyGetKey}={}):GoogleProvider{
 const fetcher=options.fetcher??fetch;
 const keys=options.keyResolver??createRemoteJWKSet(new URL(JWKS),{timeoutDuration:15000,cooldownDuration:30000,cacheMaxAge:600000,[customFetch]:async(url,init)=>{
  if(String(url)!==JWKS)throw new ProviderFailure();const response=await fetcher(JWKS,{...init,redirect:'error',signal:AbortSignal.timeout(15000)});return new Response(await boundedBody(response),{status:200,headers:{'content-type':'application/json'}});
 }});
 return{async authenticate({code,verifier,nonce,now}){try{
  const response=await fetcher(TOKEN,{method:'POST',redirect:'error',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code,code_verifier:verifier,client_id:config.clientId,client_secret:config.clientSecret,redirect_uri:callbackUrl(config),grant_type:'authorization_code'}),signal:AbortSignal.timeout(15000)});
  const parsed=JSON.parse(await boundedBody(response)) as {id_token?:unknown};if(typeof parsed.id_token!=='string'||parsed.id_token.length>32768)throw new ProviderFailure();
  const{payload}=await jwtVerify(parsed.id_token,keys,{algorithms:['RS256'],issuer:['https://accounts.google.com','accounts.google.com'],audience:config.clientId,requiredClaims:['iat','exp','sub','nonce','email','email_verified'],clockTolerance:60,currentDate:now,maxTokenAge:'1h'});
  const identity=verifiedIdentity(payload,config,nonce,now);if(!identity)throw new ProviderFailure();return identity;
 }catch{throw new ProviderFailure();}}};
}
