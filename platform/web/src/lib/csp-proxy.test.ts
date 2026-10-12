import {test} from 'node:test';
import assert from 'node:assert/strict';
import {NextRequest} from 'next/server';
import {proxy} from '../proxy';
test('HTML CSP overwrites spoofed nonce/policy and every response gets a fresh no-store nonce',()=>{
 const request=()=>new NextRequest('http://localhost:3100/keywords/traffic/videos',{headers:{'x-nonce':'attacker-controlled','content-security-policy':"script-src 'unsafe-inline'",'x-forwarded-host':'evil.test'}});
 const a=proxy(request()),b=proxy(request()),nonce=a.headers.get('x-middleware-request-x-nonce');
 assert.ok(nonce&&nonce!=='attacker-controlled');assert.notEqual(nonce,b.headers.get('x-middleware-request-x-nonce'));
 const policy=a.headers.get('content-security-policy')!;assert.ok(policy.includes(`'nonce-${nonce}'`));assert.equal(a.headers.get('x-middleware-request-content-security-policy'),policy);assert.match(policy,/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);assert.match(policy,/object-src 'none'/);assert.match(policy,/frame-ancestors 'self'/);assert.match(policy,/form-action 'self'/);assert.doesNotMatch(policy,/script-src[^;]*'unsafe-inline'/);assert.equal(a.headers.get('cache-control'),'private, no-store');
});
test('image optimization does not inherit a per-HTML nonce or no-store policy',()=>{
 const request=new NextRequest('http://localhost:3100/_next/image?'+new URLSearchParams({url:'https://i.ytimg.com/vi/AbCdEfGh123/mqdefault.jpg',w:'96',q:'75'}));const response=proxy(request);assert.equal(response.headers.get('content-security-policy'),null);assert.equal(response.headers.get('x-middleware-request-x-nonce'),null);assert.equal(response.headers.get('cache-control'),null);
});
