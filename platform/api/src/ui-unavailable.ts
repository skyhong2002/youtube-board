import type {FastifyReply,RouteGenericInterface,RawServerBase} from 'fastify';
import {open} from 'node:fs/promises';
import {securePublicHtml} from './public-html-csp.js';
import {PRIVATE_CACHE,PUBLIC_RENDER_HEADER} from './public-html.js';
import {REPORT_FAMILIES} from '../../shared/public-render-contract.js';

const MAX_ASSET_BYTES=64*1024;
const STATIC_CSP="default-src 'none'; style-src 'self'; script-src 'none'; base-uri 'none'; frame-ancestors 'self'; object-src 'none'; form-action 'none'";
const REPORT_PATHS=new Set<string>(REPORT_FAMILIES);
const NONPAGE_PREFIX=/^\/(?:_next|brand|media|errors|feeds)(?:\/|$)/;
const ASSET_EXTENSION=/\.(?:xml|txt|json|webmanifest|map|[cm]?js|css|svg|png|jpe?g|gif|webp|avif|ico|bmp|tiff?|woff2?|ttf|otf|eot|wasm|pdf|mp[34]|webm|ogg|wav)$/i;
export interface UnavailableAssets {unavailableHtml?:Buffer;unavailableCss?:Buffer}
/** Read only packaged, repository-owned assets, bounded before allocation. */
export async function loadUnavailableAssets(directory:URL):Promise<Required<UnavailableAssets>>{
  async function read(name:string){
    const file=await open(new URL(name,directory),'r');
    try{
      const stat=await file.stat();if(!stat.isFile()||stat.size<1||stat.size>MAX_ASSET_BYTES)throw new Error('Invalid unavailable asset size');
      const buffer=Buffer.alloc(MAX_ASSET_BYTES+1);let size=0;
      while(size<buffer.length){const part=await file.read(buffer,size,buffer.length-size,null);if(!part.bytesRead)break;size+=part.bytesRead;}
      if(size<1||size>MAX_ASSET_BYTES)throw new Error('Invalid unavailable asset size');
      return buffer.subarray(0,size);
    }finally{await file.close();}
  }
  return {unavailableHtml:await read('unavailable.html'),unavailableCss:await read('unavailable.css')};
}
export function unavailableResponder(assets:UnavailableAssets){
  let html:Buffer|undefined;
  if(assets.unavailableHtml){
    if(!assets.unavailableHtml.length||assets.unavailableHtml.length>MAX_ASSET_BYTES)throw new Error('Unavailable HTML size outside cap');
    const checked=securePublicHtml(assets.unavailableHtml,{assets:new Map(),themeScript:'/* unused static fallback */'});
    if(!checked.csp.includes("script-src 'none'"))throw new Error('Unavailable HTML must be scriptless');
    html=checked.body;
  }
  const css=assets.unavailableCss?Buffer.from(assets.unavailableCss):undefined;
  if(css&&(!css.length||css.length>MAX_ASSET_BYTES))throw new Error('Unavailable CSS exceeds cap');
  return {
    css,
    send(reply:FastifyReply<RouteGenericInterface,RawServerBase>){
      // Drop upstream headers, including cookies/redirects/cache variants. The
      // fallback never contains request URLs, provider errors or upstream bytes.
      for(const name of Object.keys(reply.getHeaders()))reply.removeHeader(name);
      const pathname=reply.request.url.split('?')[0]??'';
      // A query value or an opaque report name ending in .json is still a page.
      // Static/metadata and feed failures must never receive an HTML document.
      const report=REPORT_PATHS.has(pathname.split('/')[1]??'');
      const page=reply.request.headers.rsc===undefined&&!NONPAGE_PREFIX.test(pathname)&&(report||!ASSET_EXTENSION.test(pathname));
      reply.code(503).header('Cache-Control',PRIVATE_CACHE).header('Content-Security-Policy',STATIC_CSP)
        .header('Retry-After','5').header('X-Content-Type-Options','nosniff')
        .header('Strict-Transport-Security','max-age=31536000');
      reply.removeHeader(PUBLIC_RENDER_HEADER);
      const body=page&&html?html:Buffer.from('Public page temporarily unavailable.');
      reply.type(page&&html?'text/html; charset=utf-8':'text/plain; charset=utf-8');
      if(reply.request.method==='HEAD')return reply.header('Content-Length',body.length).send();
      return reply.send(body);
    },
  };
}
