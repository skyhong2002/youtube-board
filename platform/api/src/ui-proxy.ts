import proxy from '@fastify/http-proxy';
import type { FastifyInstance } from 'fastify';
import {promisify} from 'node:util';
import {gzip} from 'node:zlib';
import {HtmlRenderSlots} from './html-render-slots.js';
import { validImageOptimizationQuery } from '../../shared/image-policy.js';
import {securePublicHtml} from './public-html-csp.js';
import {PRIVATE_CACHE, PUBLIC_RENDER_HEADER, publicMarkerMatches,publicHtmlTtl, publicHtmlVary, publicCacheControl,upstreamPublicPolicy,acceptsGzip} from './public-html.js';
import {INTERNAL_RENDER_HEADER,isInternalRenderPath} from '../../shared/public-render-contract.js';
const gzipAsync=promisify(gzip);

export type HtmlSecurityOptions = {assets:ReadonlyMap<string,string>;themeScript:string};

/** The gateway owns API/ops namespaces; the exact read-only console page reaches Next. */
export async function registerUiProxy(app: FastifyInstance, options: { origin: string; htmlSecurity?:HtmlSecurityOptions }) {
  const origin = new URL(options.origin);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('Invalid UI origin');
  const slots=new HtmlRenderSlots();
  await app.register(proxy, {
    upstream: origin.origin,
    prefix: '/',
    websocket: false,
    preHandler(request, reply, done) {
      let path = request.url.split('?')[0] ?? '';
      try {
        if (/%25[0-9a-f]{2}/i.test(path)) { reply.code(400).send({ error: { code: 'INVALID_PATH' } }); return; }
        // Route families are literal ASCII. Aliases such as /%63hannels can
        // disagree with Next's literal beforeFiles rules and lose query filters.
        if (/%[0-9a-f]{2}/i.test(path.split('/')[1]??'')) {reply.code(404).header('Cache-Control','no-store').send({error:{code:'NOT_FOUND'}});return;}
        path = new URL(decodeURIComponent(path).replaceAll('\\', '/').replace(/^\/+/, '/'), 'http://gateway.invalid').pathname; }
      catch { reply.code(400).send({ error: { code: 'INVALID_PATH' } }); return; }
      if (!['GET', 'HEAD'].includes(request.method)) { reply.code(405).header('Allow', 'GET, HEAD').send({ error: { code: 'METHOD_NOT_ALLOWED' } }); return; }
      if (isInternalRenderPath(path)) { reply.code(404).header('Cache-Control','no-store').send({error:{code:'NOT_FOUND'}});return; }
      if (path === '/_next/image' && !validImageOptimizationQuery(new URL(request.url, 'http://gateway.invalid').searchParams)) {
        reply.code(400).header('Cache-Control', 'no-store').send({ error: { code: 'INVALID_IMAGE' } }); return;
      }
      const ingestionConsole = /^\/ops\/ingestion\/?$/.test(path) && ['GET', 'HEAD'].includes(request.method);
      if ((/^\/(?:api|ops|auth)(?:\/|$)/.test(path) || /^\/feeds\/u(?:\/|$)/.test(path)) && !ingestionConsole) {
        reply.code(404).header('Cache-Control', 'no-store').send({ error: { code: 'NOT_FOUND' } });
        return;
      }
      done();
    },
    replyOptions: {
      rewriteRequestHeaders: (request, headers) => {
        const safe = {...headers};
        for (const name of ['authorization','cookie','proxy-authorization',PUBLIC_RENDER_HEADER,INTERNAL_RENDER_HEADER,'x-yt-public-render','x-nonce','content-security-policy','content-security-policy-report-only']) delete safe[name];
        if(options.htmlSecurity && !request.url.startsWith('/_next/') && request.headers.rsc===undefined) {
          safe['accept-encoding']='identity';
          // A 304/206 without its entity cannot be paired with a regenerated hash
          // policy. Public HTML always receives a complete trusted representation.
          for(const name of ['if-none-match','if-modified-since','if-match','if-unmodified-since','range','if-range'])delete safe[name];
        }
        return safe;
      },
      ...(options.htmlSecurity ? {onResponse(request, reply, upstream) {
        const security=options.htmlSecurity!;
        const marker=reply.getHeader(PUBLIC_RENDER_HEADER);
        reply.removeHeader(PUBLIC_RENDER_HEADER);
        const type=String(reply.getHeader('content-type')??'');
        // Never share Next Flight, credentialed HTML, error documents or redirects.
        if (!type.toLowerCase().startsWith('text/html') || request.method==='HEAD') {
          if (!/^\/_next\/(?:static|image)(?:\/|\?|$)/.test(request.url)) {
            reply.header('Cache-Control',PRIVATE_CACHE);
            reply.removeHeader('content-security-policy-report-only');
            reply.header('Content-Security-Policy',"default-src 'none'; frame-ancestors 'self'; base-uri 'none'; object-src 'none'");
          }
          else if(request.url.startsWith('/_next/static/')) {
            const cache=String(reply.getHeader('cache-control')??'no-store');
            reply.header('Cache-Control',cache+(cache.includes('no-transform')?'':', no-transform'));
          }
          reply.send(upstream.stream); return;
        }
        const fail=()=>{
          upstream.stream.destroy();
          for(const name of ['content-length','content-encoding','etag','content-security-policy-report-only','location']) reply.removeHeader(name);
          reply.code(502).header('Cache-Control',PRIVATE_CACHE).header('Content-Security-Policy',"default-src 'none'; frame-ancestors 'self'; base-uri 'none'; object-src 'none'")
            .type('text/plain; charset=utf-8').send('Public page temporarily unavailable.');
        };
        if(reply.getHeader('content-encoding') && reply.getHeader('content-encoding')!=='identity') {fail();return;}
        // An upstream can error while waiting for a bounded buffer slot, before
        // the async iterator attaches its own listener.
        upstream.stream.once('error',()=>{});
        const waiting=new AbortController();
        const timeout=setTimeout(()=>upstream.stream.destroy(new Error('HTML response deadline')),15000).unref();
        const aborted=()=>{waiting.abort();upstream.stream.destroy(new Error('Client disconnected'));};
        request.raw.once('aborted',aborted);
        void (async()=>{
          let release:(()=>void)|null=null;
          try {
            release=await slots.acquire(waiting.signal);
            if(!release){
              upstream.stream.destroy();
              for(const name of ['content-length','content-encoding','etag','content-security-policy-report-only'])reply.removeHeader(name);
              if(!request.raw.aborted)reply.code(503).header('Cache-Control',PRIVATE_CACHE).header('Retry-After','1')
                .header('Content-Security-Policy',"default-src 'none'; frame-ancestors 'self'; base-uri 'none'; object-src 'none'")
                .type('text/plain').send('Public page temporarily busy.');
              return;
            }
            const chunks:Buffer[]=[];let size=0;
            for await(const chunk of upstream.stream) {
              const buffer=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
              if((size+=buffer.length)>8*1024*1024) throw new Error('HTML response exceeds budget');
              chunks.push(buffer);
            }
            const result=securePublicHtml(Buffer.concat(chunks),security);
            const vary=publicHtmlVary(reply.getHeader('vary'));
            const ttl=publicHtmlTtl(request);
            const upstreamPolicy=upstreamPublicPolicy(reply.getHeader('cache-control'),reply.getHeader('age'));
            const shareable=reply.statusCode===200 && publicMarkerMatches(marker,request.url) && ttl!==null && upstreamPolicy!==null &&
              String(reply.getHeader('x-nextjs-cache')??'').toUpperCase()!=='STALE' && !reply.hasHeader('set-cookie') && vary!=='*';
            for(const name of ['content-length','content-encoding','etag','age','content-security-policy-report-only']) reply.removeHeader(name);
            reply.header('Content-Security-Policy',result.csp).header('Vary',vary)
              .header('Cache-Control',shareable?publicCacheControl(Math.min(ttl!,upstreamPolicy!.ttl),Math.min(ttl!,upstreamPolicy!.stale),upstreamPolicy!.revalidation):PRIVATE_CACHE)
              .header('Date',new Date().toUTCString())
              .header('X-Content-Type-Options','nosniff').header('Strict-Transport-Security','max-age=31536000');
            const encoded=acceptsGzip(request.headers['accept-encoding'])?await gzipAsync(result.body,{level:4}):null;
            if(encoded)reply.header('Content-Encoding','gzip');
            reply.send(encoded??result.body);
          } catch {
            // Do not log HTML, URLs, cookies or parsing details: pages can contain user data.
            request.log.warn({code:'PUBLIC_HTML_REJECTED'},'HTML integrity validation failed');
            if(!reply.sent&&!request.raw.aborted) fail();
          } finally {clearTimeout(timeout);request.raw.off('aborted',aborted);release?.();}
        })();
      }} : {}),
    },
  });
}
