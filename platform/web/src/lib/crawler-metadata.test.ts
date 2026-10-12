import assert from 'node:assert/strict';
import {test} from 'node:test';
import sitemap from '../app/sitemap';
import robots from '../app/robots';
import {SITE_ORIGIN} from './site';
import {NAV_GROUPS} from './site-nav';
import {resolveRoute} from './routes';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import SiteSearch from '../components/SiteSearch';

test('bounded sitemap uses canonical public routes without invented timestamps, accounts or query variants',()=>{
 const rows=sitemap(),urls=rows.map(row=>row.url);
 assert.ok(rows.length>0&&rows.length<=50);assert.equal(new Set(urls).size,rows.length);
 for(const row of rows){
  const url=new URL(row.url);assert.equal(url.origin,SITE_ORIGIN);assert.equal(url.search,'');assert.equal(url.hash,'');assert.equal(url.username,'');
  assert.deepEqual(Object.keys(row),['url']);assert.doesNotMatch(url.pathname,/^\/(?:auth|login|my|manage|ops|api|runtime|boards|feeds)(?:\/|$)/);
  assert.ok(['/', '/events', '/about', '/compare/titles'].includes(url.pathname)||resolveRoute(url.pathname.slice(1).split('/')),url.pathname);
 }
 for(const {links} of NAV_GROUPS)for(const link of links)if(link.href!=='/boards')assert.ok(urls.includes(new URL(link.href,SITE_ORIGIN).href),link.href);
 assert.deepEqual(sitemap(),rows);
});
test('robots allows public discovery but excludes auth, reader, operator and bearer-feed paths',()=>{
 const metadata=robots();assert.equal(metadata.sitemap,new URL('/sitemap.xml',SITE_ORIGIN).href);
 assert.ok(!Array.isArray(metadata.rules));const rule=metadata.rules as {userAgent:string;allow:string;disallow:string[]};
 assert.equal(rule.userAgent,'*');assert.equal(rule.allow,'/');
 for(const path of ['/auth/google/callback','/login','/my','/my/follows','/manage','/ops/ingestion','/api/ops/editorial','/feeds/u/private-token.xml','/runtime/ready'])assert.ok(rule.disallow.some(prefix=>path.startsWith(prefix)),path);
 for(const row of sitemap())assert.ok(!rule.disallow.some(prefix=>new URL(row.url).pathname.startsWith(prefix)),row.url);
});
test('actual header search submits q to the public videos report',()=>{
 const html=renderToStaticMarkup(createElement(SiteSearch,{q:'交通'}));assert.match(html,/<form[^>]*action="\/videos"/);assert.match(html,/name="q"/);assert.match(html,/value="交通"/);assert.doesNotMatch(html,/action="\/search"/);
});
