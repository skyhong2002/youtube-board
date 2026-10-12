import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {publicScriptManifest,publicHtmlTtl,publicHtmlVary,upstreamPublicPolicy,publicMarkerMatches,htmlEncoding} from '../src/public-html.js';

it('shares ISR STALE for one second only within the upstream remaining stale budget',()=>{
  const policy='public, s-maxage=60, stale-while-revalidate=120';
  expect(upstreamPublicPolicy(policy,undefined,true)).toEqual({ttl:1,stale:119});
  expect(upstreamPublicPolicy(policy,'100',true)).toEqual({ttl:1,stale:79});
  expect(upstreamPublicPolicy(policy,'179',true)).toEqual({ttl:1,stale:0});
  for(const age of ['180','181','invalid','-1'])expect(upstreamPublicPolicy(policy,age,true)).toBeNull();
  for(const header of ['private, '+policy,'no-store, '+policy,'no-cache, '+policy,policy+', must-revalidate',policy+', proxy-revalidate','s-maxage=60','s-maxage=0, stale-while-revalidate=120'])expect(upstreamPublicPolicy(header,undefined,true)).toBeNull();
  for(let age=0;age<180;age++){
    const result=upstreamPublicPolicy(policy,String(age),true)!;
    expect(result.ttl+result.stale).toBeLessThanOrEqual(180-Math.max(age,60));
  }
});

it('negotiates Brotli/gzip quality, wildcard refusals and explicit identity without guessing malformed qualities',()=>{
  for(const [header,result] of [
    [undefined,'identity'],['','identity'],['br, gzip;q=0.8','br'],['gzip, br','br'],['br;q=0.3, gzip;q=0.9','gzip'],
    ['br;q=0,gzip;q=0.4','gzip'],['br;q=0,*;q=0.5','gzip'],['gzip;q=0,*;q=0.5','br'],['*','br'],
    ['gzip;q=0','identity'],['br;q=0.5,identity;q=1','identity'],['br;q=0.5,identity;q=0','br'],
    ['*;q=0',null],['identity;q=0,br;q=0,gzip;q=0',null],['br;q=oops,gzip;q=0.5','gzip'],
    ['br;q=1.1','identity'],['br;q=0,br;q=1,gzip;q=0.4','gzip'],['BR;Q=0.8,GZIP;Q=0.5','br'],
  ] as const)expect(htmlEncoding(header)).toBe(result);
});

it('never overrides upstream privacy, revalidation or remaining freshness',()=>{
  for(const value of ['private, s-maxage=60','no-store','s-maxage=60, no-cache','s-maxage=60,s-maxage=abc','s-maxage=NaN','public','s-maxage=0'])expect(upstreamPublicPolicy(value)).toBeNull();
  expect(upstreamPublicPolicy('s-maxage=5,stale-while-revalidate=1')).toEqual({ttl:5,stale:1});
  expect(upstreamPublicPolicy('s-maxage=5,stale-while-revalidate=1','4')).toEqual({ttl:1,stale:1});
  expect(upstreamPublicPolicy('s-maxage=5','5')).toBeNull();
  expect(upstreamPublicPolicy('s-maxage=5','invalid')).toBeNull();
  expect(upstreamPublicPolicy('s-maxage=60,stale-while-revalidate=10,must-revalidate')).toEqual({ttl:60,stale:0,revalidation:'must-revalidate'});
  expect(upstreamPublicPolicy('s-maxage=60')).toEqual({ttl:60,stale:0});
});

