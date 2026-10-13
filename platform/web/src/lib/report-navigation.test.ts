import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {eventTabs,familyTabs,reportHref,wallVariantTabs} from './report-navigation';
const query=(href:string)=>Object.fromEntries(new URL(href,'http://local').searchParams);
test('report transition matrix preserves only compatible destination scope',()=>{
 const selection={from:'2026-10-01',to:'2026-10-11',tagid:'1',or:'2,3',not:'4',q:'交通',column:'viewCount',type:'tags_video',days:'30',hours:'72',mode:'orig',limit:'1000',offset:'50'};
 const cases:[string,string,Record<string,string>][]=[
 ['/channels/8/trends','/channels/8/videos',{tagid:'1',or:'2,3',not:'4',from:'2026-10-01',to:'2026-10-11',q:'交通'}],
 ['/keywords/交通/videos','/keywords/交通/days',{tagid:'1',or:'2,3',not:'4',from:'2026-10-01',to:'2026-10-11'}],
 ['/live/current','/live/hours',{tagid:'1',or:'2,3',not:'4',from:'2026-10-01',to:'2026-10-11',q:'交通'}],
 ['/live/days','/live/current',{tagid:'1',or:'2,3',not:'4',q:'交通'}],
 ['/ai/periods','/ai/hours',{date:'2026-10-11'}],
 ];
 for(const[source,target,want]of cases)assert.deepEqual(query(reportHref(target,selection,source)),want,source+' → '+target);
 assert.deepEqual(query(reportHref('/ai/periods',{date:'2026-10-11',condition:'blue',type:'oneday'},'/ai/days')),{condition:'blue',from:'2026-10-11',to:'2026-10-11'});
 assert.deepEqual(query(reportHref('/channels/8/trends',selection)),{from:'2026-10-01',to:'2026-10-11',mode:'orig',days:'30'});
});
test('keyword and taxonomy lists expose sibling reports and comparison retains exact selection',()=>{
 const keyword='/keywords/'+encodeURIComponent('交通%41'),tabs=familyTabs(keyword+'/videos',{from:'2026-10-01',to:'2026-10-11',days:'7',type:'unsupported'});
 assert.ok(tabs.some(t=>t.href.startsWith(keyword+'/days?')));assert.ok(tabs.some(t=>t.href.startsWith(keyword+'/groups/trends?')));
 assert.deepEqual(query(tabs.find(t=>t.label==='詞彙比較')!.href),{from:'2026-10-01',to:'2026-10-11',tags:'交通%41'});
 const taxonomy=familyTabs('/tags/102/channels',{tagid:'53',or:'1,13'});assert.ok(taxonomy.some(t=>t.href.startsWith('/tags/102/videos')));
 assert.deepEqual(query(taxonomy.find(t=>t.label==='詞彙比較')!.href),{tagid:'102,53',or:'1,13'});
});
test('daily event tabs keep mandatory titles and pinned event tabs keep primary-key semantics',()=>{
 const title='交通 & 名稱%',tabs=eventTabs('/ai/days/45/events',{event:title});
 assert.equal(tabs[0]?.href,'/ai/days/45/events?'+new URLSearchParams({event:title}));
 for(const tab of tabs)assert.equal(query(tab.href).event,title);
 for(const suffix of ['people','wall','history'])assert.equal(eventTabs('/ai/events/45/'+suffix,{event:title})[0]?.href,tabs[0]?.href);
 const pinned=eventTabs('/ai/events/999',{});assert.equal(pinned[0]?.href,'/ai/events/999');assert.equal(pinned[1]?.href,'/ai/events/999/history');assert.equal(pinned[2]?.href,'/ai/events/999/people');
});
test('navigation advertises only supported group reports and supplies prompt/wall entry points',()=>{
 assert.deepEqual(familyTabs('/groups/tags_economy').map(t=>t.href),['/groups/tags_economy']);
 assert.ok(familyTabs('/groups/position').some(t=>t.href==='/groups/position/trends'));
 assert.equal(familyTabs('/ai/days/2026-10-11/blue').find(t=>t.label==='提示詞預覽')?.href,'/ai/days/prompt?date=2026-10-11&condition=blue');
 assert.ok(familyTabs('/live/current').some(t=>t.href==='/live/walls/news'));
 assert.deepEqual(wallVariantTabs().map(t=>t.href),['/live/walls/news','/live/walls/china','/live/walls/alternate']);
});
test('prompt scope is one day; aliases and pinned source-record tabs preserve their identity',async()=>{
 const {currentTab}=await import('./report-navigation');
 assert.equal(reportHref('/channels/8/prompt',{from:'2026-10-01',to:'2026-10-11',type:'week'},'/channels/8/trends'),'/channels/8/prompt?date=2026-10-11');
 assert.equal(reportHref('/channels/8/ai/days',{pk:'77'}),'/channels/8/ai/days?pk=77');
 assert.equal(currentTab('/ai/days?date=2026-10-11&condition=blue','/ai/days/2026-10-11/blue'),true);
 assert.equal(currentTab('/ai/days/prompt?date=2026-10-11','/ai/days/2026-10-11/prompt'),true);
 assert.ok(familyTabs('/live/days/2026-10-11').some(t=>t.href==='/live/hours?from=2026-10-11&to=2026-10-11'));
 assert.doesNotThrow(()=>familyTabs('/keywords/100%/videos'));
 assert.equal(query(familyTabs('/keywords/100%25/videos').find(t=>t.label==='詞彙比較')!.href).tags,'100%');
});
test('every generated tab is a supported public report route',async()=>{
 const {resolveRoute}=await import('./routes');
 for(const path of ['/channels/8','/channels/8/ai/days','/tags','/tags/102/channels','/tags/compare','/keywords/'+encodeURIComponent('交通%41')+'/videos','/groups/tags_economy','/groups/position','/live/current','/ai/days/2026-10-11/blue','/ai/days/45/events','/ai/events/999/people']){
  const tabs=familyTabs(path,path.includes('/45/')?{event:'事件'}:{});
  // /events and /compare/titles are dedicated app pages outside the report catch-all.
  for(const tab of tabs){const pathname=new URL(tab.href,'http://local').pathname;if(['/events','/compare/titles'].includes(pathname))continue;assert.ok(resolveRoute(pathname.split('/').filter(Boolean).map(decodeURIComponent)),tab.href);}
 }
});

