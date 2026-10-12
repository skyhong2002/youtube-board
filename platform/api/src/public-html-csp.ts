import { createHash } from 'node:crypto';
import { parse, type DefaultTreeAdapterTypes as Tree } from 'parse5';

const MAX_HTML_BYTES = 8 * 1024 * 1024;
const MAX_CSP_BYTES = 12 * 1024;
const MAX_SCRIPTS = 128;
const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';
const FLIGHT_BOOTSTRAP = '(self.__next_f=self.__next_f||[]).push([0])';
const SHELL_TIME = 'requestAnimationFrame(function(){$RT=performance.now()});';
// Audited literals from Next 16.3.8's compiled React production server renderer.
// Deliberately version-pinned: a renderer upgrade must update/review these fixtures.
const BOUNDARY_HELPER = "$RB=[];$RV=function(a){$RT=performance.now();for(var b=0;b<a.length;b+=2){var c=a[b],e=a[b+1];null!==e.parentNode&&e.parentNode.removeChild(e);var f=c.parentNode;if(f){var g=c.previousSibling,h=0;do{if(c&&8===c.nodeType){var d=c.data;if(\"/$\"===d||\"/&\"===d)if(0===h)break;else h--;else\"$\"!==d&&\"$?\"!==d&&\"$~\"!==d&&\"$!\"!==d&&\"&\"!==d||h++}d=c.nextSibling;f.removeChild(c);c=d}while(c);for(;e.firstChild;)f.insertBefore(e.firstChild,c);g.data=\"$\";g._reactRetry&&requestAnimationFrame(g._reactRetry)}}a.length=0};\n$RC=function(a,b){if(b=document.getElementById(b))(a=document.getElementById(a))?(a.previousSibling.data=\"$~\",$RB.push(a,b),2===$RB.length&&(\"number\"!==typeof $RT?requestAnimationFrame($RV.bind(null,$RB)):(a=performance.now(),setTimeout($RV.bind(null,$RB),2300>a&&2E3<a?2300-a:$RT+300-a)))):b.parentNode.removeChild(b)};";
const SEGMENT_HELPER = "$RS=function(a,b){a=document.getElementById(a);b=document.getElementById(b);for(a.parentNode.removeChild(a);a.firstChild;)b.parentNode.insertBefore(a.firstChild,b);b.parentNode.removeChild(b)};";
const CLIENT_RENDER_HELPER = '$RX=function(b,c,d,e,f){var a=document.getElementById(b);a&&(b=a.previousSibling,b.data="$!",a=a.dataset,null!=c&&(a.dgst=c),d&&(a.msg=d),e&&(a.stck=e),f&&(a.cstck=f),b._reactRetry&&b._reactRetry())};;';

export class PublicHtmlPolicyError extends Error {
  constructor(readonly code: string) {
    super(`Public HTML policy rejected response: ${code}`);
    this.name = 'PublicHtmlPolicyError';
  }
}
function reject(code: string): never { throw new PublicHtmlPolicyError(code); }
function sha256(text: string): string {
  return `sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}`;
}
function validDigest(value: string): boolean {
  if (!/^sha256-[A-Za-z0-9+/]{43}=$/.test(value)) return false;
  return Buffer.from(value.slice(7), 'base64').toString('base64') === value.slice(7);
}
function staticScriptUrl(src: string): boolean {
  if (!src.startsWith('/_next/static/') || !src.endsWith('.js')) return false;
  return src.slice(1).split('/').every(segment => segment !== '.' && segment !== '..' && /^[A-Za-z0-9_.()[\]-]+$/.test(segment));
}
function helperCall(source: string, name: '$RC' | '$RS'): boolean {
  const prefix = `${name}(`;
  if (!source.startsWith(prefix) || !source.endsWith(')')) return false;
  // Wrapping the entire argument sequence as JSON rejects trailing statements,
  // calls, comments, spread, identifiers, and nonliteral argument expressions.
  let args: unknown;
  try { args = JSON.parse(`[${source.slice(prefix.length, -1)}]`); } catch { return false; }
  if (!Array.isArray(args) || args.length !== 2 || args.some(arg => typeof arg !== 'string')) return false;
  const [first, second] = args as string[];
  return name === '$RC'
    ? /^B:[0-9a-f]+$/.test(first) && /^S:[0-9a-f]+$/.test(second)
    : /^S:[0-9a-f]+$/.test(first) && /^P:[0-9a-f]+$/.test(second);
}
function clientRenderCall(source: string): boolean {
  if (!source.startsWith('$RX(') || !source.endsWith(')')) return false;
  let args: unknown;
  try { args = JSON.parse(`[${source.slice(4, -1)}]`); } catch { return false; }
  // Production emits only a boundary and optional opaque digest. Never allow
  // development error messages/stacks, expressions, or arbitrary element IDs.
  return Array.isArray(args) && (args.length === 1 || args.length === 2)
    && typeof args[0] === 'string' && /^B:[0-9a-f]{1,16}$/.test(args[0])
    && (args.length === 1 || (typeof args[1] === 'string' && clientRenderDigest(args[1])));
}
function clientRenderDigest(value:string):boolean{
  if(/^[A-Za-z0-9_-]{1,128}$/.test(value)||/^NEXT_HTTP_ERROR_FALLBACK;(401|403|404)$/.test(value))return true;
  const redirect=/^NEXT_REDIRECT;(replace|push);(\/[^;]{0,1023});(303|307|308);$/.exec(value);
  if(!redirect)return false;
  const path=redirect[2]!;
  // Only local URLs. Reject encoded separators/control bytes too, so browser
  // normalization cannot turn a permitted local path into another origin.
  let decoded:string;
  try{decoded=decodeURIComponent(path);}catch{return false;}
  return !/[\\\u0000-\u0020\u007f]/.test(path)&&!/[\\;\u0000-\u0020\u007f]/.test(decoded)
    &&!path.startsWith('//')&&!decoded.startsWith('//')&&!/%(?:25|2f|5c)/i.test(path);
}

