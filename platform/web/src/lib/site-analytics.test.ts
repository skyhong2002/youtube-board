import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PUBLIC_GA_ID} from './analytics-consent';
import {keywordVideosHref} from './home-presentation';

// Drives SiteAnalytics' effect in a fake browser. The fake gtag.js mirrors what a real one
// was observed to do: it wraps history after loading, and every page_view (initial and
// history) reports the raw browser URL with the previous raw URL as referrer, unless the
// ga-disable kill switch is set when the hit would be sent.
process.env.NEXT_PUBLIC_GA_ID=PUBLIC_GA_ID;
(process.env as Record<string,string>).NODE_ENV='production';
const origin='https://youtube.observe.tw';
const chrome='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
type Hit={location:string;referrer:string};
let instance=0;
async function browser(path:string,{referrer='',hostname='youtube.observe.tw'}:{referrer?:string;hostname?:string}={}){
 let url=new URL(path,origin.replace('youtube.observe.tw',hostname));
 const listeners:Record<string,Array<(event:unknown)=>void>>={};
 const add=(type:string,fn:(event:unknown)=>void)=>void (listeners[type]??=[]).push(fn);
 const remove=(type:string,fn:(event:unknown)=>void)=>{listeners[type]=(listeners[type]??[]).filter(f=>f!==fn);};
 const dispatch=(type:string,event:unknown={})=>{for(const fn of [...(listeners[type]??[])])fn(event);};
 const hits:Hit[]=[],scripts:string[]=[];
 const setUrl=(next?:string|URL|null)=>{if(next!=null)url=new URL(String(next),url);};
 const win:Record<string,unknown>&{dataLayer?:unknown[]}={
  location:{get href(){return url.href;},get pathname(){return url.pathname;},get search(){return url.search;},get hash(){return url.hash;},get hostname(){return url.hostname;},get origin(){return url.origin;}},
  history:{pushState:(_d:unknown,_u:string,next?:string|URL|null)=>setUrl(next),replaceState:(_d:unknown,_u:string,next?:string|URL|null)=>setUrl(next)},
  localStorage:{getItem:()=>null,setItem(){},removeItem(){}},
  addEventListener:add,removeEventListener:remove,
 };
 const disabled=()=>win[`ga-disable-${PUBLIC_GA_ID}`]===true;
 let previous=url.href;
 const hit=()=>{if(url.href===previous)return;if(!disabled())hits.push({location:url.href,referrer:previous});previous=url.href;};
 const loadGtag=()=>{
  if(!disabled())hits.push({location:url.href,referrer});
  const history=win.history as Record<'pushState'|'replaceState',(...args:unknown[])=>void>;
  for(const method of ['pushState','replaceState'] as const){const original=history[method];history[method]=(...args)=>{original(...args);hit();};}
  add('popstate',hit);
 };
 const documentListeners:Record<string,Array<(event:unknown)=>void>>={};
 Object.assign(globalThis,{window:win,document:{
  referrer,
  createElement:()=>({}),
  head:{appendChild:(script:{src:string})=>void scripts.push(script.src)},
  addEventListener:(type:string,fn:(event:unknown)=>void)=>void (documentListeners[type]??=[]).push(fn),
  removeEventListener:(type:string,fn:(event:unknown)=>void)=>{documentListeners[type]=(documentListeners[type]??[]).filter(f=>f!==fn);},
 }});
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{userAgent:chrome,webdriver:false,doNotTrack:null}});
 // A fresh module instance per document, as after a full page load.
 const {syncAnalytics}=await import(`../components/SiteAnalytics.tsx?document=${++instance}`) as typeof import('../components/SiteAnalytics');
 const history=()=>win.history as {pushState:(d:unknown,u:string,next:string)=>void};
 const page={
  hits,scripts,win,disabled,listeners,documentListeners,
  hydrate(){syncAnalytics();if(scripts.length&&!(win as {gtagLoaded?:boolean}).gtagLoaded){(win as {gtagLoaded?:boolean}).gtagLoaded=true;loadGtag();}},
  push(next:string){history().pushState(null,'',next);syncAnalytics();},
  pop(next:string){url=new URL(next,url);dispatch('popstate');syncAnalytics();},
  fragment(hash:string){url=new URL(hash,url);dispatch('popstate');dispatch('hashchange');},
  click(target:unknown){for(const fn of [...(documentListeners.click??[])])fn({target});},
 };
 return page;
}
const commands=(win:{dataLayer?:unknown[]})=>(win.dataLayer??[]).map(args=>Array.from(args as ArrayLike<unknown>));
const configOf=(win:{dataLayer?:unknown[]})=>commands(win).filter(args=>args[0]==='config');