test('channel overview always escapes the legacy daily alias and whitespace event follows API semantics',()=>{
 assert.equal(familyTabs('/channels/8/ai/days/2026-10-11').find(t=>t.label==='AI 議題')?.href,'/channels/8/ai');
 assert.equal(reportHref('/channels/8/ai',{to:'2026-10-11'},'/channels/8/trends'),'/channels/8/ai');
 assert.equal(reportHref('/channels/8/ai',{date:'2026-10-11',days:'7',type:'oneday'}),'/channels/8/ai');
 assert.deepEqual(eventTabs('/ai/events/45',{event:' '}),eventTabs('/ai/events/45',{}));
});

test('API navigation flags override same-path matching without changing family tabs', async () => {
 const {currentTab}=await import('./report-navigation');
 const path='/keywords/'+encodeURIComponent('AI & 臺灣%41')+'/live/trends';
 assert.equal(currentTab(path+'?group=media',path,false),false);
 assert.equal(currentTab(path+'?group=position&type=tags_video',path,true),true);
 assert.equal(currentTab('/live/days?date=2026-10-10','/live/days',false),false);
 assert.equal(currentTab('/live/days?date=2026-10-11','/live/days/2026-10-11'),true);
});

test('taxonomy group live tab targets the hourly taxonomy report, not the content tag-set route',async()=>{
 const {resolveRoute}=await import('./routes');
 for(const id of ['media','position']){
  const tabs=familyTabs('/groups/'+id),live=tabs.find(t=>t.label==='每小時直播');
  assert.equal(live?.href,`/live/groups/${id}/hours`);
  assert.ok(!tabs.some(t=>new URL(t.href,'http://local').pathname===`/groups/${id}/live`));
  assert.ok(resolveRoute(['live','groups',id,'hours']));
 }
 assert.ok(!familyTabs('/groups/tags_economy').some(t=>t.href.includes('/hours')));
 // The content route stays resolvable for direct links and keeps its own period scope.
 assert.ok(resolveRoute(['groups','media','live']));
 assert.equal(reportHref('/groups/media/live',{from:'2026-10-01',to:'2026-10-11',view:'media',type:'tags_views'},'/groups/media/trends'),'/groups/media/live?from=2026-10-01&to=2026-10-11');
});
test('hourly taxonomy destination carries only a date and drops ranking/trend selectors',()=>{
 const selection={from:'2026-10-01',to:'2026-10-11',days:'30',type:'tags_video',view:'media',group:'media',tagid:'1',q:'交通',today:'1',diff:'1'};
 for(const source of ['/groups/media','/groups/media/ranking','/groups/media/trends']){
  const href=familyTabs(source,selection).find(t=>t.label==='每小時直播')!.href;
  assert.deepEqual(query(href),{date:'2026-10-11'},source);
  assert.equal(new URL(href,'http://local').pathname,'/live/groups/media/hours');
 }
 assert.deepEqual(query(reportHref('/live/groups/position/hours',{date:'2026-10-09',to:'2026-10-11',type:'count'},'/groups/position/trends')),{date:'2026-10-09'});
 assert.equal(reportHref('/live/groups/media/hours',{days:'7',type:'tags_views'},'/groups/media/ranking'),'/live/groups/media/hours');
 assert.equal(reportHref('/live/groups/media/hours',{to:'not-a-date'},'/groups/media'),'/live/groups/media/hours');
 // Same hourly page keeps its own count/views metric only.
 assert.deepEqual(query(reportHref('/live/groups/media/hours',{date:'2026-10-11',type:'count',days:'7',from:'2026-10-01'})),{date:'2026-10-11',type:'count'});
 assert.deepEqual(query(reportHref('/live/groups/media/hours',{date:'2026-10-11',type:'views'})),{date:'2026-10-11',type:'views'});
 assert.deepEqual(query(reportHref('/live/groups/media/hours',{date:'2026-10-11',type:'tags_video'})),{date:'2026-10-11'});
});
