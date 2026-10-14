// Explicitly authorized anonymous production capture. Reuse reviewed lifecycle/coherence tools.
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import {readFile,writeFile,mkdir,statfs,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from '/home/deck/.cache/tag-visuals/node_modules/playwright/index.mjs';
import sharp from '/home/deck/Projects/youtube-board-f2/platform/node_modules/sharp/dist/index.mjs';
import {createNetworkRecorder,installNetworkGuard,waitForNetworkSettlement} from '/home/deck/.cache/youtube-ui-review/ui_ledger-2026-10-13/capture-network-v10.mjs';
import {captureCoherentBuffer,snapshotDOMState,imageParts} from '/home/deck/.cache/youtube-ui-review/ui_ledger-2026-10-13/capture-coherence.mjs';
const [planPath,outDir,identityPath]=process.argv.slice(2);assert(planPath&&outDir&&identityPath);
const plan=JSON.parse(await readFile(planPath,'utf8'));const identity=JSON.parse(await readFile(identityPath,'utf8'));
assert(plan.length>0&&plan.length<=6);assert.equal(identity.verified,true);assert(/^[a-f0-9]{40}$/.test(identity.appSha));assert(/^[a-f0-9]{64}$/.test(identity.imageSHA256));assert(typeof identity.buildID==='string'&&/^[A-Za-z0-9_-]{1,160}$/.test(identity.buildID),'Nonempty BUILD_ID required');
assert(plan.every(i=>/^[a-z0-9-]+$/.test(i.key)&&new URL(i.url).origin==='https://youtube.observe.tw'&&!new URL(i.url).search&&!new URL(i.url).hash&&!new URL(i.url).username&&!new URL(i.url).password&&['light','dark'].includes(i.theme)&&[null,'today','week'].includes(i.window)));
const hash=b=>createHash('sha256').update(b).digest('hex');
const write=async(p,b)=>{await writeFile(p,b,{mode:0o600,flag:'wx'});return {path:p,sha256:hash(b)};};
async function resources(start=false){const s=await statfs('/home');assert(Number(s.bavail)*Number(s.bsize)>=(start?40:30)*2**30,'Disk threshold');assert(os.loadavg()[0]<=12,'Load threshold');const mem=await readFile('/proc/meminfo','utf8');assert(Number(mem.match(/^MemAvailable:\s+(\d+)/m)[1])*1024>=2.5*2**30,'Memory threshold');}
const serviceBytes=await readFile(identity.serviceProof);assert.equal(hash(serviceBytes),identity.serviceProofSha256);const serviceProof=JSON.parse(serviceBytes);assert(Array.isArray(serviceProof.services)&&serviceProof.services.length===2);assert.deepEqual(serviceProof.services.map(s=>s.name).sort(),['youtube-board-ts-6oukfq_account-maintenance','youtube-board-ts-6oukfq_web']);assert(serviceProof.services.every(s=>s.containers.length===1&&s.containers[0].health==='healthy'&&s.containers[0].revision===identity.appSha&&s.containers[0].image==='sha256:'+identity.imageSHA256&&s.containers[0].buildId===identity.buildID),'Actual production service proof required');
await resources(true);await mkdir(outDir,{mode:0o700});await chmod(outDir,0o700);sharp.concurrency(1);
// Only these HTTPS CONNECT targets can leave this Chromium process; HTTP is denied.
const destinations=new Set(['youtube.observe.tw:443','i.ytimg.com:443']);const sockets=new Set();const proxyRows=[];
const track=s=>{sockets.add(s);s.once('close',()=>sockets.delete(s));return s;};
const server=http.createServer((_req,res)=>{res.writeHead(403);res.end();});server.on('connection',track);
server.on('connect',(req,client,head)=>{
 const allowed=destinations.has(req.url);proxyRows.push({at:new Date().toISOString(),destination:allowed?req.url:'blocked-unlisted-host',allowed});
 if(!allowed){client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;}
 const host=req.url.slice(0,-4);const upstream=track(net.connect({host,port:443},()=>{client.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)upstream.write(head);upstream.pipe(client);client.pipe(upstream);}));
 upstream.setTimeout(30000,()=>upstream.destroy());upstream.on('error',()=>client.destroy());client.on('error',()=>upstream.destroy());client.on('close',()=>upstream.destroy());
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
let browser;const report=[];
try{
 browser=await chromium.launch({headless:true,proxy:{server:`http://127.0.0.1:${server.address().port}`,bypass:'<-loopback>'},args:['--disable-background-networking','--disable-quic']});
 for(const item of plan){const record={key:item.key,url:item.url,routePath:new URL(item.url).pathname,theme:item.theme,window:item.window,environment:'production',identity:{verified:true,appSha:identity.appSha,imageSHA256:identity.imageSHA256,buildID:identity.buildID,serviceProof:identity.serviceProof,serviceProofSha256:identity.serviceProofSha256},reviewed:false,captureAt:new Date().toISOString(),viewports:{}};
  for(const [viewport,width,height]of [['desktop',1280,800],['mobile',390,844]]){
   await resources();const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,colorScheme:item.theme,locale:'zh-TW',timezoneId:'Asia/Taipei',extraHTTPHeaders:{DNT:'1','Sec-GPC':'1'},serviceWorkers:'block'});
   const network=createNetworkRecorder({candidateOrigin:item.url});let before=null,after=null,closed=false;const raw=[];const known=new WeakMap();let rawUnknown=false;
   const rawRow=req=>{try{let row=known.get(req);if(!row){if(raw.length>=1500){rawUnknown=true;return null;}const u=new URL(req.url());const own=u.origin==='https://youtube.observe.tw'||u.hostname==='i.ytimg.com';u.username='';u.password='';u.hash='';if(own)for(const k of [...u.searchParams.keys()])if(!['_rsc','from','to','days','page','limit'].includes(k))u.searchParams.delete(k);row={id:raw.length+1,at:new Date().toISOString(),url:own?u.href:'blocked-external-url',method:req.method(),resource:req.resourceType(),dnt:req.headers().dnt??null,gpc:req.headers()['sec-gpc']??null,status:null,terminal:null};known.set(req,row);raw.push(row);}return row;}catch{rawUnknown=true;network.markUnknown('raw-fields-unavailable');return null;}};
   context.on('request',r=>rawRow(r));context.on('response',r=>{const row=rawRow(r.request());if(row)row.status=r.status();});context.on('requestfinished',r=>{const row=rawRow(r);if(row)row.terminal='finished';});context.on('requestfailed',r=>{const row=rawRow(r);if(row){row.terminal='failed';row.failure=r.failure()?.errorText??'unknown';}});
   const networkPath=join(outDir,item.key+'-'+viewport+'-requests.json');let view;let captureFailure=null;
   try{
    await installNetworkGuard(context,network);const page=await context.newPage();const response=await page.goto(item.url,{waitUntil:'domcontentloaded',timeout:30000});assert.equal(response.status(),200);const rendered=(await response.text()).replaceAll('\\"','"');const builds=[...rendered.matchAll(/"(?:b|buildId)"\s*:\s*"([A-Za-z0-9_-]{1,160})"/g)].map(m=>m[1]);assert(builds.includes(identity.buildID),'Production Next BUILD_ID changed');
    await page.locator('body').waitFor();await page.waitForTimeout(1800);await page.evaluate(()=>document.fonts.ready);
    if(item.window){const radios=page.locator('input[type=radio][value="'+item.window+'"]');assert(await radios.count()>0);for(let i=0;i<await radios.count();i++)await radios.nth(i).check({force:true});await page.waitForTimeout(250);}
    const h=await page.evaluate(()=>document.documentElement.scrollHeight);assert(h<=24000,'Page too long; split capture');for(let y=0;y<h;y+=700){await page.evaluate(y=>scrollTo(0,y),y);await page.waitForTimeout(120);}await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(250);
    before=await page.evaluate(()=>({dnt:navigator.doNotTrack,gpc:navigator.globalPrivacyControl}));await waitForNetworkSettlement(network);
    const coherent=await captureCoherentBuffer({read:()=>page.evaluate(snapshotDOMState),expected:{window:item.window,theme:item.theme},capture:()=>page.screenshot({fullPage:true,animations:'disabled'})});
    const parts=await imageParts(coherent.buffer,sharp);const full=await write(join(outDir,item.key+'-'+viewport+'.png'),parts.full);const slices=[];
    for(const s of parts.slices){await resources();slices.push({...await write(join(outDir,item.key+'-'+viewport+'-slice-'+s.top+'.png'),s.buffer),top:s.top,height:s.height});}
    after=await page.evaluate(()=>({dnt:navigator.doNotTrack,gpc:navigator.globalPrivacyControl}));const dom=await page.evaluate(()=>({title:document.title,theme:document.documentElement.dataset.theme,overflow:Math.max(0,document.documentElement.scrollWidth-innerWidth),text:(document.querySelector('main')??document.body).innerText}));
    view={status:response.status(),screenshot:full,slices,dom,captureCoherence:{before:coherent.before,after:coherent.after,sha256:coherent.sha256},buildID:identity.buildID};
   }catch(error){captureFailure=error;await write(join(outDir,item.key+'-'+viewport+'-capture-failure.json'),JSON.stringify({failed:true,errorClass:error instanceof assert.AssertionError?'AssertionError':'CaptureError',reason:String(error.message).split('\n')[0].slice(0,160)},null,2)+'\n');throw error;}finally{
    try{await waitForNetworkSettlement(network);}catch{network.markUnknown('settlement-failed');}
    try{await context.close();closed=true;}finally{const evidence=network.snapshot({privacyBefore:before,privacyAfter:after,contextClosed:closed,finalize:true});await write(networkPath,JSON.stringify(evidence,null,2)+'\n');await write(join(outDir,item.key+'-'+viewport+'-raw-network.json'),JSON.stringify({bodyStored:false,cookiesStored:false,headersStored:false,unknown:rawUnknown,requests:raw},null,2)+'\n');if(!captureFailure)assert(evidence.accepted&&!rawUnknown,'Incomplete or failed network evidence');if(view)view.network={path:networkPath,sha256:hash(await readFile(networkPath)),google:evidence.google,privacy:evidence.privacy,accepted:evidence.accepted};}
   }
   record.viewports[viewport]=view;await write(join(outDir,item.key+'-'+viewport+'-completed.json'),JSON.stringify(record,null,2)+'\n');console.log(JSON.stringify({key:item.key,viewport,status:view.status,google:view.network.google}));
  }
  report.push(record);
 }
 await write(join(outDir,'captures.json'),JSON.stringify(report,null,2)+'\n');
}finally{
 try{if(browser)await browser.close();}finally{for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));await write(join(outDir,'prelaunch-proxy.json'),JSON.stringify({installedBeforeLaunch:true,allowedDestinations:[...destinations],googleDestinationsAllowed:false,connections:proxyRows},null,2)+'\n');}
}
