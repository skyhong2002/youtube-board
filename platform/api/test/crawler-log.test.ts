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

it('counts final streamed and compressed body bytes over real HTTP, including robots and no-body responses',async()=>{
 const {Readable}=await import('node:stream');
 const {gzipSync,brotliCompressSync}=await import('node:zlib');
 const {request}=await import('node:http');
 const body=Buffer.from('User-agent: *\nDisallow: /my\n'.repeat(80));
 const records:any[]=[],app=Fastify();registerCrawlerLog(app,{emit:r=>records.push(r)});
 app.get('/robots.txt',async(req,reply)=>{
  const encoding=req.headers['accept-encoding'];
  const data=encoding==='gzip'?gzipSync(body):encoding==='br'?brotliCompressSync(body):body;
  if(encoding==='gzip'||encoding==='br')reply.header('Content-Encoding',encoding);
  return reply.type('text/plain').send(Readable.from([data.subarray(0,7),data.subarray(7)]));
 });
 app.get('/sitemap.xml',async()=> '中文 XML');
 app.addHook('onSend',async(req,reply,payload)=>{
  if(req.url==='/sitemap.xml') {reply.removeHeader('content-length');return Buffer.from('最終 XML');}return payload;
 });
 app.get('/empty',async(_req,reply)=>reply.code(204).send());
 app.get('/unchanged',async(_req,reply)=>reply.code(304).send());
 const origin=await app.listen({port:0,host:'127.0.0.1'});
 const get=(path:string,method='GET',encoding='identity')=>new Promise<number>((resolve,reject)=>{
  request(origin+path,{method,headers:{'Accept-Encoding':encoding,'User-Agent':'Googlebot/2.1','cf-ipcountry':'TW','cf-ray':'abcdeffedcba1234-KIX'}},r=>{
   let size=0;r.on('data',(b:Buffer)=>{size+=b.length;});r.on('end',()=>resolve(size));r.on('error',reject);
  }).on('error',reject).end();
 });
 try{
  for(const encoding of ['identity','gzip','br']) {
   const size=await get('/robots.txt','GET',encoding);
   expect(size).toBe((encoding==='gzip'?gzipSync(body):encoding==='br'?brotliCompressSync(body):body).length);
   expect(records.at(-1)).toMatchObject({bytes:size,completed:true,cfCountry:'TW',cfColo:'KIX'});
  }
  for(const [path,method] of [['/robots.txt','HEAD'],['/empty','GET'],['/unchanged','GET']]){
   expect(await get(path!,method)).toBe(0);expect(records.at(-1)).toMatchObject({bytes:0,completed:true});
  }
  const size=await get('/sitemap.xml');expect(size).toBe(Buffer.byteLength('最終 XML'));expect(records.at(-1).bytes).toBe(size);
 }finally{await app.close();}
});

it('records aborted streams once as incomplete without retaining raw headers',async()=>{
 const {request}=await import('node:http');const {Readable}=await import('node:stream');
 const app=Fastify(),records:any[]=[];let closed=false;
 registerCrawlerLog(app,{emit:r=>records.push(r)});
 app.get('/robots.txt',async(_req,reply)=>{
  const stream=new Readable({read(){this.push('first');this._read=()=>{};}});
  stream.on('close',()=>{closed=true;});return reply.send(stream);
 });
 const origin=await app.listen({port:0,host:'127.0.0.1'});
 try {
  await new Promise<void>((resolve,reject)=>{
   const req=request(origin+'/robots.txt',{headers:{'cf-ray':'injected-token','cf-ipcountry':'private-value'}},res=>{
    res.once('data',()=>{res.destroy();resolve();});
   });req.on('error',reject);req.end();
  });
  for(let n=0;n<100&&!records.length;n++)await new Promise(r=>setTimeout(r,5));
  expect(records).toHaveLength(1);expect(records[0]).toMatchObject({bytes:5,completed:false,cfRay:null,cfCountry:null,cfColo:null});
  expect(closed).toBe(true);
 }finally{await app.close();}
});

