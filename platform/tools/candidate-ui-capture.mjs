import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,statfs} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from '/home/deck/.cache/tag-visuals/node_modules/playwright/index.mjs';
import sharp from '/home/deck/Projects/youtube-board-f2/platform/node_modules/sharp/dist/index.mjs';
import {startCaptureProxy} from '/home/deck/.cache/youtube-ui-review/ui_ledger-2026-10-13/profile72-capture-tools/capture-prelaunch-proxy-v12.mjs';
import {createNetworkRecorder,installNetworkGuard,waitForNetworkSettlement} from '/home/deck/.cache/youtube-ui-review/ui_ledger-2026-10-13/profile72-capture-tools/capture-network-v10.mjs';
import {snapshotDOMState,captureCoherentBuffer,imageParts} from '/home/deck/.cache/youtube-ui-review/ui_ledger-2026-10-13/profile72-capture-tools/capture-coherence.mjs';
const [identityPath,out,planPath]=process.argv.slice(2);assert(identityPath&&out&&planPath);
const plan=JSON.parse(await readFile(planPath,'utf8'));assert(Array.isArray(plan)&&plan.length>0&&plan.length<=6);assert.equal(new Set(plan.map(i=>i.key)).size,plan.length);assert(plan.every(i=>typeof i.key==='string'&&/^[a-z0-9-]+$/.test(i.key)&&['/','/keywords','/groups','/live/current','/channels','/videos','/tags/102/videos','/videos/kqdc4-YOmPM'].includes(i.routePath)&&[null,'today','week'].includes(i.window)&&['light','dark'].includes(i.theme)));
const identity=JSON.parse(await readFile(identityPath,'utf8'));
assert.match(identity.appSha,/^[a-f0-9]{40}$/);assert.match(identity.image,/^sha256:[a-f0-9]{64}$/);assert.match(identity.buildId,/^[A-Za-z0-9_-]+$/);
assert(identity.verified&&identity.containerId);
async function resources(start=false){const d=await statfs('/home');assert(Number(d.bavail)*Number(d.bsize)>=(start?40:30)*2**30);const mem=await readFile('/proc/meminfo','utf8');assert(Number(mem.match(/^MemAvailable:\s+(\d+)/m)[1])*1024>=2.5*2**30);}
await resources(true);await mkdir(out,{mode:0o700});sharp.concurrency(1);
const save=async(path,value)=>writeFile(path,value,{mode:0o600,flag:'wx'}),hash=b=>createHash('sha256').update(b).digest('hex');
const proxy=await startCaptureProxy({candidateOrigin:'http://127.0.0.1:18168'});let browser;
const captures=[];
try{
 browser=await chromium.launch({headless:true,proxy:{server:proxy.url,bypass:'<-loopback>'},args:['--disable-background-networking','--disable-quic']});
 for(const {routePath,window,theme,key}of plan){
  const record={key,routePath,submittedSHA:identity.appSha,frontendBuildSourceSHA:identity.appSha,candidateSHA:identity.appSha,imageSHA256:identity.image.slice(7),buildID:identity.buildId,containerId:identity.containerId,reviewed:false,viewports:{}};
  for(const [viewport,width,height]of [['desktop',1280,800],['mobile',390,844]]){
   await resources();const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,colorScheme:theme,locale:'zh-TW',timezoneId:'Asia/Taipei',extraHTTPHeaders:{DNT:'1','Sec-GPC':'1'},userAgent:'YoutubeBoard-UIReview/1.0 (DNT1)',serviceWorkers:'block'});
   const raw=[];const ids=new WeakMap();let rawUnknown=false;
   const row=req=>{try{let r=ids.get(req);if(!r){if(raw.length>=1500){rawUnknown=true;return null;}const u=new URL(req.url());u.username='';u.password='';u.hash='';for(const k of [...u.searchParams.keys()])if(!['_rsc','from','to','days','page','limit'].includes(k))u.searchParams.delete(k);r={id:raw.length+1,at:new Date().toISOString(),url:u.origin==='http://127.0.0.1:18168'||u.hostname==='i.ytimg.com'?u.href:'blocked-external-url',method:req.method(),resource:req.resourceType(),dnt:req.headers().dnt??null,gpc:req.headers()['sec-gpc']??null,status:null,terminal:null};ids.set(req,r);raw.push(r);}return r;}catch{rawUnknown=true;network.markUnknown('raw-fields-unavailable');return null;}};
   context.on('request',r=>row(r));context.on('response',r=>{const x=row(r.request());if(x)x.status=r.status();});context.on('requestfinished',r=>{const x=row(r);if(x)x.terminal='finished';});context.on('requestfailed',r=>{const x=row(r);if(x){x.terminal='failed';x.failure=r.failure()?.errorText??'unknown';}});
   const network=createNetworkRecorder({candidateOrigin:'http://127.0.0.1:18168',gpcEnabled:true});let before=null,after=null,closed=false,data;
   try{
    await installNetworkGuard(context,network,{gpcEnabled:true});const page=await context.newPage();
    const response=await page.goto('http://127.0.0.1:18168'+routePath,{waitUntil:'domcontentloaded',timeout:30000});assert.equal(response.status(),200);const html=(await response.text()).replaceAll('\\"','"');assert([...html.matchAll(/"(?:b|buildId)"\s*:\s*"([A-Za-z0-9_-]+)"/g)].some(m=>m[1]===identity.buildId),'Candidate HTML build mismatch');
    await page.locator('body').waitFor({state:'visible'});await page.waitForTimeout(1800);await page.evaluate(()=>document.fonts.ready);
    if(window){const radios=page.locator('input[type=radio][value="'+window+'"]');assert(await radios.count()>0);for(let i=0;i<await radios.count();i++)await radios.nth(i).check({force:true});}
    await page.waitForTimeout(300);assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),theme);
    const documentHeight=await page.evaluate(()=>document.documentElement.scrollHeight);
    for(let y=0;y<Math.min(documentHeight,20000);y+=700){await page.evaluate(y=>scrollTo(0,y),y);await page.waitForTimeout(150);}
    await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(500);
    before=await page.evaluate(()=>({dnt:navigator.doNotTrack,gpc:navigator.globalPrivacyControl??null}));
    const dom=await page.evaluate(()=>({title:document.title,theme:document.documentElement.dataset.theme,viewport:{width:innerWidth,height:innerHeight},overflow:Math.max(0,document.documentElement.scrollWidth-innerWidth),text:(document.querySelector('main')??document.body).innerText,radioState:[...document.querySelectorAll('input[type=radio]')].map(e=>({name:e.name,value:e.value,checked:e.checked}))}));
    assert.equal(before.dnt,'1');assert.equal(before.gpc,true);network.assertHealthy();
    const coherent=await captureCoherentBuffer({read:()=>page.evaluate(snapshotDOMState),expected:{window,theme},capture:()=>page.screenshot({fullPage:true,animations:'disabled'})});
    const parts=await imageParts(coherent.buffer,sharp),screenshotPath=join(out,key+'-'+viewport+'.png'),sliceProofs=[];
    await save(screenshotPath,parts.full);
    for(const slice of parts.slices){const path=join(out,key+'-'+viewport+'-slice-'+slice.top+'.png');await save(path,slice.buffer);sliceProofs.push({path,top:slice.top,height:slice.height,sha256:hash(slice.buffer)});}
    const interactions=[];if(viewport==='desktop'&&['/live/current','/channels','/videos','/tags/102/videos'].includes(routePath)){const el=page.locator('.table-scroller').first();await el.scrollIntoViewIfNeeded();const beforeScroll=await el.evaluate(e=>({left:e.scrollLeft,width:e.clientWidth,scrollWidth:e.scrollWidth}));await el.evaluate(e=>e.scrollLeft=e.scrollWidth);await page.waitForTimeout(200);const readScroll=()=>el.evaluate(e=>({left:e.scrollLeft,width:e.clientWidth,scrollWidth:e.scrollWidth}));const proof=await readScroll();assert(proof.left>0&&proof.left+proof.width>=proof.scrollWidth-1);const path=join(out,key+'-'+viewport+'-right-edge.png');const rightCoherent=await captureCoherentBuffer({read:()=>page.evaluate(snapshotDOMState),expected:{window,theme},capture:()=>page.screenshot({fullPage:false,animations:'disabled'})});const afterProof=await readScroll();assert.deepEqual(afterProof,proof,'Horizontal position changed during screenshot');assert(afterProof.left>0&&afterProof.left+afterProof.width>=afterProof.scrollWidth-1);await save(path,rightCoherent.buffer);interactions.push({path,sha256:hash(rightCoherent.buffer),before:beforeScroll,screenshotBefore:proof,screenshotAfter:afterProof,captureCoherence:{before:rightCoherent.before,after:rightCoherent.after,sha256:rightCoherent.sha256},action:'horizontal-scroll-right'});}
    if(viewport==='mobile'&&routePath==='/channels'){
     const details=page.locator('ol[aria-label="頻道排行列表"] details').first();await details.locator('summary').click();await details.scrollIntoViewIfNeeded();assert(await details.evaluate(e=>e.open));
     const expanded=await captureCoherentBuffer({read:()=>page.evaluate(snapshotDOMState),expected:{window,theme},capture:()=>page.screenshot({fullPage:false,animations:'disabled'})});assert(await details.evaluate(e=>e.open));
     const path=join(out,key+'-'+viewport+'-expanded-metrics.png');await save(path,expanded.buffer);interactions.push({path,sha256:hash(expanded.buffer),action:'expand-first-channel-metrics',open:true,captureCoherence:{before:expanded.before,after:expanded.after,sha256:expanded.sha256}});
    }
    after=await page.evaluate(()=>({dnt:navigator.doNotTrack,gpc:navigator.globalPrivacyControl??null}));
    dom.text=coherent.before.canonical.content;dom.radioState=coherent.before.canonical.radios;
    data={status:200,theme,interactionScreenshots:interactions,selectedWindow:window,dom,screenshotPath,screenshotSHA256:hash(parts.full),screenshotSlices:sliceProofs.map(s=>s.path),captureCoherence:{verified:true,bufferSHA256:coherent.sha256,beforeFingerprint:coherent.before.fingerprint,afterFingerprint:coherent.after.fingerprint,validatedState:coherent.before.canonical,sliceProofs},lazyImageCoverage:{maxHeight:20000,documentHeight,complete:documentHeight<=20000}};
   }finally{
    let finalError=null;
    try{await waitForNetworkSettlement(network,{timeoutMs:15000,quietMs:250});}catch(error){finalError=error;}
    try{await context.close();closed=true;}catch(error){finalError??=error;}
    const receipt=network.snapshot({privacyBefore:before,privacyAfter:after,contextClosed:closed,finalize:true}),path=join(out,key+'-'+viewport+'-requests.json');await save(path,JSON.stringify(receipt,null,2)+'\n');
    await save(join(out,key+'-'+viewport+'-raw-network.json'),JSON.stringify({bodyStored:false,cookiesStored:false,headersStored:false,unknown:rawUnknown,requests:raw},null,2)+'\n');
    if(finalError)throw finalError;assert.equal(rawUnknown,false);
    assert.equal(receipt.accepted,true,'Network/privacy receipt rejected');assert.equal(receipt.google.attempts,0);assert.equal(receipt.google.responses,0);
    if(data){data.networkEvidence={path,complete:receipt.complete};data.analytics={...receipt.google,privacy:receipt.privacy,assertedZeroOutbound:true};}
   }
   record.viewports[viewport]=data;console.log(JSON.stringify({key,viewport,status:data.status,overflow:data.dom.overflow,googleRequests:0}));
  }
  captures.push(record);await save(join(out,key+'-completed.json'),JSON.stringify(record,null,2)+'\n');
 }
 await browser.close();browser=null;await save(join(out,'proxy.json'),JSON.stringify(proxy.evidence(),null,2)+'\n');
 await save(join(out,'captures.json'),JSON.stringify(captures,null,2)+'\n');
}finally{if(browser)await browser.close();await proxy.close();}
