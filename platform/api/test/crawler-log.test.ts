import Fastify from 'fastify';
import {it,expect} from 'vitest';
import {registerCrawlerLog,crawlerPath,crawlerUserAgent} from '../src/seo/crawler-log.js';

it('records only crawler/discovery responses and excludes request secrets and queries',async()=>{
 const app=Fastify(),records:unknown[]=[];registerCrawlerLog(app,{emit:r=>records.push(r)});
 app.get('/*',async(_request,reply)=>reply.type('application/xml; charset=utf-8').send('<urlset/>'));
 try {
  await app.inject('/channels');expect(records).toHaveLength(0);
  await app.inject({url:'/sitemap.xml?token=private',headers:{authorization:'Bearer private',cookie:'private=1','cf-ray':'abcdeffedcba1234-TPE','user-agent':'Browser'}});
  expect(records[0]).toMatchObject({code:'CRAWLER_RESPONSE',method:'GET',path:'/sitemap.xml',status:200,bytes:9,cfRay:'abcdeffedcba1234-TPE'});
  await app.inject({url:'/keywords/private-term/videos?q=private',headers:{'user-agent':'Google-InspectionTool Smartphone','cf-ray':'invalid\tvalue'}});
  expect(records[1]).toMatchObject({path:'/keywords/:keyword',cfRay:null});
  await app.inject({method:'HEAD',url:'/robots.txt'});expect(records[2]).toMatchObject({method:'HEAD',bytes:0});
  expect(JSON.stringify(records)).not.toContain('private');
 }finally{await app.close();}
});
it('redacts private route identities, user-agent email/control characters and authorization strings',()=>{
 for(const path of ['/auth/google/callback?code=abc','/my/settings','/feeds/u/raw-rss-token.xml','/api/ops/editorial'])expect(crawlerPath(path)).toBe('/[private]');
 expect(crawlerPath('/search?q=personal')).toBe('/search');expect(crawlerPath('/other/personal-value')).toBe('/[other]');
 const ua=crawlerUserAgent('Googlebot\nemail@example.org Bearer secret https://example.org/?token=secret');
 expect(ua).not.toMatch(/email@example|secret|\n/);expect(ua).toContain('Googlebot');expect(crawlerUserAgent('x'.repeat(1000))).toBe('Other');
 expect(crawlerPath('/sitemap'+'secret'.repeat(4000)+'.xml')).toBe('/[other]');
 expect(crawlerPath('/sitemaps/keywords/ab.xml')).toBe('/sitemaps/keywords/ab.xml');
 expect(crawlerPath('/sitemaps/arbitrary-secret/ab.xml')).toBe('/[other]');
 expect(crawlerUserAgent('Googlebot token=fixture-secret session=fixture-session http://127.0.0.1/private')).toBe('Googlebot');
});
it('bounds log volume, summarizes suppression, and contains sink failures',async()=>{
 let now=new Date('2026-10-12T14:00:00Z');const records:unknown[]=[],app=Fastify();
 registerCrawlerLog(app,{limit:2,clock:()=>now,emit:r=>records.push(r)});app.get('/robots.txt',async()=> 'ok');
 try {
  for(let i=0;i<5;i++)expect((await app.inject('/robots.txt')).statusCode).toBe(200);
  expect(records).toHaveLength(2);now=new Date(+now+60000);await app.inject('/robots.txt');
  expect(records[2]).toEqual({code:'CRAWLER_LOG_SUPPRESSED',count:3});expect(records).toHaveLength(4);
 }finally{await app.close();}
 const broken=Fastify();registerCrawlerLog(broken,{emit:()=>{throw Error('sink');}});broken.get('/sitemap.xml',async()=> 'ok');
 try{expect((await broken.inject('/sitemap.xml')).statusCode).toBe(200);}finally{await broken.close();}
});
