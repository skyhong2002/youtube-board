import {createHash} from 'node:crypto';
import {readdir, readFile, lstat} from 'node:fs/promises';
import path from 'node:path';
import type {FastifyRequest} from 'fastify';
export {PUBLIC_RENDER_HEADER} from '../../shared/public-render-contract.js';

/** Read immutable release files, never fetch a URL supplied by an HTML document. */
export async function publicScriptManifest(root: string): Promise<ReadonlyMap<string,string>> {
  const assets = new Map<string,string>();
  let bytes = 0;
  async function visit(relative: string) {
    const directory = path.join(root, relative);
    if (!(await lstat(directory)).isDirectory()) throw new Error('Invalid static asset directory');
    for (const entry of await readdir(directory, {withFileTypes:true})) {
      if (entry.isSymbolicLink()) throw new Error('Static asset symlink refused');
      const name = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) await visit(name);
      else if (entry.isFile() && name.endsWith('.js')) {
        if (assets.size >= 2048) throw new Error('Static script manifest exceeds budget');
        const filename = path.join(root,name), stat = await lstat(filename);
        if (!stat.isFile() || stat.size > 16*1024*1024 || (bytes += stat.size) > 64*1024*1024) throw new Error('Static scripts exceed byte budget');
        const body = await readFile(filename);
        assets.set('/_next/static/'+name, 'sha256-'+createHash('sha256').update(body).digest('base64'));
      }
    }
  }
  await visit('');
  if (!assets.size) throw new Error('Empty static script manifest');
  return assets;
}

export const PRIVATE_CACHE = 'private, no-store, no-transform';
const transportHeaders = ['rsc','next-router-state-tree','next-router-prefetch','next-router-segment-prefetch','next-url','x-nextjs-data','next-action'];
export function publicMarkerMatches(marker:unknown,pathname:string):boolean {
  if(marker==='home')return pathname==='/';
  if(marker==='events')return pathname==='/events';
  if(marker==='event')return /^\/events\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(pathname);
  if(marker==='report')return /^\/(?:channels|videos|keywords|tags|live|ai|groups|mayor|comments)(?:\/|$)/.test(pathname);
  return false;
}
/** Only canonical anonymous HTML is shareable. Query and RSC are separate variants. */
export function publicHtmlTtl(request: Pick<FastifyRequest,'url'|'method'|'headers'>): number | null {
  if (request.method !== 'GET' || request.url.includes('?') || request.headers.cookie !== undefined || request.headers.authorization !== undefined ||
      transportHeaders.some(name => request.headers[name] !== undefined)) return null;
  if (String(request.headers.accept??'').includes('text/x-component')) return null;
  const pathname = request.url;
  // Only one canonical spelling gets a shared representation. Encoded separators,
  // dot segments and slash aliases are still handled normally, but never shared.
  if(!pathname.startsWith('/')||pathname.includes('//')||pathname.includes('\\')||/%(?:2f|5c|2e)/i.test(pathname)||
     (pathname!=='/'&&pathname.endsWith('/')))return null;
  try {if(new URL(pathname,'http://canonical.invalid').pathname!==pathname)return null;decodeURIComponent(pathname);}catch{return null;}
  if (pathname === '/') return 60;
  if (/^\/live(?:\/|$)/.test(pathname)) return 30;
  if (/^\/(?:channels|videos|keywords|events|tags|ai|groups|mayor|comments)(?:\/|$)/.test(pathname)) return 60;
  if (/^\/(?:about|brand)\/?$/.test(pathname)) return 300;
  return null;
}

/** Preserve Next's Vary axes and explicitly exclude credential/RSC representation mixing. */
export function publicHtmlVary(value: unknown): string {
  const names = String(value??'').split(',').map(s=>s.trim()).filter(Boolean);
  if (names.includes('*')) return '*';
  const result = new Map(names.map(name=>[name.toLowerCase(),name]));
  for (const name of ['Cookie','Authorization','RSC','Next-Router-State-Tree','Next-Router-Prefetch','Next-Router-Segment-Prefetch','Next-Url','Accept','Accept-Encoding']) result.set(name.toLowerCase(),name);
  return [...result.values()].join(', ');
}

export function acceptsGzip(value:unknown):boolean {
  if(typeof value!=='string')return false;
  return value.split(',').some(part=>{
    const match=/^\s*gzip\s*(?:;\s*q=(0(?:\.\d{1,3})?|1(?:\.0{1,3})?))?\s*$/i.exec(part);
    return match!==null&&(match[1]===undefined||Number(match[1])>0);
  });
}

export function publicCacheControl(ttl:number,stale:number,revalidation?:string): string {
  // An edge must preserve the exact script bytes bound to this CSP.
  return `public, max-age=0, s-maxage=${ttl}, stale-while-revalidate=${stale}, no-transform${revalidation?', '+revalidation:''}`;
}

export function upstreamPublicPolicy(value:unknown,age:unknown=undefined):{ttl:number;stale:number;revalidation?:string}|null {
  if(typeof value!=='string'||/\b(?:private|no-store|no-cache)\b/i.test(value))return null;
  const directives=value.split(',').map(s=>s.trim().toLowerCase());
  function seconds(name:string,fallback:number|null):number|null {
    const matches=directives.filter(s=>s.split('=')[0].trim()===name);
    if(!matches.length)return fallback;
    if(matches.length!==1)return null;
    const match=new RegExp('^'+name+'\\s*=\\s*(\\d+)$').exec(matches[0]);
    const seconds=match?Number(match[1]):NaN;return Number.isSafeInteger(seconds)?seconds:null;
  }
  const ttl=seconds('s-maxage',null), stale=seconds('stale-while-revalidate',0);
  const ageSeconds=age===undefined?0:typeof age==='string'&&/^\d+$/.test(age)?Number(age):NaN;
  if(ttl===null||stale===null||!Number.isSafeInteger(ageSeconds)||ttl<=ageSeconds)return null;
  const revalidation=['must-revalidate','proxy-revalidate'].filter(s=>directives.includes(s)).join(', ');
  return {ttl:ttl-ageSeconds,stale:revalidation?0:stale,...(revalidation?{revalidation}:{})};
}
