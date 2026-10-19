import {it,expect} from 'vitest';
import {buildTopics} from '../src/reports/topics.js';
import {channelTagIds,rankByNetworks,sourceStats,summarizeTopics} from '../src/reports/daily-summary.js';
import {channelNetwork} from '../../shared/channel-networks.js';
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
it('orders daily topics by media networks, not channels',()=>{
 const sources=new Map([
  [39,row(1,[{事件:'甲',videoId:['Network0001','Network0002','Network0003']}])],
  [270,row(2,[{事件:'乙',videoId:['Network0004','Network0005','Network0006']}])],
  [404,row(3,[{事件:'丙',videoId:['Network0007']}])],
  [1346,row(4,[{事件:'丁',videoId:['Network0008']}])],
  [9001,row(5,[{事件:'戊',videoId:['Network0009']}])],
 ]);
 const channels=new Map([[39,'三立LIVE'],[270,'三立iNEWS'],[404,'TVBS'],[1346,'中央社'],[9001,'獨立台']]);
 const topics=buildTopics(7,JSON.stringify([
  {標題:'單一集團',媒體事件:{三立LIVE:['甲'],三立iNEWS:['乙']}},
  {標題:'跨集團',媒體事件:{TVBS:['丙'],中央社:['丁'],獨立台:['戊']}},
 ]),channels,sources);
 // Six videos from two 三立 channels outscore three single videos by channel count, but are one network.
 expect(topics.map(t=>t.title)).toEqual(['單一集團','跨集團']);
 const ranked=rankByNetworks(topics,new Map([[39,channelTagIds('[64][13]')],[270,channelTagIds('[13][64]')],[404,channelTagIds('[29]')],[1346,channelTagIds('[13][109]')],[9001,channelTagIds('[13]')]]));
 expect(ranked.map(t=>[t.title,t.networkCount,t.networks,t.score])).toEqual([
  ['跨集團',3,['TVBS','中央社','獨立台'],12],
  ['單一集團',1,['三立'],9],
 ]);
});
it('treats 旺中 as the network of channels also tagged 中視 or 中時',()=>{
 expect(channelNetwork(1006,channelTagIds('[13][12][53][89][3][96][102]'),'中視新聞')).toEqual({key:'tag:53',name:'旺中'});
 expect(channelNetwork(5,[],'某台')).toEqual({key:'channel:5',name:'某台'});
});
