import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse, type DefaultTreeAdapterTypes as Tree } from 'parse5';
import { PublicHtmlPolicyError, securePublicHtml } from '../src/public-html-csp.js';
const theme = 'document.documentElement.dataset.theme="dark";';
const bootstrap = '(self.__next_f=self.__next_f||[]).push([0])';
const digest = (text: string) => `sha256-${createHash('sha256').update(text).digest('base64')}`;
const assetHash = digest('window.app = true;');
const assets = new Map([['/_next/static/chunks/app.js', assetHash]]);
const opts = { themeScript: theme, assets };
const script = (text: string) => `<script>${text}</script>`;
const html = (content: string) => Buffer.from(`<!doctype html><html><head><meta charset="utf-8"></head><body>${content}</body></html>`);
const secure = (content: string) => securePublicHtml(html(content), opts);
// Independent installed producer literals, not exports from the policy allowlist.
const renderer = readFileSync(new URL('../../node_modules/next/dist/compiled/react-dom/cjs/react-dom-server.node.production.js', import.meta.url), 'utf8');
function producerLiteral(name: string): string {
  const match = renderer.match(new RegExp(`${name} = stringToPrecomputedChunk\\(\\s*'([^']*)'`));
  if (!match) throw new Error(`Missing installed React literal: ${name}`);
  return JSON.parse(`"${match[1].replaceAll('"', '\\"')}"`) as string;
}
const boundary = producerLiteral('completeBoundaryScriptFunctionOnly');
const segment = producerLiteral('completeSegmentScript1Full').slice(0, -5);

