import {beforeAll,it,expect} from 'vitest';
import {generateKeyPair,exportJWK,SignJWT,createLocalJWKSet,type CryptoKey} from 'jose';
import {authConfig} from '../src/auth/config.js';
import {googleProvider,verifiedIdentity} from '../src/auth/provider.js';
import {authEnv} from './auth-fixture.js';
const now=new Date('2026-10-12T01:00:00Z'),seconds=+now/1000,config=authConfig(authEnv).config!,nonce='n'.repeat(43);
let privateKey:CryptoKey,jwk:Awaited<ReturnType<typeof exportJWK>>;
beforeAll(async()=>{const keys=await generateKeyPair('RS256');privateKey=keys.privateKey;jwk={...await exportJWK(keys.publicKey),kid:'fixture-key',alg:'RS256',use:'sig'};});
const claims={iss:'https://accounts.google.com',aud:config.clientId,azp:config.clientId,iat:seconds,exp:seconds+3600,sub:'123456',email:'Reader@Example.Test',email_verified:true,nonce,name:'Fixture'};
const sign=(overrides:Record<string,unknown>={},kid='fixture-key')=>new SignJWT({...claims,...overrides}).setProtectedHeader({alg:'RS256',kid}).sign(privateKey);
const input={code:'fixture-code',verifier:'v'.repeat(43),nonce,now};
it('real RS256 verification checks issuer/audience/nonce and uses the fixed exact callback',async()=>{
 const token=await sign(),requests:{url:string;init?:RequestInit}[]=[];
 const provider=googleProvider(config,{keyResolver:createLocalJWKSet({keys:[jwk]}),fetcher:(async(url,init)=>{requests.push({url:String(url),init});return new Response(JSON.stringify({id_token:token}));}) as typeof fetch});
 expect(await provider.authenticate(input)).toMatchObject({sub:'123456',email:'reader@example.test',name:'Fixture'});expect(requests).toHaveLength(1);expect(requests[0]!.url).toBe('https://oauth2.googleapis.com/token');expect(requests[0]!.init?.redirect).toBe('error');const body=new URLSearchParams(String(requests[0]!.init?.body));expect(body.get('redirect_uri')).toBe('http://localhost:3100/auth/google/callback');expect(body.get('code_verifier')).toBe(input.verifier);
});
it('signed tokens with invalid claims fail closed with sanitized errors',async()=>{
 for(const override of [{nonce:'wrong'},{iss:'https://elsewhere.test'},{aud:'different'},{azp:'different'},{exp:seconds-1},{iat:seconds+61},{iat:seconds-4000},{email_verified:false},{sub:''},{email:'not-email'},{aud:[config.clientId,'other'],azp:undefined}]){
  const token=await sign(override),provider=googleProvider(config,{keyResolver:createLocalJWKSet({keys:[jwk]}),fetcher:(async()=>new Response(JSON.stringify({id_token:token}))) as typeof fetch});await expect(provider.authenticate(input)).rejects.toThrow('google_provider_failed');
 }
});
it('missing signature, incorrect signature and non-RS256 tokens are rejected',async()=>{
 const token=await sign(),parts=token.split('.'),hmac=await new SignJWT(claims).setProtectedHeader({alg:'HS256'}).sign(new TextEncoder().encode('test-signing-secret-long-enough-32'));
 for(const invalid of [parts[0]+'.'+parts[1]+'.',parts[0]+'.'+parts[1]+'.'+Buffer.alloc(256).toString('base64url'),hmac]){const provider=googleProvider(config,{keyResolver:createLocalJWKSet({keys:[jwk]}),fetcher:(async()=>new Response(JSON.stringify({id_token:invalid}))) as typeof fetch});await expect(provider.authenticate(input)).rejects.toThrow('google_provider_failed');}
});
it('native JWKS endpoint is fixed, cached and unknown key IDs cannot silently bypass verification',async()=>{
 let token=await sign(),jwksFetches=0;const urls:string[]=[];const provider=googleProvider(config,{fetcher:(async(url)=>{urls.push(String(url));if(String(url)==='https://www.googleapis.com/oauth2/v3/certs'){jwksFetches++;return new Response(JSON.stringify({keys:[jwk]}));}return new Response(JSON.stringify({id_token:token}));}) as typeof fetch});
 await provider.authenticate(input);await provider.authenticate(input);expect(jwksFetches).toBe(1);token=await sign({},'unknown-key');await expect(provider.authenticate(input)).rejects.toThrow('google_provider_failed');expect(jwksFetches).toBe(1);expect(new Set(urls)).toEqual(new Set(['https://www.googleapis.com/oauth2/v3/certs','https://oauth2.googleapis.com/token']));
});
it('provider response body is bounded and upstream diagnostic text never escapes',async()=>{
 for(const response of [new Response('x'.repeat(65537)),new Response(JSON.stringify({error_description:'fixture-sensitive-diagnostic'}),{status:400}),new Response('not-json')]){const provider=googleProvider(config,{keyResolver:createLocalJWKSet({keys:[jwk]}),fetcher:(async()=>response) as typeof fetch});await expect(provider.authenticate(input)).rejects.toThrow(/^google_provider_failed$/);}
});
it('claims normalize verified email only and reject Unicode nonce without throwing',()=>{expect(verifiedIdentity({...claims,nonce:'測'.repeat(43)},config,nonce,now)).toBeNull();expect(verifiedIdentity({...claims,email:' Reader@Example.Test '},config,nonce,now)?.email).toBe('reader@example.test');});
