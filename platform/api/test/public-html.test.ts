import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {publicScriptManifest,publicHtmlTtl,publicHtmlVary,upstreamPublicPolicy,publicMarkerMatches} from '../src/public-html.js';

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
  for(const key of ['cookie','authorization','rsc','next-router-state-tree','next-router-prefetch','next-router-segment-prefetch','next-url','x-nextjs-data','next-action']) expect(publicHtmlTtl({...base,headers:{[key]:''}})).toBeNull();
  expect(publicHtmlTtl({...base,headers:{accept:'text/x-component'}})).toBeNull();
  expect(publicHtmlTtl({...base,method:'HEAD'})).toBeNull();
  for(const url of ['/channels/%2e%2e/my','//channels','/channels/','/channels%2F8','/channels/../videos','/channels//8'])expect(publicHtmlTtl({...base,url})).toBeNull();
  expect(publicMarkerMatches('home','/')).toBe(true);
  expect(publicMarkerMatches('events','/events')).toBe(true);
  for(const marker of [undefined,'','v1','home','events','event'])expect(publicMarkerMatches(marker,'/channels')).toBe(false);
  expect(publicHtmlVary('Accept-Encoding, RSC')).toContain('Accept-Encoding');
  expect(publicHtmlVary('Accept-Encoding, RSC').split(', ').filter(s=>s==='RSC')).toHaveLength(1);
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
