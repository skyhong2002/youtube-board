import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import type {TopicRow,EventEvidence} from '../../../api/src/contracts';
import {sourceStats,topicSummary} from './ai-daily-summary';
const evidence=(channelId:number,channelTitle:string,event:string,keywords:string[],people:string[],videoIds:string[]):EventEvidence=>({channelId,channelTitle,event,keywords,people,videoIds,source:{table:'urt_channel_ai',id:channelId}});
test('the Laravel summary box is rebuilt from topic evidence, channel AI rows and party tag lists',()=>{
 const topic={evidence:[
  evidence(1,'綠台','甲',['預算','核能'],['甲某'],['Summary0001','Summary0002']),
  evidence(2,'藍台','乙',['預算'],[],['Summary0003']),
  evidence(406,'直播台','丙',['核能','預算'],[],['Summary0004']),
 ]} as TopicRow;
 const events=new Map([[1,[{title:'甲',angle:'偏台灣：…',camp:'較偏民進黨',videos:2}]],[2,[{title:'乙',angle:'中國',camp:'國民黨',videos:1}]]]);
 assert.deepEqual(topicSummary(topic,events,new Set([1]),new Set([2])),{
  keywords:[{term:'預算',count:3},{term:'核能',count:2}],people:[{term:'甲某',count:1}],
  party:{green:2,blue:1},angle:{taiwan:2,china:1},camp:{dpp:2,kmt:1},
  videos:[{videoId:'Summary0001',channelTitle:'綠台',event:'甲'},{videoId:'Summary0003',channelTitle:'藍台',event:'乙'}],
 });
});
test('the AI source card skips single-video events only under the all condition',()=>{
 const events=new Map([[1,[{title:'甲',angle:'',camp:'',videos:2},{title:'乙',angle:'',camp:'',videos:1}]],[2,[{title:'丙',angle:'',camp:'',videos:1}]]]);
 assert.deepEqual(sourceStats(events,'all'),{channelsWithEvents:1,eventRows:1,videoRefs:2});
 assert.deepEqual(sourceStats(events,'green'),{channelsWithEvents:2,eventRows:3,videoRefs:4});
});
