import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {aiHoursTitle,hourGroups,pageHref,pageOffsets,shiftDate,splitTerms,taipeiHour,taipeiToday} from './ai-hours-board';
const row=(sourceId:number,topicIndex:number,time:string,event:string,extra:Record<string,string|number>={})=>({topicIndex,time,until:time,event,summary:'',channels:{value:'',sources:[]},videos:0,sourceId,dataType:'each',category:'',angle:'',camp:'',keywords:'',people:'',places:'',...extra});
const ref=(sourceId:number,topicIndex:number,videoId:string,channelTitle:string)=>({topicIndex,time:'',event:'',sourceId,video:{value:videoId,href:`/videos/${videoId}`,media:{kind:'video' as const,videoId,thumbnail:null}},channel:{value:channelTitle,sources:[{channelId:7,channelTitle,channelAvatar:null}]}});
test('topics are grouped into Laravel hour tables in Taipei time, each joined to its first source video',()=>{
 const groups=hourGroups([
  row(12,0,'2026-10-17T16:00:00.000Z','甲',{summary:'描述',category:'政治',angle:'偏台灣',camp:'中性',videos:2,keywords:'一、二、三、四、五、六、七、八、九',people:'甲某、乙某',places:'台北市、屏東縣、高雄市、台中市、台南市、新竹市、基隆市'}),
  row(12,1,'2026-10-17T16:00:00.000Z',''),
  row(12,2,'2026-10-17T16:00:00.000Z','乙'),
  row(11,0,'2026-10-17T15:00:00.000Z','丙'),
 ],[ref(12,0,'AAAAAAAAAAA','綠台'),ref(12,0,'BBBBBBBBBBB','藍台'),ref(11,0,'bad','x')]);
 assert.deepEqual(groups.map(g=>[g.sourceId,g.date,g.hour,g.topics.map(t=>t.event)]),[[12,'2026-10-18','00',['甲','乙']],[11,'2026-10-17','23',['丙']]]);
 const first=groups[0]!.topics[0]!;
 assert.deepEqual(first.keywords,['一','二','三','四','五','六','七','八']);
 assert.deepEqual(first.names,['甲某','乙某','台北市','屏東縣','高雄市','台中市','台南市','新竹市']);
 assert.deepEqual(first.first,{videoId:'AAAAAAAAAAA',channelId:7,channelTitle:'綠台',channelAvatar:null});
 assert.equal(first.videos,2);
 assert.equal(groups[0]!.topics[1]!.first,null);
 assert.equal(groups[1]!.topics[0]!.first,null);
});
test('titles, dates and terms follow the Laravel hourly report',()=>{
 assert.equal(aiHoursTitle('2026-10-18','all'),'2026-10-18 當日分時事件整理');
 assert.equal(aiHoursTitle('2026-10-18','green'),'泛綠媒體在 2026-10-18 每小時主要報導');
 assert.equal(aiHoursTitle(null,'blue'),'當日分時事件整理');
 assert.equal(shiftDate('2026-03-01',-1),'2026-02-28');
 assert.equal(taipeiToday(new Date('2026-10-17T16:30:00Z')),'2026-10-18');
 assert.deepEqual(taipeiHour('nope'),{date:'',hour:''});
 assert.deepEqual(splitTerms(' 甲 、、乙'),['甲','乙']);
});
test('remaining pages are planned up to the row cap, and switch links keep the query but not the page',()=>{
 assert.deepEqual(pageOffsets(258,0),[200]);
 assert.deepEqual(pageOffsets(150,0),[]);
 assert.deepEqual(pageOffsets(5000,200,200,600),[400,600]);
 assert.equal(pageHref('/ai/hours',{date:'2026-10-17',type:'each',offset:'200',condition:'blue'},{condition:null}),'/ai/hours?date=2026-10-17&type=each');
 assert.equal(pageHref('/ai/periods',{from:'2026-10-01',to:'2026-10-07',condition:'green'},{month:'2026-09',from:null,to:null}),'/ai/periods?condition=green&month=2026-09');
});
