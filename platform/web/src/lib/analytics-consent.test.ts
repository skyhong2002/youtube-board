import assert from 'node:assert/strict';
import {test} from 'node:test';
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {ANALYTICS_PAGE_TITLE,PUBLIC_GA_ID,OPT_OUT_STORAGE_KEY,analyticsBlockReason,analyticsLinkEvent,analyticsPage,analyticsPageType,analyticsReferrer,analyticsReferrerAllowsStart,isAutomationAgent,readOptOut,resolveMeasurementId,writeOptOut,type AnalyticsEnvironment} from './analytics-consent';

const chrome='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const allowed:AnalyticsEnvironment={measurementId:PUBLIC_GA_ID,nodeEnv:'production',hostname:'youtube.observe.tw',webdriver:false,userAgent:chrome,doNotTrack:[null,undefined,'unspecified'],globalPrivacyControl:false,optedOut:false};
const memory=(initial:Record<string,string>={})=>{const values=new Map(Object.entries(initial));return {getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>void values.set(key,value),removeItem:(key:string)=>void values.delete(key)};};
const base='https://youtube.observe.tw/videos';
const source=(file:string)=>{for(const root of [process.cwd(),join(process.cwd(),'web'),join(process.cwd(),'platform/web')]){const path=join(root,file);if(existsSync(path))return readFileSync(path,'utf8');}throw new Error('missing '+file);};

