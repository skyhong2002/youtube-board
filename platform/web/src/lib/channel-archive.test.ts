import {strict as assert} from 'node:assert';
import {COMMENTS_PUBLISHED} from './comments-launch';
import {test} from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ChannelArchiveNotice} from '../components/ChannelArchiveNotice';
import {familyTabs} from './report-navigation';
const archived={channelId:8,channelTitle:'歷史來源',channelStatus:'archived',channelProfileAvailable:false};
test('archived channel children retain all historical navigation while unavailable profile links are omitted',()=>{
 const children=['videos',...(COMMENTS_PUBLISHED?['comments']:[]),'cloud','trends','people','ai','ai/days','prompt'];
 for(const child of children){
  const path='/channels/8/'+child,tabs=familyTabs(path,{date:'2026-10-11'},archived);
  assert.equal(tabs.length,children.length);assert.ok(tabs.every(tab=>new URL(tab.href,'http://local').pathname!=='/channels/8'));
  assert.deepEqual(tabs.map(tab=>new URL(tab.href,'http://local').pathname),children.map(suffix=>'/channels/8/'+suffix));
  assert.equal(tabs.find(tab=>tab.label==='提示詞預覽')?.href,'/channels/8/prompt?date=2026-10-11');
 }
});
test('active channels and absent or unrelated coverage never lose the profile tab',()=>{
 for(const coverage of [undefined,{}, {...archived,channelStatus:'active',channelProfileAvailable:true},{...archived,channelId:9}])assert.ok(familyTabs('/channels/8/videos',{},coverage).some(tab=>tab.href==='/channels/8'));
 assert.deepEqual(familyTabs('/live/current',{},archived),familyTabs('/live/current'));
});
test('archive notice describes retained local records, escapes source names and does not imply live status',()=>{
 const html=renderToStaticMarkup(createElement(ChannelArchiveNotice,{coverage:{...archived,channelTitle:'<script>來源</script>'}}));
 assert.match(html,/封存頻道資料/);assert.match(html,/頻道紀錄已封存/);assert.match(html,/歷史觀測與分析/);assert.match(html,/目前不提供頻道概覽/);assert.match(html,/&lt;script&gt;來源&lt;\/script&gt;/);assert.doesNotMatch(html,/<script>/);
 assert.match(renderToStaticMarkup(createElement(ChannelArchiveNotice,{coverage:{...archived,channelTitle:''}})),/頻道 #8/);
 for(const coverage of [{},{...archived,channelStatus:'active'},{...archived,channelId:0}])assert.equal(renderToStaticMarkup(createElement(ChannelArchiveNotice,{coverage})), '');
});
