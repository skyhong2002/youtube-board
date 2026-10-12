import type {FastifyInstance,FastifyRequest} from 'fastify';

interface CrawlerRecord {
  code:'CRAWLER_RESPONSE';at:string;method:string;path:string;
  status:number;bytes:number|null;userAgent:string;cfRay:string|null;
}
interface Options {emit?:(record:CrawlerRecord|{code:'CRAWLER_LOG_SUPPRESSED';count:number})=>void;clock?:()=>Date;limit?:number}
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
  const emit=options.emit??(record=>{if(!process.stderr.writableNeedDrain)process.stderr.write(JSON.stringify(record)+'\n');});
  let window=-1,used=0,suppressed=0;
  const selected=new WeakMap<FastifyRequest,{path:string;userAgent:string;cfRay:string|null;bytes:number|null}>();
  app.addHook('onRequest',async request=>{
    const rawAgent=request.headers['user-agent'];
    const userAgent=crawlerUserAgent(rawAgent);
    if(!sitemap.test(request.url.split('?')[0]!)&&!bots.test(typeof rawAgent==='string'?rawAgent.slice(0,512):''))return;
    const ray=request.headers['cf-ray'];
    selected.set(request,{path:crawlerPath(request.url),userAgent,cfRay:typeof ray==='string'&&/^[a-f0-9]{16,32}(?:-[A-Z]{3})?$/.test(ray)?ray:null,bytes:null});
  });
  app.addHook('onSend',async(request,_reply,payload)=>{
    const record=selected.get(request);
    if(record&&typeof payload==='string')record.bytes=Buffer.byteLength(payload);
    else if(record&&Buffer.isBuffer(payload))record.bytes=payload.byteLength;
    return payload;
  });
  app.addHook('onResponse',async(request,reply)=>{
    const record=selected.get(request);if(!record)return;selected.delete(request);
    const at=clock(),bucket=Math.floor(+at/60000);if(!Number.isFinite(bucket))return;
    try {
      if(bucket!==window){if(suppressed)emit({code:'CRAWLER_LOG_SUPPRESSED',count:suppressed});window=bucket;used=0;suppressed=0;}
      if(used>=limit){suppressed=Math.min(2147483647,suppressed+1);return;}used++;
      const length=reply.getHeader('content-length'),parsed=typeof length==='number'?length:typeof length==='string'&&/^\d+$/.test(length)?Number(length):null;
      const bytes=request.method==='HEAD'||reply.statusCode===204||reply.statusCode===304?0:parsed!==null&&Number.isSafeInteger(parsed)&&parsed>=0?parsed:record.bytes;
      emit({code:'CRAWLER_RESPONSE',at:at.toISOString(),method:/^[A-Z]{1,16}$/.test(request.method)?request.method:'OTHER',path:record.path,status:reply.statusCode,bytes,userAgent:record.userAgent,cfRay:record.cfRay});
    }catch{/* Observability must never change a public response. */}
  });
}