test('GA is off unless a valid measurement ID is configured explicitly',()=>{
 assert.equal(resolveMeasurementId(undefined),null);
 assert.equal(resolveMeasurementId(PUBLIC_GA_ID),'G-X2G1PLNP7K');
 assert.equal(resolveMeasurementId('G-ABCDEF1234'),'G-ABCDEF1234');
 for(const value of ['',' ','UA-1234-1','G-<script>','G-abc def'])assert.equal(resolveMeasurementId(value),null,value);
});
test('gtag may load only in production on youtube.observe.tw for a human browser without privacy signals or opt-out',()=>{
 assert.equal(analyticsBlockReason(allowed),null);
 const cases:Array<[Partial<AnalyticsEnvironment>,string]>=[
  [{measurementId:null},'unconfigured'],[{nodeEnv:'development'},'environment'],[{nodeEnv:'test'},'environment'],
  [{hostname:'localhost'},'hostname'],[{hostname:'skyhong-sm.tailf76d1d.ts.net'},'hostname'],[{hostname:'www.youtube.observe.tw'},'hostname'],
  [{webdriver:true},'automation'],[{userAgent:chrome.replace('Chrome/','HeadlessChrome/')},'automation'],[{userAgent:'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'},'automation'],[{userAgent:''},'automation'],
  [{doNotTrack:['1']},'do-not-track'],[{doNotTrack:[null,'1']},'do-not-track'],[{doNotTrack:[undefined,undefined,'yes']},'do-not-track'],
  [{globalPrivacyControl:true},'global-privacy-control'],[{optedOut:true},'opted-out'],
 ];
 for(const [change,reason] of cases)assert.equal(analyticsBlockReason({...allowed,...change}),reason,JSON.stringify(change));
 for(const agent of ['Playwright/1.50','Mozilla/5.0 Chrome-Lighthouse','Mozilla/5.0 (compatible; bingbot/2.0)','Selenium','Mozilla/5.0 Google-InspectionTool/1.0'])assert.ok(isAutomationAgent(agent),agent);
 assert.ok(!isAutomationAgent('Mozilla/5.0 (Linux; Android 13; Cubot KingKong) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36'));
});
test('opt-out is stored per browser, and unreadable storage blocks rather than guesses',()=>{
 const storage=memory();assert.equal(readOptOut(storage),false);
 assert.ok(writeOptOut(storage,true));assert.equal(storage.getItem(OPT_OUT_STORAGE_KEY),'1');assert.equal(readOptOut(storage),true);
 assert.ok(writeOptOut(storage,false));assert.equal(readOptOut(storage),false);
 assert.equal(readOptOut(null),true);
 const broken={getItem:()=>{throw new Error('denied');},setItem:()=>{throw new Error('denied');},removeItem:()=>{throw new Error('denied');}};
 assert.equal(readOptOut(broken),true);assert.equal(writeOptOut(broken,true),false);assert.equal(writeOptOut(null,true),false);
});
test('private, auth, search, unknown, query and fragment pages are never measured',()=>{
 for(const path of ['/my','/my/settings','/manage','/manage/users','/ops/ingestion','/login','/auth/google','/auth/callback','/feeds/u/private-token.xml','/boards','/boards/view','/observe/opt-out','/api/status','/runtime/ready','/search','/unknown','/videos/','/events/123','/channels/12/prompt','/ai/days/2026-10-01/prompt','/comments/authors/someone','/keywords/%E4%ZZ/videos'])assert.equal(analyticsPageType(path),null,path);
 // Any query at all, not just q/keyword, and any fragment.
 for(const [path,search,hash] of [['/videos','?q=%E4%BA%A4%E9%80%9A',''],['/channels','?sort=views',''],['/events','?page=2',''],['/','?utm_source=x',''],['/videos','','#token=abc'],['/about','','#section']])
  assert.equal(analyticsPage({pathname:path,search,hash}),null,path+search+hash);
 const types:Array<[string,string]>=[['/','home'],['/videos','videos'],['/videos/dQw4w9WgXcQ','video'],['/videos/dQw4w9WgXcQ/analytics','video'],['/channels','channels'],['/channels/12/comments','channel'],['/keywords','keywords'],['/vocabulary','keywords'],['/tags','tags'],['/tags/compare','tags'],['/tags/3/videos','tag'],['/events','events'],['/events/9b2e3c1a-0000-4000-8000-000000000001','event'],['/ai/days','ai'],['/live/current','live'],['/groups','groups'],['/mayor','mayor'],['/compare/titles','compare'],['/about/brand','about']];
 for(const [path,type] of types)assert.equal(analyticsPageType(path),type,path);
});
test('routes with any free-text segment are not measured at all, since gtag reports the raw URL',()=>{
 for(const path of ['/keywords/%E7%A7%98%E5%AF%86/videos','/keywords/secret/videos','/keywords/secret/cloud','/keywords/secret/groups/trends','/groups/secret','/groups/secret/ranking','/mayor/cities/%E5%8F%B0%E5%8C%97','/mayor/cities/%E5%8F%B0%E5%8C%97/people/%E7%8E%8B/days/2026-10-01','/ai/days/2026-10-01/secret','/live/groups/secret/hours','/videos/secret','/videos/notavideo-id-x','/live/videos/secret/trend','/%76ideos'])
  assert.equal(analyticsPage({pathname:path,search:'',hash:''}),null,path);
 // Listings and ID-only routes stay measurable, and their location is the raw URL.
 for(const path of ['/','/keywords','/groups','/mayor','/ai/days','/ai/days/2026-10-01','/ai/days/12/events','/channels/12/videos','/channels/12/ai/days/2026-10-01','/videos/dQw4w9WgXcQ/analytics','/live/videos/dQw4w9WgXcQ/trend','/tags/3/videos'])
  assert.equal(analyticsPage({pathname:path,search:'',hash:''})?.location,'https://youtube.observe.tw'+path,path);
});
test('referrer never forwards an external path; an unmeasured same-site referrer blocks the document',()=>{
 assert.equal(analyticsReferrer('https://www.google.com/search?q=secret#frag'),'https://www.google.com/');
 assert.equal(analyticsReferrer('https://mail.example.com/u/0/inbox/user@example.com'),'https://mail.example.com/');
 assert.equal(analyticsReferrer('https://youtube.observe.tw/channels/12'),'https://youtube.observe.tw/channels/12');
 assert.equal(analyticsReferrer('https://youtube.observe.tw/keywords/%E7%A7%98%E5%AF%86/videos'),'https://youtube.observe.tw/');
 assert.equal(analyticsReferrer('https://youtube.observe.tw/my/settings?token=abc'),'https://youtube.observe.tw/');
 for(const value of ['','not a url','android-app://com.example/x'])assert.equal(analyticsReferrer(value),'',value);
 for(const value of ['','not a url','https://www.google.com/search?q=x','https://youtube.observe.tw/','https://youtube.observe.tw/keywords'])assert.ok(analyticsReferrerAllowsStart(value),value);
 for(const value of ['https://youtube.observe.tw/keywords/secret/videos','https://youtube.observe.tw/my/settings','https://youtube.observe.tw/videos?q=x','https://youtube.observe.tw/events#headlines'])assert.ok(!analyticsReferrerAllowsStart(value),value);
 assert.equal(ANALYTICS_PAGE_TITLE,'有影儀表板');
});
test('custom events carry only link domain, fixed content types and channel/video IDs',()=>{
 assert.deepEqual(analyticsLinkEvent('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10',base,'video'),{name:'open_original',params:{link_domain:'www.youtube.com',source_page_type:'video'}});
 assert.deepEqual(analyticsLinkEvent('https://youtu.be/dQw4w9WgXcQ',base,'home'),{name:'open_original',params:{link_domain:'youtu.be',source_page_type:'home'}});
 assert.equal(analyticsLinkEvent('https://example.com/news/1',base,'event'),null);
 assert.equal(analyticsLinkEvent('http://www.youtube.com/watch?v=x',base,'event'),null);
 assert.equal(analyticsLinkEvent('javascript:alert(1)',base,'home'),null);
 assert.deepEqual(analyticsLinkEvent('/channels/42/videos?q=abc',base,'videos'),{name:'select_content',params:{content_type:'channel',content_id:'42',source_page_type:'videos'}});
 assert.deepEqual(analyticsLinkEvent('/videos/dQw4w9WgXcQ',base,'channel'),{name:'select_content',params:{content_type:'video',content_id:'dQw4w9WgXcQ',source_page_type:'channel'}});
 assert.deepEqual(analyticsLinkEvent('/keywords/%E4%BA%A4%E9%80%9A/videos',base,'home'),{name:'select_content',params:{content_type:'keyword',source_page_type:'home'}});
 assert.deepEqual(analyticsLinkEvent('/tags/3/videos',base,'tags'),{name:'select_content',params:{content_type:'tag',source_page_type:'tags'}});
 assert.deepEqual(analyticsLinkEvent('/events/9b2e3c1a-0000-4000-8000-000000000001',base,'events'),{name:'select_content',params:{content_type:'event',source_page_type:'events'}});
 assert.deepEqual(analyticsLinkEvent('/ai/events/77',base,'ai'),{name:'select_content',params:{content_type:'event',source_page_type:'ai'}});
 assert.deepEqual(analyticsLinkEvent('/feeds/videos.xml',base,'home'),{name:'rss_click',params:{source_page_type:'home'}});
 for(const href of ['/feeds/u/secret-token.xml','/my','/auth/google?next=%2Fmy','/videos?q=abc','/events/not-a-uuid','/channels/0'])assert.equal(analyticsLinkEvent(href,base,'home'),null,href);
 // Nothing a reader typed or a source titled can appear in any parameter value.
 const all=['/keywords/%E7%A7%98%E5%AF%86/videos?q=secret','/channels/42?q=secret','https://www.youtube.com/results?search_query=secret'].map(href=>JSON.stringify(analyticsLinkEvent(href,base,'home')));
 for(const json of all)assert.doesNotMatch(json,/secret|秘密|search_query|https?:/);
});
test('SiteAnalytics loads gtag only through the trusted bundle: one config, no inline script, no explicit page_view',()=>{
 const code=source('src/components/SiteAnalytics.tsx');
 assert.equal(code.match(/gtag\('config'/g)?.length,1);
 assert.doesNotMatch(code,/'page_view'|send_page_view|dangerouslySetInnerHTML|\.nonce|nonce[=:]|innerHTML|next\/script/);
 assert.match(code,/document\.createElement\('script'\)/);
 assert.match(code,/https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=/);
 assert.match(code,/process\.env\.NEXT_PUBLIC_GA_ID/);
 assert.doesNotMatch(code,/'login'|auth\/me/,'login is not emitted until the callback issues a one-time success receipt');
 // Fixed title before the config, Google signals off; the history guard runs before the native call.
 assert.match(code,/gtag\('set', \{ page_title: ANALYTICS_PAGE_TITLE, page_location: page\.location, page_referrer: analyticsReferrer\(document\.referrer\) \}\);\s*gtag\('config', id, \{ allow_google_signals: false, allow_ad_personalization_signals: false \}\);/);
 assert.match(code,/prepare\(new URL\(url, window\.location\.href\)\);[\s\S]*return original\.call\(this, data, unused, url\);/);
 assert.match(code,/addEventListener\('popstate', onUrlChange, true\);\s*window\.addEventListener\('hashchange', onUrlChange, true\)[\s\S]*document\.createElement\('script'\)/);
 assert.match(code,/if \(!page\) \{ stop\(\); return; \}/,'an unmeasured URL stops GA rather than pausing it');
 assert.doesNotMatch(code,/document\.title|location\.search|location\.hash/);
 const layout=source('src/app/layout.tsx');assert.match(layout,/<SiteAnalytics \/>/);assert.doesNotMatch(layout,/cookies\(|headers\(/);
});
