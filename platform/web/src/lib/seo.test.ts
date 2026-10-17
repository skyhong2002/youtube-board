import assert from 'node:assert/strict';
import {test} from 'node:test';
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import type {VideoRow} from '../../../api/src/contracts';
import robots from '../app/robots';
import {resolveRoute} from './routes';
import {SITE_ORIGIN} from './site';
import {absoluteUrl,apiDocsMetadata,apiStatusMetadata,breadcrumbJsonLd,eventBreadcrumbs,eventMetadata,filteredEventsMetadata,filteredMetadata,filteredReportMetadata,homeJsonLd,homeMetadata,isoDuration,pageMetadata,privateMetadata,reportBreadcrumbs,reportCanonicalPath,reportMetadata,reportTitle,serializeJsonLd,videoJsonLd} from './seo';

const source=(file:string)=>{for(const root of [process.cwd(),join(process.cwd(),'web'),join(process.cwd(),'platform/web')]){const path=join(root,file);if(existsSync(path))return readFileSync(path,'utf8');}throw new Error('missing '+file);};
const route=(path:string)=>{const segments=path.slice(1).split('/').map(decodeURIComponent),value=resolveRoute(segments);assert.ok(value,path);return {route:value,segments};};
const video:VideoRow={id:'dQw4w9WgXcQ',channelId:7,youtubeChannelId:'UC123',channelTitle:'測試頻道',title:'影片標題',description:'影片說明',thumbnail:'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',publishedAt:'2026-10-01T02:03:04Z',views:1,likes:1,comments:1,updatedAt:null,youtubeUrl:'https://www.youtube.com/watch?v=dQw4w9WgXcQ'};

