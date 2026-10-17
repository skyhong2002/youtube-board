import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {aiPeriodsTitle,periodStats,periodTopics,rangeDays,recentMonths} from './ai-periods-board';
test('period rows keep the Laravel columns and leave missing stored statistics empty',()=>{
 const topics=periodTopics([
  {date:'2026-10-15',event:{value:'甲',href:'/ai/days/5551/events?event=%E7%94%B2'},channels:6,videos:122,keywordCount:944,topPerson:'沈伯洋',topPersonCount:6,topKeyword:'士林夜市',topKeywordCount:6,metricSource:'已儲存彙整統計',sourceId:5551,dataType:'oneday'},
  {date:'2026-10-17',event:{value:'乙',href:'https://example.com/'},channels:6,videos:null,keywordCount:null,topPerson:null,topPersonCount:null,topKeyword:null,topKeywordCount:null,metricSource:'原始每日議題；未取得彙整統計',sourceId:5563,dataType:'oneday'},
  {date:'2026-10-17',event:'',channels:1},
 ]);
 assert.deepEqual(topics,[
  {date:'2026-10-15',event:'甲',href:'/ai/days/5551/events?event=%E7%94%B2',channels:6,videos:122,keywordCount:944,topPerson:'沈伯洋',topPersonCount:6,topKeyword:'士林夜市',topKeywordCount:6,stored:true},
  {date:'2026-10-17',event:'乙',href:null,channels:6,videos:null,keywordCount:null,topPerson:'',topPersonCount:null,topKeyword:'',topKeywordCount:null,stored:false},
 ]);
 assert.deepEqual(periodStats(topics),{dates:2,stored:1});
});
test('titles, month switcher and range length follow the Laravel period report',()=>{
 assert.equal(aiPeriodsTitle({from:'2026-10-01',to:'2026-10-31',month:'2026-10'},'green'),'2026年10月 的所有事件');
 assert.equal(aiPeriodsTitle({from:'2026-10-10',to:'2026-10-17',month:null},'all'),'2026-10-10 - 2026-10-17 主要事件與各媒體報導');
 assert.equal(aiPeriodsTitle({from:'2026-10-10',to:'2026-10-17',month:null},'world'),'2026-10-10 - 2026-10-17 國際新聞報導');
 assert.deepEqual(recentMonths(new Date('2026-12-31T16:30:00Z')),['2027-01','2026-12']);
 assert.deepEqual(recentMonths(new Date('2026-03-31T00:00:00Z')),['2026-03','2026-02']);
 assert.equal(rangeDays('2026-10-10','2026-10-17'),8);
 assert.equal(rangeDays('',''),0);
});