it('verifies only the trusted ingress client and never trusts cf-verified-bot or logs its raw identity',async()=>{
 const calls:Array<[string,unknown]>=[],records:any[]=[],app=Fastify({trustProxy:['127.0.0.1']});
 const verifier={verify:(ip:string,agent:unknown)=>{calls.push([ip,agent]);return ip==='66.249.66.1';},close:async()=>{}};
 registerCrawlerLog(app,{verifier,emit:r=>records.push(r)});app.get('/robots.txt',async()=> 'ok');
 try {
  await app.inject({url:'/robots.txt',remoteAddress:'127.0.0.1',headers:{'x-forwarded-for':'104.16.0.1','cf-connecting-ip':'66.249.66.1','user-agent':'Googlebot/2.1'}});
  expect(calls[0]).toEqual(['66.249.66.1','Googlebot/2.1']);expect(records[0].verified).toBe(true);
  await app.inject({url:'/robots.txt',remoteAddress:'198.51.100.2',headers:{'x-forwarded-for':'66.249.66.1','cf-connecting-ip':'66.249.66.1','cf-verified-bot':'true','user-agent':'Googlebot/2.1'}});
  expect(calls[1]?.[0]).toBe('198.51.100.2');expect(records[1].verified).toBe(false);
  expect(JSON.stringify(records)).not.toMatch(/66\.249|198\.51|104\.16/);
 }finally{await app.close();}
});
it('finishes HTTP without waiting for DNS and emits bounded verification afterward',async()=>{
 let resolve!:(verified:boolean)=>void;
 const pending=new Promise<boolean>(r=>{resolve=r;}),records:any[]=[],app=Fastify();
 registerCrawlerLog(app,{emit:r=>records.push(r),verifier:{verify:()=>pending,close:async()=>{resolve(false);}}});app.get('/robots.txt',async()=> 'ok');
 try {
  expect((await app.inject({url:'/robots.txt',headers:{'user-agent':'Googlebot/2.1'}})).statusCode).toBe(200);
  expect(records).toHaveLength(0);resolve(true);await pending;await Promise.resolve();
  expect(records).toHaveLength(1);expect(records[0]).toMatchObject({verified:true,completed:true,bytes:2});
 }finally{await app.close();}
});
it('identifies operator verification probes separately and cannot promote their claimed Google identity',async()=>{
 const records:any[]=[],app=Fastify();registerCrawlerLog(app,{emit:r=>records.push(r)});app.get('/channels',async()=> 'ok');
 try{
  await app.inject({url:'/channels',headers:{'user-agent':'youtube-board-verify/1.0 Googlebot/2.1','cf-verified-bot':'true'}});
  expect(records).toHaveLength(1);expect(records[0]).toMatchObject({verified:false,userAgent:'youtube-board-verify/1.0 Googlebot/2.1'});
 }finally{await app.close();}
});

it('cancels pending DNS and persists its unverified result before closing the file sink',async()=>{
 const {mkdtemp,readFile,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
 const {createGoogleCrawlerVerifier}=await import('../src/seo/google-crawler-verifier.js');
 const directory=await mkdtemp(join(tmpdir(),'crawler-close-test-'));
 let finishReverse!:(names:string[])=>void,cancelled=0;
 const verifier=createGoogleCrawlerVerifier({resolver:()=>({reverse:()=>new Promise(r=>{finishReverse=r;}),resolve4:async()=>['66.249.66.1'],resolve6:async()=>[],cancel:()=>{cancelled++;}})});
 const app=Fastify();registerCrawlerLog(app,{directory,verifier});app.get('/robots.txt',async()=> 'ok');
 try{
  const response=await app.inject({url:'/robots.txt',remoteAddress:'66.249.66.1',headers:{'user-agent':'Googlebot/2.1'}});
  expect(response.statusCode).toBe(200);await app.close();expect(cancelled).toBeGreaterThan(0);
  const before=await readFile(join(directory,'crawler.jsonl'),'utf8'),rows=before.trim().split('\n').map(x=>JSON.parse(x));
  expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({verified:false,bytes:2,completed:true});
  finishReverse(['crawl.googlebot.com']);await new Promise(r=>setTimeout(r,5));
  expect(await readFile(join(directory,'crawler.jsonl'),'utf8')).toBe(before);
 }finally{await app.close();await rm(directory,{recursive:true,force:true});}
});