test('canonical URLs use the bare https origin with no trailing slash or doubled separator',()=>{
 assert.equal(SITE_ORIGIN,'https://youtube.observe.tw');
 assert.equal(absoluteUrl('/'),'https://youtube.observe.tw');assert.equal(absoluteUrl('/videos'),'https://youtube.observe.tw/videos');
 const home=homeMetadata();assert.equal(home.alternates?.canonical,'https://youtube.observe.tw');assert.deepEqual(home.title,{absolute:'有影儀表板｜YouTube 頻道、影片與直播觀測'});
 const page=pageMetadata({title:'資料與方法',description:'說明',path:'/about'});
 assert.equal(page.alternates?.canonical,'https://youtube.observe.tw/about');assert.ok(page.alternates?.types,'RSS alternate survives the override');
 const og=page.openGraph as unknown as {url:string;title:string;images:unknown[]},twitter=page.twitter as unknown as {title:string};
 assert.equal(og.url,'https://youtube.observe.tw/about');assert.equal(og.title,'資料與方法 - 有影儀表板');
 assert.equal(twitter.title,'資料與方法 - 有影儀表板');assert.ok(og.images.length);
 assert.equal(page.robots,undefined);
});
test('private pages are noindex; query variants are noindex and canonical to the query-free page',()=>{
 assert.deepEqual(privateMetadata('登入').robots,{index:false,follow:false});
 const videos=filteredMetadata('影片','/videos');assert.deepEqual(videos.robots,{index:false,follow:true});assert.equal(videos.alternates?.canonical,'https://youtube.observe.tw/videos');
 const events=filteredEventsMetadata();assert.deepEqual(events.robots,{index:false,follow:true});assert.equal(events.alternates?.canonical,'https://youtube.observe.tw/events');
 // Same decoded segments as the canonical page, so the filtered canonical matches it byte for byte.
 for(const path of ['/keywords/%E4%BA%A4%E9%80%9A/videos','/keywords/%2541/videos','/vocabulary','/tags/8/videos']){
  const {route:value,segments}=route(path),filtered=filteredReportMetadata(value,segments);
  assert.deepEqual(filtered.robots,{index:false,follow:true},path);assert.equal(filtered.alternates?.canonical,absoluteUrl(reportCanonicalPath(segments)),path);
  assert.equal(filtered.alternates?.canonical,reportMetadata(value,segments).alternates?.canonical,path);assert.doesNotMatch(String(filtered.alternates?.canonical),/\?/,path);
 }
 assert.equal(filteredReportMetadata(route('/vocabulary').route,['vocabulary']).alternates?.canonical,'https://youtube.observe.tw/vocabulary');
 assert.equal(filteredReportMetadata(route('/keywords').route,['keywords']).alternates?.canonical,'https://youtube.observe.tw/keywords');
 for(const file of ['src/app/my/layout.tsx','src/app/login/page.tsx','src/app/admin/page.tsx','src/app/boards/page.tsx','src/app/boards/view/page.tsx','src/app/ops/ingestion/page.tsx','src/app/observe/opt-out/page.tsx'])
  assert.match(source(file),/index:false|privateMetadata\(/,file);
 assert.match(source('src/app/events/page.tsx'),/metadata=filteredEventsMetadata\(\)/);
 assert.match(source('src/app/render-filtered/report/[...segments]/page.tsx'),/filteredReportMetadata\(route, segments\)/);
});
test('/api and /api/status each carry their own canonical; status stays out of the index',()=>{
 const api=apiDocsMetadata();assert.equal(api.alternates?.canonical,'https://youtube.observe.tw/api');assert.equal(api.robots,undefined);
 const status=apiStatusMetadata();assert.equal(status.alternates?.canonical,'https://youtube.observe.tw/api/status');assert.deepEqual(status.robots,{index:false,follow:true});
 assert.match(source('src/app/api/page.tsx'),/metadata = apiDocsMetadata\(\)/);assert.match(source('src/app/api/status/page.tsx'),/metadata = apiStatusMetadata\(\)/);
});
test('report titles are descriptive and unique per public path; names come only from subject data',()=>{
 const paths=['/videos','/channels','/channels/12','/channels/12/videos','/channels/12/comments','/channels/12/ai/days/2026-10-01','/videos/dQw4w9WgXcQ','/videos/dQw4w9WgXcQ/analytics','/keywords','/keywords/%E4%BA%A4%E9%80%9A/videos','/keywords/%E4%BA%A4%E9%80%9A/cloud','/tags','/tags/3/videos','/tags/3/channels','/tags/compare','/live/current','/live/hours','/live/days/2026-10-01','/live/walls/news','/ai/days','/ai/days/2026-10-01','/ai/hours','/ai/events/77','/ai/events/77/wall','/groups','/mayor'];
 const titles=paths.map(path=>{const {route:value,segments}=route(path);return reportTitle(value,segments);});
 assert.equal(new Set(titles).size,titles.length,titles.join('\n'));
 const channel=route('/channels/12');assert.equal(reportTitle(channel.route,channel.segments,{kind:'channel',title:'某新聞台'}),'某新聞台｜頻道觀測');
 const watch=route('/videos/dQw4w9WgXcQ');assert.equal(reportTitle(watch.route,watch.segments,{kind:'video',video,durationSeconds:null}),'影片標題｜影片觀測');
 const keyword=route('/keywords/%E4%BA%A4%E9%80%9A/videos');assert.equal(reportTitle(keyword.route,keyword.segments),'「交通」影片');
});
test('report metadata canonicalizes aliases and keeps prompt and comment-author pages out of the index',()=>{
 const vocab=route('/vocabulary');assert.equal(reportCanonicalPath(vocab.segments),'/vocabulary');assert.equal(reportMetadata(vocab.route,vocab.segments).alternates?.canonical,'https://youtube.observe.tw/vocabulary');
 const ranking=route('/keywords');assert.equal(ranking.route.kind,'keyword-ranking');assert.equal(reportMetadata(ranking.route,ranking.segments).alternates?.canonical,'https://youtube.observe.tw/keywords');
 const vocabCrumbs=reportBreadcrumbs(vocab.route,vocab.segments);assert.deepEqual(vocabCrumbs.map(c=>c.path),['/','/vocabulary']);assert.equal(vocabCrumbs[1]!.name,'詞彙觀測');assert.ok(vocabCrumbs.every(c=>c.path!=='/keywords'));
 assert.deepEqual(reportBreadcrumbs(ranking.route,ranking.segments).map(c=>c.path),['/','/keywords']);
 const encoded=route('/keywords/%E4%BA%A4%E9%80%9A/videos');assert.equal(reportMetadata(encoded.route,encoded.segments).alternates?.canonical,'https://youtube.observe.tw/keywords/%E4%BA%A4%E9%80%9A/videos');
 for(const path of ['/channels/12/prompt','/comments/authors/someone']){const {route:value,segments}=route(path);const metadata=reportMetadata(value,segments);assert.deepEqual(metadata.robots,{index:false,follow:true},path);assert.equal(metadata.alternates?.canonical,absoluteUrl(path),path);}
 const crumbs=reportBreadcrumbs(route('/channels/12/videos').route,route('/channels/12/videos').segments,{kind:'channel',title:'某新聞台'});
 assert.deepEqual(crumbs.map(c=>c.path),['/','/channels','/channels/12','/channels/12/videos']);assert.equal(crumbs[2]!.name,'某新聞台｜頻道觀測');
 assert.deepEqual(reportBreadcrumbs(route('/channels').route,['channels']).map(c=>c.path),['/','/channels']);
});
test('event detail metadata uses the canonical event and its editorial title',()=>{
 const event={canonicalId:'9b2e3c1a-0000-4000-8000-000000000001',title:'颱風停班停課',sourceCount:4};
 const metadata=eventMetadata(event);assert.equal(metadata.title,'颱風停班停課｜事件來源與時間軸');assert.equal(metadata.alternates?.canonical,`https://youtube.observe.tw/events/${event.canonicalId}`);assert.match(String(metadata.description),/4 個來源/);
 assert.deepEqual(eventBreadcrumbs(event).map(c=>c.path),['/','/events',`/events/${event.canonicalId}`]);
});
test('JSON-LD: WebSite SearchAction targets the real header search, breadcrumbs are absolute, VideoObject requires complete source data',()=>{
 const home=homeJsonLd(),[site,org]=home['@graph'] as unknown as [Record<string,unknown>,Record<string,unknown>];
 assert.equal(site['@type'],'WebSite');assert.equal(org['@type'],'Organization');
 assert.equal((site.potentialAction as {target:{urlTemplate:string}}).target.urlTemplate,'https://youtube.observe.tw/videos?q={search_term_string}');
 assert.match(source('src/components/SiteSearch.tsx'),/action="\/videos"[\s\S]*name="q"/);
 assert.deepEqual(breadcrumbJsonLd([{name:'有影儀表板',path:'/'},{name:'影片觀測',path:'/videos'}]).itemListElement,[{'@type':'ListItem',position:1,name:'有影儀表板',item:'https://youtube.observe.tw'},{'@type':'ListItem',position:2,name:'影片觀測',item:'https://youtube.observe.tw/videos'}]);
 const full=videoJsonLd(video,754);assert.deepEqual(full,{'@context':'https://schema.org','@type':'VideoObject',name:'影片標題',description:'影片說明',thumbnailUrl:['https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg'],uploadDate:'2026-10-01T02:03:04.000Z',duration:'PT12M34S',url:'https://www.youtube.com/watch?v=dQw4w9WgXcQ'});
 assert.equal('duration' in videoJsonLd(video,null)!,false);
 for(const change of [{title:''},{description:'  '},{thumbnail:null},{thumbnail:'http://i.ytimg.com/vi/x/hq.jpg'},{thumbnail:'https://legacy.example/x.jpg'},{thumbnail:'/media/thumb.jpg'},{publishedAt:null},{publishedAt:'not a date'}])
  assert.equal(videoJsonLd({...video,...change} as VideoRow,754),null,JSON.stringify(change));
 assert.equal(isoDuration(3600),'PT1H');assert.equal(isoDuration(59),'PT59S');assert.equal(isoDuration(0),null);assert.equal(isoDuration(1.5),null);
});
test('JSON-LD serialization cannot close the script element or start markup',()=>{
 const separators=String.fromCharCode(0x2028,0x2029),payload='</script><script>alert(1)</script>&amp;<!--'+separators;
 const json=serializeJsonLd({name:payload});
 assert.doesNotMatch(json,new RegExp('[<>&'+separators+']'));assert.deepEqual(JSON.parse(json),{name:payload});
 const component=source('src/components/JsonLd.tsx');assert.match(component,/type="application\/ld\+json"/);assert.match(component,/__html: serializeJsonLd\(data\)/);
});
test('public ISR entries keep request-free rendering and true 404s',()=>{
 for(const file of ['src/app/[...segments]/page.tsx','src/app/events/[id]/page.tsx','src/app/render-isr/home/[edition]/page.tsx','src/app/render-isr/events/[edition]/page.tsx','src/app/layout.tsx']){
  const code=source(file);assert.doesNotMatch(code,/cookies\(|headers\(|searchParams/,file);
 }
 assert.match(source('src/app/[...segments]/page.tsx'),/notFound\(\)/);assert.match(source('src/app/events/[id]/page.tsx'),/notFound\(\)/);
 // generateMetadata switches to the revalidated cache before any data read.
 assert.match(source('src/app/[...segments]/page.tsx'),/generateMetadata[\s\S]*enablePublicRevalidation\(\);[\s\S]*reportSubject/);
});
test('robots names the sitemap and keeps private and search URLs out',()=>{
 const metadata=robots(),rule=metadata.rules as {disallow:string[]};
 assert.equal(metadata.sitemap,'https://youtube.observe.tw/sitemap.xml');
 for(const path of ['/my','/admin','/manage','/ops','/login','/auth','/boards','/feeds/u/','/search','/*?q=','/*&q='])assert.ok(rule.disallow.includes(path),path);
 assert.ok(!rule.disallow.some(path=>path.startsWith('/observe')),'opt-out stays crawlable so its noindex is seen');
});
