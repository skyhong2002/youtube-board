import {it,expect,beforeAll,afterEach,vi} from 'vitest';
import {mkdtemp,rm,readFile,writeFile,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import type {ClientRequest,IncomingMessage} from 'node:http';
import sharp from 'sharp';
import * as webpEncoder from '../../shared/media-cache/webp-transform.js';
import {channelAvatarFromHtml,channelPageUrl,resolveChannelAvatar,CHANNEL_PAGE_LIMITS} from '../../shared/media-cache/channel-page.js';
import {MediaHttpStatusError,downloadAvatar,type MediaRequest} from '../../shared/media-cache/download.js';
import {currentResolution,parseResolutions,readResolutions,writeResolutions,resolutionResult,RESOLUTION_LIMITS} from '../../shared/media-cache/resolutions.js';
import {MediaCacheError,readManifest,readAvatarBytes,readAvatarWebpBytes} from '../../shared/media-cache/store.js';
import {AVATAR_WEBP_WIDTHS} from '../../shared/media-assets.js';
import {refreshChannelAvatars,MAX_CHANNEL_PAGE_RESOLUTIONS} from '../src/media-avatars.js';
import {validateMediaArguments,MEDIA_AVATAR_COMMAND} from '../src/media-cli.js';
import {validateWorkflowInput,workflowArgs} from '../src/workflow-registry.js';
const id='UC'+'A'.repeat(22),other='UC'+'B'.repeat(22),source='https://yt3.ggpht.com/old',resolved='https://yt3.googleusercontent.com/new=s192',now=new Date('2026-10-12T00:00:00Z'),roots:string[]=[];
let png:Buffer;
beforeAll(async()=>{png=await sharp({create:{width:192,height:192,channels:4,background:'#ff0000'}}).png().toBuffer();});
afterEach(async()=>{vi.useRealTimers();await Promise.all(roots.splice(0).map(p=>rm(p,{recursive:true,force:true})));});
async function root(){const path=await mkdtemp(join(tmpdir(),'avatar-resolver-'));roots.push(path);return path;}
const html=(channel=id,image=resolved)=>Buffer.from(`<html><head><link rel="canonical" href="https://www.youtube.com/channel/${channel}"><meta property="og:url" content="https://www.youtube.com/channel/${channel}"><meta property="og:image" content="${image}"></head><body>inert</body></html>`);
const lookup=async()=>[{address:'142.250.1.1',family:4}];
function transport(body:Buffer,config:{status?:number;mime?:string;encoding?:string;length?:string;chunks?:Buffer[]}={},inspect?:(o:Parameters<MediaRequest>[0])=>void):MediaRequest {
 return(options,callback)=>{inspect?.(options);const req=new EventEmitter() as ClientRequest;
  req.destroy=(()=>req) as ClientRequest['destroy'];
  req.end=(()=>{queueMicrotask(()=>{const res=new PassThrough() as unknown as PassThrough&IncomingMessage;res.statusCode=config.status??200;res.headers={'content-type':config.mime??'text/html; charset=utf-8',...(config.encoding?{'content-encoding':config.encoding}:{}),...(config.length===undefined?{}:{'content-length':config.length})};callback(res);if(!res.destroyed){for(const chunk of config.chunks??[body]){if(res.destroyed)break;res.write(chunk);}if(!res.destroyed)res.end();}});return req;}) as ClientRequest['end'];return req;
 };
}
it('constructs only fixed exact-channel URLs and binds both independent metadata identities',()=>{
 expect(channelPageUrl(id)).toBe('https://www.youtube.com/channel/'+id);
 for(const value of ['@handle','UC'+ 'A'.repeat(21),id+'?x=1',id.toLowerCase(),'https://evil.test'])expect(()=>channelPageUrl(value)).toThrow('INVALID_CHANNEL_ID');
 expect(channelAvatarFromHtml(id,html())).toBe(resolved);
 expect(channelAvatarFromHtml(id,html(id,resolved+'&x=1&amp;y=2'))).toBe(resolved+'&x=1&y=2');
 for(const bad of [html(other),html().toString().replace('rel="canonical"','rel="alternate"'),html().toString().replace('property="og:url"','property="unused"'),html().toString().replace('</head>',`<meta property="og:url" content="https://www.youtube.com/channel/${other}"></head>`),html().toString().replace('</head>','<meta property="og:image" content="https://yt3.ggpht.com/another"></head>')])expect(()=>channelAvatarFromHtml(id,Buffer.from(bad))).toThrow();
 for(const image of ['http://yt3.ggpht.com/x','https://youtube.com/icon','https://yt3.ggpht.com.evil/x','https://user@yt3.ggpht.com/x','https://yt3.ggpht.com/x#fragment'])expect(()=>channelAvatarFromHtml(id,html(id,image))).toThrow('CHANNEL_PAGE_IMAGE_REJECTED');
});
it('ignores fake metadata in scripts, comments, templates, body and foreign namespaces',()=>{
 const tags=html().toString().replace(/^<html><head>|<\/head>.*$/g,'');
 for(const inner of [`<script>${tags}</script>`,`<!-- ${tags} -->`,`<template>${tags}</template>`,`<svg>${tags}</svg>`])expect(()=>channelAvatarFromHtml(id,Buffer.from('<html><head>'+inner+'</head></html>'))).toThrow();
 expect(()=>channelAvatarFromHtml(id,Buffer.from('<html><head></head><body>'+tags+'</body></html>'))).toThrow();
 expect(()=>channelAvatarFromHtml(id,Buffer.concat([html(),Buffer.from([0xff])]))).toThrow('CHANNEL_PAGE_INVALID');
 expect(()=>channelAvatarFromHtml(id,Buffer.alloc(CHANNEL_PAGE_LIMITS.bytes+1))).toThrow('CHANNEL_PAGE_TOO_LARGE');
 expect(()=>channelAvatarFromHtml(id,Buffer.from('<html><head>'+ ' '.repeat(CHANNEL_PAGE_LIMITS.headBytes)+tags+'</head>'))).toThrow('CHANNEL_PAGE_METADATA_MISSING');
 expect(()=>channelAvatarFromHtml(id,Buffer.from('<html><head><!--'+ '😀'.repeat(70000)+'-->'+tags+'</head>'))).toThrow('CHANNEL_PAGE_METADATA_MISSING');
});
it('checks all DNS results then pins HTTPS address without cookies, auth or redirects',async()=>{
 let captured:Parameters<MediaRequest>[0]|undefined,calls=0;
 const request=transport(html(),{},options=>{captured=options;calls++;});
 await expect(resolveChannelAvatar(id,{lookup:async()=>[{address:'142.250.1.1',family:4},{address:'127.0.0.1',family:4}],request})).rejects.toThrow('CHANNEL_PAGE_ADDRESS_REJECTED');expect(calls).toBe(0);
 expect(await resolveChannelAvatar(id,{lookup,request})).toBe(resolved);
 expect(captured).toMatchObject({hostname:'www.youtube.com',servername:'www.youtube.com',path:'/channel/'+id,port:443,rejectUnauthorized:true,agent:false,autoSelectFamily:false});
 expect(captured?.headers).toEqual({Accept:'text/html','Accept-Encoding':'identity','User-Agent':'YouTubeBoard/avatar-cache'});
 let args:unknown[]=[];(captured!.lookup as Function)('rebound.test',{},(...v:unknown[])=>{args=v;});expect(args).toEqual([null,'142.250.1.1',4]);
 await expect(resolveChannelAvatar(id,{lookup,request:transport(html(),{status:302})})).rejects.toMatchObject({code:'CHANNEL_PAGE_REDIRECT_REJECTED',httpStatus:302});
});
it('bounds HTML transport type/size/byte budget and reports only numeric HTTP failures',async()=>{
 for(const [config,code]of [[{mime:'application/json'},'CHANNEL_PAGE_TYPE_REJECTED'],[{encoding:'gzip'},'CHANNEL_PAGE_TYPE_REJECTED'],[{mime:'text/html;charset=big5'},'CHANNEL_PAGE_TYPE_REJECTED'],[{length:String(CHANNEL_PAGE_LIMITS.bytes+1)},'CHANNEL_PAGE_TOO_LARGE'],[{chunks:[html(),Buffer.alloc(CHANNEL_PAGE_LIMITS.bytes)]},'CHANNEL_PAGE_TOO_LARGE'],[{length:'1'},'CHANNEL_PAGE_FAILED']] as const)await expect(resolveChannelAvatar(id,{lookup,request:transport(html(),config as never)})).rejects.toThrow(code);
 await expect(resolveChannelAvatar(id,{lookup,request:transport(html()),consume:()=>{throw Error('private details');}})).rejects.toThrow('RUN_BYTE_BUDGET');
 await expect(resolveChannelAvatar(id,{lookup,request:transport(Buffer.from('secret URL'),{status:429})})).rejects.toMatchObject({code:'CHANNEL_PAGE_STATUS',httpStatus:429,message:'CHANNEL_PAGE_STATUS'});
 await expect(downloadAvatar(source,{lookup,request:transport(Buffer.from('secret'),{status:404})})).rejects.toMatchObject({code:'DOWNLOAD_STATUS',httpStatus:404,message:'DOWNLOAD_STATUS'});
});
it('cancellation during DNS and while reading destroys network resources',async()=>{
 let requests=0;const controller=new AbortController();const waiting=resolveChannelAvatar(id,{signal:controller.signal,lookup:async()=>new Promise(()=>{}),request:transport(html(),{},()=>{requests++;})});controller.abort();await expect(waiting).rejects.toThrow('CHANNEL_PAGE_TIMEOUT');expect(requests).toBe(0);
 const abort=new AbortController();let destroyed=false,response:PassThrough|undefined;
 const request:MediaRequest=(_options,callback)=>{const req=new EventEmitter() as ClientRequest;req.destroy=(()=>{destroyed=true;return req;}) as ClientRequest['destroy'];req.end=(()=>{queueMicrotask(()=>{const res=new PassThrough() as unknown as PassThrough&IncomingMessage;response=res;res.statusCode=200;res.headers={'content-type':'text/html'};callback(res);abort.abort();});return req;}) as ClientRequest['end'];return req;};
 await expect(resolveChannelAvatar(id,{signal:abort.signal,lookup,request})).rejects.toThrow('CHANNEL_PAGE_TIMEOUT');expect(destroyed).toBe(true);expect(response?.destroyed).toBe(true);
});
it('persists resolution records only for exact source/channel bindings, validates and caps state',async()=>{
 const path=await root(),entry=resolutionResult(id,source,resolved,+now),state={version:1 as const,entries:{'1':entry}};
 await writeResolutions(path,state);expect(await readResolutions(path)).toEqual(state);
 expect(currentResolution(state,1,id,source,+now)).toEqual(entry);
 for(const [channel,url,time]of [[other,source,+now],[id,source+'x',+now],[id,source,+now-1]] as const)expect(currentResolution(state,1,channel,url,time)).toBeNull();
 for(const mutation of [{...entry,url:'https://evil.test'},{...entry,retryAfter:+now+999999},{...entry,sourceHash:[entry.sourceHash]},{...entry,extra:true}])expect(()=>parseResolutions(Buffer.from(JSON.stringify({version:1,entries:{'1':mutation}})))).toThrow('INVALID_RESOLUTIONS');
 const many={version:1 as const,entries:Object.fromEntries(Array.from({length:RESOLUTION_LIMITS.entries+1},(_,i)=>[String(i+1),resolutionResult(id,source,resolved,+now+i)]))};await writeResolutions(path,many);expect(Object.keys((await readResolutions(path)).entries)).toHaveLength(RESOLUTION_LIMITS.entries);expect((await readResolutions(path)).entries['1']).toBeUndefined();
 await rm(join(path,'avatar-resolutions.json'));const target=join(await root(),'state');await writeFile(target,'{}');await symlink(target,join(path,'avatar-resolutions.json'));await expect(readResolutions(path)).rejects.toThrow();expect(await readFile(target,'utf8')).toBe('{}');
});
const channel=(sourceUrl:string|null=source)=>({id:1,channelId:id,sourceUrl});
const options=(path:string)=>({root:path,channels:[channel()],execute:true,resolveMissing:true,assertOwnership:async()=>{}});
const transform=async()=>({png,sourceWidth:192,sourceHeight:192});
it('opt-in resolver repairs a404 cache without source writes and avoids retrying stale URL each sweep',async()=>{
 const path=await root(),downloads:string[]=[],resolver=vi.fn(async()=>resolved);
 const deps={download:async(url:string)=>{downloads.push(url);if(url===source)throw new MediaHttpStatusError('DOWNLOAD_STATUS',404);return png;},resolve:resolver,transform,now:()=>now};
 const first=await refreshChannelAvatars(options(path),deps);expect(first.results).toEqual([{id:1,status:'updated'}]);expect(downloads).toEqual([source,resolved]);expect(resolver).toHaveBeenCalledTimes(1);
 const revision=(await readManifest(path))!.entries['1']!.revision;expect(await readAvatarBytes(path,1,revision)).toEqual(png);
 expect((await refreshChannelAvatars(options(path),deps)).results).toEqual([{id:1,status:'fresh'}]);expect(downloads).toHaveLength(2);expect(resolver).toHaveBeenCalledTimes(1);
 const later=new Date(+now+RESOLUTION_LIMITS.ttlMs);await refreshChannelAvatars(options(path),{...deps,now:()=>later});expect(resolver).toHaveBeenCalledTimes(2);expect(downloads).toEqual([source,resolved,source,resolved]);
});
it('default/dryrun never resolve; malformed IDs never resolve; transient image failures do not fan out',async()=>{
 const path=await root(),resolve=vi.fn(async()=>resolved),deps={download:async()=>{throw new MediaHttpStatusError('DOWNLOAD_STATUS',503);},resolve,transform,now:()=>now};
 await refreshChannelAvatars({...options(path),execute:false,channels:[channel(null)]},deps);
 expect((await refreshChannelAvatars({...options(path),resolveMissing:false,channels:[channel(null)]},deps)).results[0]?.status).toBe('missing-source');
 expect((await refreshChannelAvatars(options(path),deps)).results[0]).toEqual({id:1,status:'failed',code:'DOWNLOAD_STATUS',httpStatus:503});
 await refreshChannelAvatars({...options(path),channels:[{...channel(),channelId:'bad'}]},deps);expect(resolve).not.toHaveBeenCalled();
 expect(validateMediaArguments([MEDIA_AVATAR_COMMAND]).resolveMissing).toBe(false);expect(validateMediaArguments([MEDIA_AVATAR_COMMAND,'--resolve-missing']).resolveMissing).toBe(true);expect(()=>validateMediaArguments([MEDIA_AVATAR_COMMAND,'--resolve-missing','--resolve-missing'])).toThrow();
 expect(workflowArgs('channels.avatars.refresh',validateWorkflowInput('channels.avatars.refresh',{options:{'resolve-missing':true}}))).toContain('--resolve-missing');
});
it('missing source fallback has durable6h backoff and never removes last-good bytes',async()=>{
 const path=await root(),success={download:async()=>png,resolve:async()=>resolved,transform,now:()=>now};
 await refreshChannelAvatars(options(path),success);const before=await readFile(join(path,'manifest.json'));
 const opts={...options(path),channels:[channel(null)]},resolve=vi.fn(async()=>{throw new MediaHttpStatusError('CHANNEL_PAGE_STATUS',404);}),deps={...success,resolve};
 expect((await refreshChannelAvatars(opts,deps)).results[0]).toEqual({id:1,status:'failed',code:'CHANNEL_PAGE_STATUS',httpStatus:404});expect(await readFile(join(path,'manifest.json'))).toEqual(before);
 expect((await refreshChannelAvatars(opts,deps)).results[0]?.code).toBe('RESOLUTION_BACKOFF');expect(resolve).toHaveBeenCalledTimes(1);
 await refreshChannelAvatars(opts,{...deps,now:()=>new Date(+now+RESOLUTION_LIMITS.backoffMs)});expect(resolve).toHaveBeenCalledTimes(2);
 await refreshChannelAvatars({...opts,channels:[{...channel(null),channelId:other}]},deps);expect(resolve).toHaveBeenCalledTimes(3);
});
it('ownership loss at resolver boundary and run-byte interruption cannot publish resolver state',async()=>{
 const path=await root();let ownershipCalls=0,resolveCalls=0;
 await expect(refreshChannelAvatars({...options(path),channels:[channel(null)],assertOwnership:async()=>{if(++ownershipCalls===3)throw Error('ownership lost');}},{resolve:async()=>{resolveCalls++;return resolved;},download:async()=>png,transform,now:()=>now})).rejects.toThrow('ownership lost');expect(resolveCalls).toBe(0);expect(await readManifest(path)).toBeNull();
 const result=await refreshChannelAvatars({...options(path),channels:[channel(null)]},{resolve:async(_id,opts)=>{opts.consume?.(33*1024*1024);return resolved;},download:async()=>png,transform,now:()=>now});expect(result).toMatchObject({truncated:true,lastProcessedId:null,results:[]});await expect(readFile(join(path,'avatar-resolutions.json'))).rejects.toThrow();
});
it('bounds channel-page requests and persists only the completed contiguous prefix',async()=>{
 const path=await root(),resolve=vi.fn(async()=>resolved),channels=Array.from({length:MAX_CHANNEL_PAGE_RESOLUTIONS+2},(_,i)=>({...channel(null),id:i+1}));
 const result=await refreshChannelAvatars({...options(path),channels},{resolve,download:async()=>png,transform,now:()=>now});
 expect(resolve).toHaveBeenCalledTimes(MAX_CHANNEL_PAGE_RESOLUTIONS);expect(result).toMatchObject({truncated:true,lastProcessedId:MAX_CHANNEL_PAGE_RESOLUTIONS});expect(Object.keys((await readResolutions(path)).entries)).toHaveLength(MAX_CHANNEL_PAGE_RESOLUTIONS);
},60000);
it('resolved avatar publication also yields the bounded WebP derivatives',async()=>{
 const path=await root(),deps={download:async(url:string)=>{if(url===source)throw new MediaHttpStatusError('DOWNLOAD_STATUS',410);return png;},resolve:async()=>resolved,transform,now:()=>now};
 expect((await refreshChannelAvatars(options(path),deps)).results).toEqual([{id:1,status:'updated'}]);
 const entry=(await readManifest(path))!.entries['1']!;expect(entry.sourceHash).toBe(createHash('sha256').update(resolved).digest('hex'));
 for(const width of AVATAR_WEBP_WIDTHS){const bytes=await readAvatarWebpBytes(path,1,entry.revision,width);expect(await sharp(bytes).metadata()).toMatchObject({width,height:width,format:'webp'});}
 expect((await readResolutions(path)).entries['1']).toEqual(resolutionResult(id,source,resolved,+now));
});
it('abort during resolved publication truncates without manifest, cursor or resolution state',async()=>{
 const path=await root(),abort=new AbortController(),encode=webpEncoder.avatarWebpDerivatives,resolve=vi.fn(async()=>resolved);
 const spy=vi.spyOn(webpEncoder,'avatarWebpDerivatives').mockImplementation(async(bytes,signal)=>{const result=await encode(bytes,signal);abort.abort();return result;});
 try{
  const result=await refreshChannelAvatars({...options(path),channels:[channel(null),{...channel(null),id:2}],signal:abort.signal},{resolve,download:async()=>png,transform,now:()=>now});
  expect(spy).toHaveBeenCalledOnce();expect(resolve).toHaveBeenCalledTimes(2);
  expect(result).toMatchObject({truncated:true,lastProcessedId:null,results:[]});
  expect(await readManifest(path)).toBeNull();await expect(readFile(join(path,'avatar-resolutions.json'))).rejects.toMatchObject({code:'ENOENT'});
 }finally{spy.mockRestore();}
});
