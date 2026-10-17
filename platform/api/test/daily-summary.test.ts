import {it,expect} from 'vitest';
import {buildTopics} from '../src/reports/topics.js';
import {channelTagIds,sourceStats,summarizeTopics} from '../src/reports/daily-summary.js';
const row=(pk:number,events:unknown[])=>({pk,result_json:JSON.stringify(events)});
it('counts the Laravel summary box from cited channel events and channel party tags',()=>{
 const sources=new Map([
  [1,row(11,[{事件:'甲',關鍵字:['預算','核能'],人物:['甲某'],角度:'台灣角度',陣營:'民進黨',videoId:['Summary0001','Summary0002']}])],
  [2,row(12,[{事件:'乙',關鍵字:['預算'],人物:['無'],角度:'中國',陣營:'國民黨',videoId:['Summary0003']}])],
  [406,row(13,[{事件:'丙',關鍵字:['核能','預算'],videoId:['Summary0004']}])],
 ]);
 const channels=new Map([[1,'綠台'],[2,'藍台'],[406,'直播台']]);
 const topics=buildTopics(5,JSON.stringify([{標題:'預算爭議',媒體事件:{綠台:['甲'],藍台:['乙'],直播台:['丙'],未知台:['丁']}}]),channels,sources);
 summarizeTopics(topics,sources,new Map([[1,channelTagIds('[4][31]')],[2,channelTagIds('[3]')]]));
 expect(topics[0]!.summary).toEqual({
  keywords:[{term:'預算',count:3},{term:'核能',count:2}],people:[{term:'甲某',count:1}],
  party:{green:2,blue:1},angle:{taiwan:2,china:1},camp:{dpp:2,kmt:1},
  videos:[{videoId:'Summary0001',channelId:1,channelTitle:'綠台',event:'甲'},{videoId:'Summary0003',channelId:2,channelTitle:'藍台',event:'乙'}],
 });
});
it('skips single-video events from the all-condition source coverage only',()=>{
 const sources=new Map([[1,row(1,[{事件:'甲',videoId:['Summary0001','Summary0002']},{事件:'乙',videoId:['Summary0003']}])],[2,row(2,[{事件:'丙',videoId:['Summary0004']}])]]);
 expect(sourceStats(sources,'all')).toEqual({channels:2,channelsWithEvents:1,eventRows:1,videoRefs:2});
 expect(sourceStats(sources,'green')).toEqual({channels:2,channelsWithEvents:2,eventRows:3,videoRefs:4});
});