describe('public HTML hash CSP', () => {
  it('hashes audited inline scripts and attaches build SRI to external scripts', () => {
    const inline = [theme, 'requestAnimationFrame(function(){$RT=performance.now()});', boundary + '$RC("B:0","S:0")', bootstrap, 'self.__next_f.push([1,"hello"])'];
    const result = secure('<script async src="/_next/static/chunks/app.js"></script>' + inline.map(script).join(''));
    const scriptPolicy = result.csp.split(';').find(value => value.trim().startsWith('script-src '))!;
    expect(scriptPolicy).toContain("'strict-dynamic'");
    expect(scriptPolicy).not.toMatch(/unsafe-inline|unsafe-eval|nonce-|\bself\b/);
    expect(result.csp).toContain("script-src-attr 'none'");
    for (const text of inline) expect(result.csp).toContain(`'${digest(text)}'`);
    expect(result.body.toString()).toContain(`integrity="${assetHash}"`);
    expect(result.csp).toContain(`'${assetHash}'`);
  });
  it('preserves all original bytes except external integrity replacement/insertion', () => {
    const original = html('<p title="測試">影片 😀</p><script type="module" async src="/_next/static/chunks/app.js" integrity="old"></script>');
    const result = securePublicHtml(original, opts);
    expect(result.body.toString()).toBe(original.toString().replace('integrity="old"', `integrity="${assetHash}"`));
  });
  it.each([
    '<link rel="preload" as="script" href="/_next/static/chunks/app.js">',
    '<link rel="preload" as="script" href="/_next/static/chunks/app.js"/>',
    '<link rel="MODULEPRELOAD" href="/_next/static/chunks/app.js" crossorigin="anonymous" />',
    '<link rel="alternate preload" as="SCRIPT" href="/_next/static/chunks/app.js" integrity="stale">',
  ])('matches preload and script integrity for %s', link => {
    const result = secure(link + '<script async src="/_next/static/chunks/app.js"></script>');
    const pending: Tree.Node[] = [parse(result.body.toString())];
    const observed: { tag: string; integrity?: string }[] = [];
    while (pending.length) {
      const node = pending.pop()!;
      if ('tagName' in node && ['link', 'script'].includes(node.tagName)) observed.push({ tag: node.tagName, integrity: node.attrs.find(attr => attr.name === 'integrity')?.value });
      if ('childNodes' in node) pending.push(...node.childNodes);
    }
    expect(observed).toHaveLength(2);
    for (const node of observed) expect(node.integrity).toBe(assetHash);
    expect(result.csp.split(assetHash).length).toBe(2);
    if (link.endsWith('/>')) expect(result.body.toString()).toContain(` integrity="${assetHash}"/>`);
  });
  it('leaves non-script preloads and stylesheets unchanged', () => {
    const content = '<link rel="preload" as="image" href="/image.png"><link rel="preload" as="font" href="/font.woff2" crossorigin><link rel="stylesheet" href="/style.css" integrity="existing"><link rel="preload" as="style" href="/style.css"><link rel="prefetch" href="/_next/static/chunks/app.js">';
    const input = html(content);
    expect(securePublicHtml(input, opts).body).toEqual(input);
    expect(securePublicHtml(input, opts).csp).toContain("script-src 'none'");
  });
  it.each([
    '<link rel="preload" as="script" href="https://example.com/evil.js">',
    '<link rel="modulepreload" href="/_next/static/chunks/missing.js">',
    '<link rel="preload" as="script" href="/_next/static/chunks/app.js?q=1">',
    '<link rel="modulepreload">',
    '<link rel="preload" as="script" href="/_next/static/chunks/app.js" href="/evil.js">',
    '<link rel="modulepreload" href="/_next/static/chunks/app.js" integrity="a" integrity="b">',
  ])('rejects unknown or ambiguous script preloads: %s', link => {
    expect(() => secure(link)).toThrow(PublicHtmlPolicyError);
  });
  it('rejects invalid preload manifest hashes and bounds speculative script tags', () => {
    const link = '<link rel="modulepreload" href="/_next/static/chunks/app.js">';
    expect(() => securePublicHtml(html(link), { ...opts, assets: new Map([['/_next/static/chunks/app.js', 'sha256-invalid']]) })).toThrow('UNKNOWN_SCRIPT_PRELOAD');
    expect(() => secure(link.repeat(129))).toThrow('TOO_MANY_SCRIPT_PRELOADS');
  });
  it('enforces the shared CSP header budget across scripts and preloads', () => {
    const manifest = new Map(Array.from({ length: 256 }, (_, index) => [`/_next/static/chunks/${index}.js`, digest(`asset-${index}`)]));
    const content = [...manifest.keys()].map((url, index) => index < 128
      ? `<script src="${url}"></script>`
      : `<link rel="modulepreload" href="${url}">`).join('');
    expect(() => securePublicHtml(html(content), { ...opts, assets: manifest })).toThrow('CSP_TOO_LARGE');
  });
  it('accepts escaped attacker text as Flight string data', () => {
    const payload = JSON.stringify([1, '</script><script>alert(1)</script> ");alert(1);//']).replaceAll('<', '\\u003c');
    expect(() => secure(script(bootstrap) + script(`self.__next_f.push(${payload})`))).not.toThrow();
  });
  it.each([
    'self.__next_f.push([1,"x"]);alert(1)', 'self.__next_f.push([1,alert(1)])',
    'self.__next_f.push([1,`x${alert(1)}`])', 'self.__next_f.push([1,"x"],alert(1))',
    'self.__next_f.push([1,"x"]/*comment*/)', 'self.__next_f.push([2,{"form":"state"}])',
    'self.__next_f.push([0])', 'self.__next_f.push([3,"invalid base64!"])',
    'self["__next_f"].push([1,"x"])', 'alert(1)',
  ])('rejects unknown or executable Flight forms: %s', text => {
    expect(() => secure(script(bootstrap) + script(text))).toThrow(PublicHtmlPolicyError);
  });
  it('requires bootstrap before data and rejects duplicate bootstrap/theme', () => {
    expect(() => secure(script('self.__next_f.push([1,"x"])'))).toThrow();
    expect(() => secure(script(bootstrap).repeat(2))).toThrow();
    expect(() => secure(script(theme).repeat(2))).toThrow();
    expect(() => secure(script(bootstrap) + script('self.__next_f.push([3,"aGVsbG8="])'))).not.toThrow();
  });
  it('accepts installed React helpers and subsequent literal calls with changing IDs', () => {
    expect(() => secure(script(boundary + '$RC("B:1a","S:2b")') + script('$RC("B:2","S:3")') + script(segment + '$RS("S:f","P:0")') + script('$RS("S:10","P:a")'))).not.toThrow();
  });
  it.each([
    '$RC("B:0","S:0")', boundary + '$RC("B:0","S:0");alert(1)',
    boundary + '$RC("B:0",evil())', boundary + '$RC("arbitrary-id","S:0")',
    boundary.replace('performance.now()', 'alert(1)') + '$RC("B:0","S:0")',
    '$RR("B:0","S:0",[])', '$RX("B:0")', segment + '$RS("S:0","P:0");alert(1)',
  ])('rejects unaudited helper/invocation case %#', text => {
    expect(() => secure(script(text))).toThrow();
  });
  it.each([
    'https://example.com/evil.js', '//example.com/evil.js', '/api/payload.js',
    '/_next/static/chunks/missing.js', '/_next/static/chunks/app.js?v=1',
    '/_next/static/chunks/../chunks/app.js', '/_next/static/chunks/%61pp.js', '/_next/static//chunks/app.js',
  ])('rejects external URL outside the immutable manifest: %s', src => {
    expect(() => secure(`<script src="${src}"></script>`)).toThrow();
  });
  it('rejects malformed digests and permits module/async/nomodule external scripts', () => {
    expect(() => securePublicHtml(html('<script src="/_next/static/chunks/app.js"></script>'), { ...opts, assets: new Map([['/_next/static/chunks/app.js', "sha256-x' unsafe-inline"]]) })).toThrow();
    expect(() => secure('<script type="module" async src="/_next/static/chunks/app.js"></script><script nomodule src="/_next/static/chunks/app.js"></script>')).not.toThrow();
  });
  it.each([
    '<script src="/_next/static/chunks/app.js" src="/evil.js"></script>',
    '<script src="/_next/static/chunks/app.js" integrity="x" integrity="y"></script>',
    '<script>alert(1)', '<script src="/_next/static/chunks/app.js">alert(1)</script>',
    `<script integrity="x">${theme}</script>`, `<script type="module">${theme}</script>`,
    '<svg><script>alert(1)</script></svg>', '<img src="x" onerror="alert(1)">',
    '<a href="java&#x0a;script:alert(1)">x</a>', '<base href="https://example.com/">',
    '<template><script>alert(1)</script></template>',
  ])('rejects parser ambiguity and execution sinks: %s', content => {
    expect(() => secure(content)).toThrow();
  });
  it('normalizes rawtext CRLF for CSP hashing but preserves response bytes', () => {
    const text = 'self.__next_f.push([1,\r\n"x"])';
    const input = html(script(bootstrap) + script(text));
    const result = securePublicHtml(input, opts);
    expect(result.body).toEqual(input);
    expect(result.csp).toContain(`'${digest(text.replace('\r\n', '\n'))}'`);
  });
  it('rejects invalid UTF8 and oversized/script-heavy input with source-free errors', () => {
    expect(() => securePublicHtml(Buffer.from([0xc3, 0x28]), opts)).toThrow('INVALID_UTF8');
    expect(() => securePublicHtml(Buffer.alloc(8 * 1024 * 1024 + 1), opts)).toThrow('HTML_TOO_LARGE');
    expect(() => secure('<script src="/_next/static/chunks/app.js"></script>'.repeat(129))).toThrow('TOO_MANY_SCRIPTS');
    expect(() => secure(script('sensitive-secret'))).toThrow('UNKNOWN_INLINE_SCRIPT');
  });
  it('preserves BOM, restricts scriptless HTML, and deduplicates CSP hashes', () => {
    const empty = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), html('<p>safe</p>')]);
    expect(securePublicHtml(empty, opts).body).toEqual(empty);
    expect(securePublicHtml(empty, opts).csp).toContain("script-src 'none'");
    const result = secure('<script src="/_next/static/chunks/app.js"></script>'.repeat(2));
    expect(result.csp.split(assetHash).length).toBe(2);
  });
});