test('a measured landing page loads gtag once, with Google signals and ad personalization off',async()=>{
 const page=await browser('/videos',{referrer:'https://www.google.com/search?q=secret'});
 page.hydrate();
 assert.deepEqual(page.scripts,[`https://www.googletagmanager.com/gtag/js?id=${PUBLIC_GA_ID}`]);
 assert.deepEqual(configOf(page.win),[['config',PUBLIC_GA_ID,{allow_google_signals:false,allow_ad_personalization_signals:false}]]);
 const set=commands(page.win).find(args=>args[0]==='set');
 assert.deepEqual(set?.[1],{page_title:'有影儀表板',page_location:origin+'/videos',page_referrer:'https://www.google.com/'});
 page.push('/channels');page.push('/keywords');
 assert.deepEqual(page.hits.slice(1),[{location:origin+'/channels',referrer:origin+'/videos'},{location:origin+'/keywords',referrer:origin+'/channels'}]);
});
test('the first move to a free-text, query, private or fragment URL stops GA for the whole document',async()=>{
 for(const leave of ['/keywords/%E7%A7%98%E5%AF%86/videos','/videos?q=secret','/my/settings','/unknown','/groups/secret','#token=abc']){
  const page=await browser('/keywords');page.hydrate();
  assert.equal(page.hits.length,1,leave);
  if(leave.startsWith('#'))page.fragment(leave);else page.push(leave);
  assert.ok(page.disabled(),leave);
  // Returning to public pages never resumes: the next history hit's referrer would be `leave`.
  page.push('/videos');page.pop('/keywords');page.push('/channels');page.fragment('#x');
  assert.equal(page.hits.length,1,leave);
  for(const type of ['popstate','hashchange','storage','appinstalled'])assert.equal(page.listeners[type]?.some(fn=>fn.name!=='hit')??false,false,leave+' '+type);
  assert.equal(page.documentListeners.click?.length??0,0,leave);
  assert.doesNotMatch(JSON.stringify([page.hits,page.win.dataLayer]),/secret|%E7|token|my\/settings|unknown/,leave);
 }
});
test('back/forward to an unmeasured URL stops GA before gtag reports it',async()=>{
 const page=await browser('/videos');page.hydrate();page.push('/channels');
 page.pop('/keywords/secret/videos');page.pop('/channels');
 assert.deepEqual(page.hits.map(hit=>hit.location),[origin+'/videos',origin+'/channels']);
 assert.ok(page.disabled());
});
test('an unmeasured landing page never loads gtag in that document, even after moving to a public page',async()=>{
 for(const landing of ['/keywords/secret/videos','/my','/videos?q=secret','/search','/events#headlines']){
  const page=await browser(landing);page.hydrate();page.push('/videos');page.push('/channels');page.hydrate();
  assert.deepEqual(page.scripts,[],landing);assert.equal(page.win.dataLayer,undefined,landing);
 }
});
test('a fresh load of a measured page starts only when its same-site referrer was measurable too',async()=>{
 const fresh=await browser('/videos',{referrer:origin+'/channels'});fresh.hydrate();
 assert.equal(fresh.scripts.length,1);
 assert.deepEqual(fresh.hits,[{location:origin+'/videos',referrer:origin+'/channels'}]);
 for(const referrer of [origin+'/keywords/secret/videos',origin+'/my/settings?token=abc',origin+'/videos?q=secret']){
  const page=await browser('/videos',{referrer});page.hydrate();
  assert.deepEqual(page.scripts,[],referrer);
 }
 const external=await browser('/videos',{referrer:'https://news.example.com/'});external.hydrate();
 assert.equal(external.scripts.length,1);
});
test('genuine hostname checks still block every other host',async()=>{
 for(const hostname of ['localhost','www.youtube.observe.tw','skyhong-sm.tailf76d1d.ts.net']){
  const page=await browser('/videos',{hostname});page.hydrate();
  assert.deepEqual(page.scripts,[],hostname);
 }
});
// Minimal DOM nodes with the real per-namespace `href` shapes: an HTML <a> reflects the
// resolved URL string, an SVG <a> an SVGAnimatedString; both keep the raw attribute.
type Node={tag:string;parent:Node|null;attributes:Record<string,string>;href?:unknown;closest(selector:string):Node|null;getAttribute(name:string):string|null};
function node(tag:string,parent:Node|null=null,attributes:Record<string,string>={},href?:unknown):Node{
 return {tag,parent,attributes,href,
  closest(selector){assert.equal(selector,'a[href]');for(let n:Node|null=this;n;n=n.parent)if(n.tag==='a'&&'href' in n.attributes)return n;return null;},
  getAttribute(name){return this.attributes[name]??null;}};
}
const htmlAnchor=(raw:string)=>node('a',null,{href:raw},new URL(raw,origin+'/').href);
const svgAnchor=(raw:string)=>node('a',node('svg'),{href:raw},{baseVal:raw,animVal:raw});
const events=(win:{dataLayer?:unknown[]})=>commands(win).filter(args=>args[0]==='event');
test('a click on a keyword-cloud word (text inside an SVG <a>) sends select_content without the term',async()=>{
 const page=await browser('/');page.hydrate();
 page.click(node('text',svgAnchor(keywordVideosHref('秘密',{from:'2026-10-04T16:00:00.000Z',to:'2026-10-11T15:59:59.000Z'}))));
 assert.deepEqual(events(page.win),[['event','select_content',{content_type:'keyword',source_page_type:'home'}]]);
 assert.doesNotMatch(JSON.stringify(page.win.dataLayer),/秘密|%E7%A7%98|from=/);
});
test('HTML link clicks still send their events, and non-link clicks send none',async()=>{
 const page=await browser('/videos');page.hydrate();
 page.click(node('span',htmlAnchor('/channels/123')));
 page.click(htmlAnchor('https://www.youtube.com/watch?v=abcdefghijk'));
 page.click(htmlAnchor('/feeds/videos.xml'));
 page.click(node('a'));page.click(node('div'));page.click(null);
 assert.deepEqual(events(page.win),[
  ['event','select_content',{content_type:'channel',content_id:'123',source_page_type:'videos'}],
  ['event','open_original',{link_domain:'www.youtube.com',source_page_type:'videos'}],
  ['event','rss_click',{source_page_type:'videos'}],
 ]);
});