it('isolates private, query, credentials and every Next representation from anonymous HTML',()=>{
  const base={method:'GET',url:'/',headers:{}};
  expect(publicHtmlTtl(base)).toBe(60);
  expect(publicHtmlTtl({...base,url:'/live/current'})).toBe(30);
  for(const url of ['/my','/my/follows','/manage','/ops/ingestion','/auth/google','/feeds/u/token','/boards','/login','/render-filtered/channels','/?period=week']) expect(publicHtmlTtl({...base,url})).toBeNull();
  for(const key of ['cookie','authorization','x-api-key','rsc','next-router-state-tree','next-router-prefetch','next-router-segment-prefetch','next-url','x-nextjs-data','next-action']) expect(publicHtmlTtl({...base,headers:{[key]:''}})).toBeNull();
  expect(publicHtmlTtl({...base,headers:{accept:'text/x-component'}})).toBeNull();
  expect(publicHtmlTtl({...base,method:'HEAD'})).toBeNull();
  for(const url of ['/channels/%2e%2e/my','//channels','/channels/','/channels%2F8','/channels/../videos','/channels//8'])expect(publicHtmlTtl({...base,url})).toBeNull();
  expect(publicMarkerMatches('home','/')).toBe(true);
  expect(publicMarkerMatches('events','/events')).toBe(true);
  for(const marker of [undefined,'','v1','home','events','event'])expect(publicMarkerMatches(marker,'/channels')).toBe(false);
  expect(publicHtmlVary('Accept-Encoding, RSC')).toContain('Accept-Encoding');
  expect(publicHtmlVary('Accept-Encoding, RSC').split(', ').filter(s=>s==='RSC')).toHaveLength(1);
  expect(publicHtmlVary('x-api-key').split(', ').filter(s=>s.toLowerCase()==='x-api-key')).toEqual(['X-Api-Key']);
  expect(publicHtmlVary('*')).toBe('*');
});

it('hashes only immutable local JS files and refuses symlink escape',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'yt-sri-'));
  try {
    await mkdir(path.join(root,'chunks'));await writeFile(path.join(root,'chunks/app.js'),'console.log(1)');await writeFile(path.join(root,'chunks/style.css'),'x{}');
    const manifest=await publicScriptManifest(root);
    expect([...manifest]).toEqual([['/_next/static/chunks/app.js','sha256-'+createHash('sha256').update('console.log(1)').digest('base64')]]);
    await symlink('/tmp',path.join(root,'escaped'));
    await expect(publicScriptManifest(root)).rejects.toThrow('symlink');
  } finally {await rm(root,{recursive:true,force:true});}
});

it('registers canonical bracket URLs only for immutable dynamic-route chunks',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'yt-sri-webpack-'));
 try{await mkdir(path.join(root,'chunks','[...segments]'),{recursive:true});await writeFile(path.join(root,'chunks','[...segments]','page.js'),'window.route=true;');
  const manifest=await publicScriptManifest(root);expect(manifest.size).toBe(2);expect(manifest.get('/_next/static/chunks/%5B...segments%5D/page.js')).toBe(manifest.get('/_next/static/chunks/[...segments]/page.js'));
  expect(manifest.has('/_next/static/chunks/%255B...segments%255D/page.js')).toBe(false);
 }finally{await rm(root,{recursive:true,force:true});}
});

it('rejects immutable URL alias collisions and preserves optional catch-all encoding',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'yt-sri-alias-'));
 try{
  await mkdir(path.join(root,'chunks','[locale]','[[...slug]]'),{recursive:true});await writeFile(path.join(root,'chunks','[locale]','[[...slug]]','page.js'),'a()');
  const result=await publicScriptManifest(root);expect(result.size).toBe(2);expect(result.get('/_next/static/chunks/%5Blocale%5D/%5B%5B...slug%5D%5D/page.js')).toBe(result.get('/_next/static/chunks/[locale]/[[...slug]]/page.js'));
  await mkdir(path.join(root,'chunks','%5Blocale%5D','%5B%5B...slug%5D%5D'),{recursive:true});await writeFile(path.join(root,'chunks','%5Blocale%5D','%5B%5B...slug%5D%5D','page.js'),'different()');
  await expect(publicScriptManifest(root)).rejects.toThrow('alias collision');
 }finally{await rm(root,{recursive:true,force:true});}
});
