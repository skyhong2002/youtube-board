import {test} from 'node:test';
import assert from 'node:assert/strict';
import {NextRequest} from 'next/server';
import {reportRequestStatus} from './request-status';
import {proxy} from '../proxy';
import {INTERNAL_RENDER_HEADER,PUBLIC_RENDER_HEADER} from '../../../shared/public-render-contract';

const base='http://localhost:3100/ai/days/123/events';
test('numeric daily events reject missing, duplicate, whitespace and overlong names before streaming',async()=>{
 const invalid=['','?_rsc=abc','?event=','?event=%20%09','?event=a&event=b',
  '?event='+encodeURIComponent('a'.repeat(257)),'?event='+encodeURIComponent('😀'.repeat(129))];
 for(const query of invalid){
  const url=new URL(base+query),status=reportRequestStatus(url);
  assert.equal(status?.status,400,query);assert.equal(status?.backHref,'/ai/days');
  const response=proxy(new NextRequest(url));
  assert.equal(response.status,400);assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(response.headers.get(PUBLIC_RENDER_HEADER),null);
  assert.equal(response.headers.get('x-middleware-request-'+INTERNAL_RENDER_HEADER),null);
  assert.match(await response.text(),/<a href="\/ai\/days">/);
 }
});
test('valid event names preserve dynamic private rendering including the UTF-16 boundary',()=>{
 for(const event of ['交通 & A/B',' a ','a'.repeat(256),'😀'.repeat(128)]){
  const url=new URL(base);url.searchParams.set('event',event);url.searchParams.set('_rsc','abc');
  assert.equal(reportRequestStatus(url),null);
  const response=proxy(new NextRequest(url));assert.equal(response.status,200);
  assert.equal(response.headers.get('cache-control'),'private, no-store');
  assert.equal(response.headers.get(PUBLIC_RENDER_HEADER),null);
  assert.equal(response.headers.get('x-middleware-request-'+INTERNAL_RENDER_HEADER),'filtered');
 }
 assert.equal(reportRequestStatus(new URL('http://localhost:3100/ai/days/2026-10-14/events')),null);
});
