import type {FastifyInstance} from 'fastify';
import {createCrawlerLogSink} from './crawler-log-sink.js';

interface CrawlerRecord {
  code:'CRAWLER_RESPONSE';at:string;method:string;path:string;
  status:number;bytes:number;completed:boolean;userAgent:string;cfRay:string|null;cfCountry:string|null;cfColo:string|null;
}
interface Options {emit?:(record:CrawlerRecord|{code:'CRAWLER_LOG_SUPPRESSED';count:number})=>void;clock?:()=>Date;limit?:number;directory?:string}
const sitemap=/^\/(?:robots\.txt|sitemap\.xml|sitemaps\/(?:static|channels|videos|tags)\/[1-9]\d{0,4}\.xml|sitemaps\/(?:keywords|events)\/[a-f0-9]{2}\.xml)$/;
const bots=/Googlebot|Google-InspectionTool/i;

/** Request paths can contain search terms or private feed tokens. Log canonical
 * route shapes instead of these values, even if a caller spoofs a crawler UA. */
export function crawlerPath(raw:string):string {
  const path=raw.split('?')[0]!;
  if(sitemap.test(path)||path==='/')return path;
  if(/^\/(?:auth|my|manage|ops|feeds\/u|api\/ops)(?:\/|$)/.test(path))return '/[private]';
  if(/^\/(?:search)(?:\/|$)/.test(path))return '/search';
  if(/^\/keywords\//.test(path))return '/keywords/:keyword';
  if(/^\/channels\/[1-9]\d*(?:\/|$)/.test(path))return '/channels/:id';
  if(/^\/videos\/[A-Za-z0-9_-]{1,32}(?:\/|$)/.test(path))return '/videos/:id';
  if(/^\/tags\/[1-9]\d*(?:\/|$)/.test(path))return '/tags/:id';
  if(/^\/events\/[a-f0-9-]{36}(?:\/|$)/.test(path))return '/events/:id';
  const safe=new Set(['/channels','/videos','/keywords','/tags','/events','/groups','/about','/api','/live/current','/live/channels','/live/hours','/live/tags','/ai/days','/ai/hours','/ai/periods']);
  return safe.has(path)?path:'/[other]';
}
export function crawlerUserAgent(value:unknown):string {
  if(typeof value!=='string')return '';
  // Retain useful product/version evidence, never arbitrary client text, URLs,
  // device identifiers or caller-injected credentials in a spoofed User-Agent.
  const products=value.slice(0,512).match(/\b(?:Googlebot|Google-InspectionTool|Chrome|Chromium|Safari|Firefox|Version|Mozilla)(?:\/[0-9]{1,4}(?:\.[0-9]{1,6}){0,3})?\b|\b(?:Mobile|Smartphone)\b/g)??[];
  return [...new Set(products)].slice(0,12).join(' ')||'Other';
}
/** Narrow operational evidence, not general access logging. Never receives or
 * retains cookies, IPs, full URLs, query strings, auth headers or response bodies. */
export function registerCrawlerLog(app:FastifyInstance,options:Options={}) {
  const clock=options.clock??(()=>new Date()),limit=options.limit??300;
  if(!Number.isSafeInteger(limit)||limit<1||limit>1000)throw Error('Invalid crawler log budget');
  const directory=options.directory??process.env.CRAWLER_LOG_DIRECTORY;
  const sink=directory?createCrawlerLogSink({directory}):undefined;
  if(sink)app.addHook('onClose',async()=>{await sink.close();});
  const emit=options.emit??(record=>{
    sink?.emit(record);
    if(!process.stderr.writableNeedDrain)process.stderr.write(JSON.stringify(record)+'\n');
  });
  let window=-1,used=0,suppressed=0;
  app.addHook('onRequest',async(request,reply)=>{
    const rawAgent=request.headers['user-agent'];
    if(!sitemap.test(request.url.split('?')[0]!)&&!bots.test(typeof rawAgent==='string'?rawAgent.slice(0,512):''))return;
    const ray=request.headers['cf-ray'],country=request.headers['cf-ipcountry'];
    const cfRay=typeof ray==='string'&&/^[a-f0-9]{16,32}(?:-[A-Z]{3})?$/.test(ray)?ray:null;
    const record={path:crawlerPath(request.url),userAgent:crawlerUserAgent(rawAgent),cfRay,
      cfCountry:typeof country==='string'&&/^[A-Z]{2}$/.test(country)?country:null,
      cfColo:cfRay?.match(/-([A-Z]{3})$/)?.[1]??null};
    // Count only final encoded body chunks, after all Fastify hooks/proxy and
    // compression. Never inspect/copy bodies or count HTTP framing and headers.
    // Preserve ServerResponse overloads, return values and backpressure.
    const raw=reply.raw,write=raw.write,end=raw.end;
    let bytes=0,ending=false,emitted=false;
    const length=(chunk:unknown,encoding:unknown)=>typeof chunk==='string'?Buffer.byteLength(chunk,typeof encoding==='string'?encoding as BufferEncoding:undefined):ArrayBuffer.isView(chunk)?chunk.byteLength:0;
    raw.write=function(this:typeof raw,...args:Parameters<typeof write>) {
      const size=ending?0:length(args[0],args[1]);bytes+=size;
      try{return Reflect.apply(write,this,args);}catch(error){bytes-=size;throw error;}
    } as typeof write;
    raw.end=function(this:typeof raw,...args:Parameters<typeof end>) {
      const size=length(args[0],args[1]);bytes+=size;ending=true;
      try{return Reflect.apply(end,this,args);}catch(error){bytes-=size;throw error;}finally{ending=false;}
    } as typeof end;
    const finish=(completed:boolean)=>{
      if(emitted)return;emitted=true;
      const at=clock(),bucket=Math.floor(+at/60000);if(!Number.isFinite(bucket))return;
      try {
        if(bucket!==window){if(suppressed)emit({code:'CRAWLER_LOG_SUPPRESSED',count:suppressed});window=bucket;used=0;suppressed=0;}
        if(used>=limit){suppressed=Math.min(2147483647,suppressed+1);return;}used++;
        const noBody=request.method==='HEAD'||raw.statusCode===204||raw.statusCode===304||raw.statusCode<200;
        emit({code:'CRAWLER_RESPONSE',at:at.toISOString(),method:/^[A-Z]{1,16}$/.test(request.method)?request.method:'OTHER',...record,
          status:raw.statusCode,bytes:noBody?0:bytes,completed});
      }catch{/* Observability must never change a public response. */}
    };
    raw.once('finish',()=>finish(true));
    // A disconnected response is explicitly incomplete: bytes then describes
    // submitted body chunks, not proof they all reached the remote client.
    raw.once('close',()=>finish(raw.writableFinished));
  });
}