/**
 * Couple an HTML entity to a strict CSP. This is a private trusted-Next boundary,
 * not a sanitizer for arbitrary HTML or arbitrary Flight protocol content.
 * assets must come from the immutable local build, never from request input.
 */
export function securePublicHtml(
  html: Buffer,
  options: { assets: ReadonlyMap<string, string>; themeScript: string },
): { body: Buffer; csp: string; clientRenderFailed: boolean } {
  if (html.byteLength > MAX_HTML_BYTES) reject('HTML_TOO_LARGE');
  let source: string;
  try { source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(html); }
  catch { return reject('INVALID_UTF8'); }
  if (!options.themeScript || options.themeScript.includes('\r') || /<\/script/i.test(options.themeScript)) reject('INVALID_THEME_CONFIGURATION');
  const document = parse(source, {
    sourceCodeLocationInfo: true,
    onParseError(error) {
      if (error.code !== 'missing-doctype') reject('MALFORMED_HTML');
    },
  });
  const hashes = new Set<string>();
  const edits: { start: number; end: number; value: string }[] = [];
  let scriptCount = 0;
  let scriptPreloadCount = 0;
  let flightStarted = false;
  let boundaryDeclared = false;
  let segmentDeclared = false;
  let clientRenderFailed = false;
  let themeSeen = false;
  let shellSeen = false;

  function addAssetIntegrity(node: Tree.Element, digest: string): void {
    const location = node.sourceCodeLocation;
    if (!location?.startTag) reject('INCOMPLETE_ASSET_TAG');
    const integrity = location.attrs?.integrity;
    if (integrity) edits.push({ start: integrity.startOffset, end: integrity.endOffset, value: `integrity="${digest}"` });
    else {
      // React emits void links with />. Insert before the slash, retaining the
      // original element syntax and every other attribute byte-for-byte.
      const end = location.startTag.endOffset - 1;
      const start = source[end - 1] === '/' ? end - 1 : end;
      edits.push({ start, end: start, value: ` integrity="${digest}"` });
    }
    hashes.add(digest);
  }

  function approvedInline(text: string): boolean {
    if (text === options.themeScript) {
      if (themeSeen) return false;
      themeSeen = true;
      return true;
    }
    if (text === FLIGHT_BOOTSTRAP) {
      if (flightStarted) return false;
      flightStarted = true;
      return true;
    }
    if (text.startsWith('self.__next_f.push(') && text.endsWith(')')) {
      if (!flightStarted) return false;
      let payload: unknown;
      try { payload = JSON.parse(text.slice('self.__next_f.push('.length, -1)); } catch { return false; }
      if (!Array.isArray(payload) || payload.length !== 2 || typeof payload[1] !== 'string') return false;
      return payload[0] === 1 || (payload[0] === 3 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload[1]));
    }
    if (text === SHELL_TIME) {
      if (shellSeen) return false;
      shellSeen = true;
      return true;
    }
    if (text.startsWith(BOUNDARY_HELPER)) {
      if (boundaryDeclared || !helperCall(text.slice(BOUNDARY_HELPER.length), '$RC')) return false;
      boundaryDeclared = true;
      return true;
    }
    if (text.startsWith(SEGMENT_HELPER)) {
      if (segmentDeclared || !helperCall(text.slice(SEGMENT_HELPER.length), '$RS')) return false;
      segmentDeclared = true;
      return true;
    }
    if (text.startsWith(CLIENT_RENDER_HELPER)) {
      if (clientRenderFailed || !clientRenderCall(text.slice(CLIENT_RENDER_HELPER.length))) return false;
      clientRenderFailed = true;
      return true;
    }
    if (clientRenderFailed && clientRenderCall(text)) return true;
    return (boundaryDeclared && helperCall(text, '$RC')) || (segmentDeclared && helperCall(text, '$RS'));
  }

  const pending: Tree.Node[] = [document];
  while (pending.length) {
    const node = pending.pop()!;
    if ('tagName' in node) {
      const attrs = new Map(node.attrs.map(attr => [attr.name, attr.value]));
      for (const attr of node.attrs) {
        if (/^on/i.test(attr.name)) reject('INLINE_EVENT_HANDLER');
        if (['href', 'src', 'action', 'formaction'].includes(attr.name) && /^javascript:/i.test(attr.value.replace(/[\u0000-\u0020]/g, ''))) reject('JAVASCRIPT_URL');
      }
      if (node.tagName === 'base') reject('BASE_ELEMENT');
      if (node.tagName === 'link') {
        const rel = (attrs.get('rel') ?? '').toLowerCase().split(/[\t\n\f\r ]+/);
        const isScriptPreload = rel.includes('modulepreload')
          || (rel.includes('preload') && (attrs.get('as') ?? '').toLowerCase() === 'script');
        if (isScriptPreload) {
          if (++scriptPreloadCount > MAX_SCRIPTS) reject('TOO_MANY_SCRIPT_PRELOADS');
          if (node.namespaceURI !== HTML_NAMESPACE) reject('FOREIGN_SCRIPT_PRELOAD');
          const href = attrs.get('href') ?? '';
          const digest = options.assets.get(href);
          // A preload is not an independent trust source. Unknown URLs fail
          // closed exactly like external scripts, rather than authorizing a
          // broader script-src to accommodate their speculative fetches.
          if (!staticScriptUrl(href) || !digest || !validDigest(digest)) reject('UNKNOWN_SCRIPT_PRELOAD');
          addAssetIntegrity(node, digest);
        }
      }
      if (node.tagName === 'script') {
        if (++scriptCount > MAX_SCRIPTS) reject('TOO_MANY_SCRIPTS');
        if (node.namespaceURI !== HTML_NAMESPACE) reject('FOREIGN_SCRIPT');
        const location = node.sourceCodeLocation;
        if (!location?.startTag || !location.endTag) reject('INCOMPLETE_SCRIPT');
        const type = (attrs.get('type') ?? '').trim().toLowerCase();
        if (!['', 'text/javascript', 'application/javascript', 'module'].includes(type)) reject('UNKNOWN_SCRIPT_TYPE');
        // HTML normalizes CR/CRLF in rawtext before CSP hashing. No entities
        // are decoded inside script rawtext; preserve original body bytes.
        const text = source.slice(location.startTag.endOffset, location.endTag.startOffset).replace(/\r\n?/g, '\n');
        if (attrs.has('src')) {
          const src = attrs.get('src')!;
          if (text.trim() || !staticScriptUrl(src)) reject('UNKNOWN_EXTERNAL_SCRIPT');
          const digest = options.assets.get(src);
          if (!digest || !validDigest(digest)) reject('UNKNOWN_EXTERNAL_SCRIPT');
          addAssetIntegrity(node, digest);
        } else {
          if (attrs.has('integrity') || attrs.has('nomodule') || type === 'module') reject('UNEXPECTED_INLINE_ATTRIBUTE');
          if (!approvedInline(text)) reject('UNKNOWN_INLINE_SCRIPT');
          hashes.add(sha256(text));
        }
      }
      if (node.tagName === 'template' && 'content' in node) pending.push((node as Tree.Template).content);
    }
    if ('childNodes' in node) for (let i = node.childNodes.length - 1; i >= 0; i--) pending.push(node.childNodes[i]);
  }
  const scriptSources = hashes.size ? `'strict-dynamic' ${[...hashes].map(hash => `'${hash}'`).join(' ')}` : "'none'";
  const csp = `default-src 'self'; script-src ${scriptSources}; script-src-attr 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://i.ytimg.com https://lh3.googleusercontent.com; font-src 'self'; connect-src 'self'; frame-src https://www.youtube-nocookie.com https://www.youtube.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'`;
  if (Buffer.byteLength(csp) > MAX_CSP_BYTES) reject('CSP_TOO_LARGE');
  edits.sort((a, b) => b.start - a.start);
  for (const edit of edits) source = source.slice(0, edit.start) + edit.value + source.slice(edit.end);
  const body = Buffer.from(source, 'utf8');
  if (body.byteLength > MAX_HTML_BYTES) reject('HTML_TOO_LARGE');
  return { body, csp, clientRenderFailed };
}
