import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import Wordmark from '../components/Wordmark';
import manifest from '../app/manifest';
import {BRAND_VERSION,siteMetadata} from './site';
import {homeMetadata} from './seo';

const PUBLIC=join(import.meta.dirname,'../../public');

test('the wordmark is one inline SVG with an accessible name, theme ink and the red mark',()=>{
 const html=renderToStaticMarkup(createElement(Wordmark,{className:'h-8 w-auto'}));
 assert.doesNotMatch(html,/<img/);
 assert.equal(html.match(/<svg/g)?.length,1);
 assert.match(html,/^<svg viewBox="0 0 628 120" class="h-8 w-auto" role="img" aria-label="有影儀表板"><title>有影儀表板<\/title>/);
 assert.match(html,/fill="currentColor"/);
 assert.match(html,/fill="#ff0000" fill-rule="evenodd"/);
 // Same outlines as the published light wordmark, only the text ink differs.
 const file=readFileSync(join(PUBLIC,'brand/wordmark-light.svg'),'utf8');
 const paths=(svg:string)=>[...svg.matchAll(/ d="([^"]+)"/g)].map(m=>m[1]);
 assert.deepEqual(paths(html),paths(file));
});

test('every icon, share image and manifest icon exists and carries the brand version',()=>{
 const icons=siteMetadata.icons as {icon:{url:string}[];apple:{url:string}[]};
 const og=homeMetadata().openGraph?.images as {url:string}[];
 const urls=[...icons.icon,...icons.apple].map(i=>i.url)
  .concat((siteMetadata.openGraph?.images as {url:string}[]).map(i=>i.url),siteMetadata.twitter?.images as string[],og.map(i=>i.url))
  .concat((manifest().icons??[]).map(i=>i.src));
 assert.ok(urls.length>=10);
 for(const url of urls){
  const [path,query]=url.split('?');
  assert.equal(query,`v=${BRAND_VERSION}`,url);
  assert.ok(existsSync(join(PUBLIC,path)),url);
 }
});
