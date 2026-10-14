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
test('decoded numeric spellings cannot bypass validation or enter canonical ISR',async()=>{
 for(const path of ['/ai/days/0123/events','/ai/days/%31%32%33/events','/ai/%64ays/123/%65vents']){
  for(const query of ['', '?_rsc=abc'])assert.equal(proxy(new NextRequest('http://localhost:3100'+path+query)).status,400,path+query);
  const valid=proxy(new NextRequest('http://localhost:3100'+path+'?event=A'));
  assert.equal(valid.status,200);assert.equal(valid.headers.get('cache-control'),'private, no-store');
  assert.equal(valid.headers.get('x-middleware-request-'+INTERNAL_RENDER_HEADER),'filtered');
 }
 // Encoded first families cannot match the literal-family relative rewrite.
 // Reject them (even with a valid query), plus IDs rejected by positiveId.
 for(const path of ['/%61i/days/123/events','/ai/days/0/events','/ai/days/9007199254740992/events']){
  const response=proxy(new NextRequest('http://localhost:3100'+path+'?event=A'));
  assert.equal(response.status,400,path);assert.equal(response.headers.get(PUBLIC_RENDER_HEADER),null);
  assert.equal(response.headers.get('cache-control'),'no-store');
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
