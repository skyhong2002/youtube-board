import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {isReportPath,reportFamilyIndex} from './report-family-index';

test('a failed report links back to its family listing', () => {
 assert.deepEqual(reportFamilyIndex('/channels/70/videos'),{href:'/channels',label:'頻道觀測'});
 assert.deepEqual(reportFamilyIndex('/live/hours'),{href:'/live/current',label:'即時直播觀測'});
 assert.deepEqual(reportFamilyIndex('/ai/days/2026-11-10'),{href:'/ai/days',label:'每日公共議題'});
 assert.deepEqual(reportFamilyIndex('/mayor/cities/taipei'),{href:'/mayor',label:'地方人物觀測'});
});
test('the listing itself, unknown families and empty paths get no family link', () => {
 for(const path of ['/channels','/channels/','/live/current','/ai/days','/comments/abc','/','',null,undefined])
  assert.equal(reportFamilyIndex(path),null,String(path));
});
test('report paths are the report families, not other pages', () => {
 for(const path of ['/channels','/channels/70/videos','/live/current','/ai/days/2026-11-10','/mayor','/comments/x','/keywords/%E5%85%AC%E5%9C%92/videos'])assert.equal(isReportPath(path),true,path);
 for(const path of ['/','/about','/boards','/compare/titles','/my/saved','/livestream','/channelsx','/api',null,undefined])assert.equal(isReportPath(path),false,String(path));
});
