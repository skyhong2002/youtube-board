import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import type {EventCitation,EventPresentation} from '../../../api/src/contracts';
import {aiEventTitle,citationVideo,historyDays,peopleGroups} from './ai-event-board';
test('the Laravel title names the event and its daily date',()=>{
 assert.equal(aiEventTitle('日菲劃界談判','2026-06-02'),'日菲劃界談判 到 2026-06-02 的相關報導');
 assert.equal(aiEventTitle('日菲劃界談判',null),'日菲劃界談判 相關報導');
 assert.equal(aiEventTitle('',null),'事件分析');
});
test('history rows group into one line per date, keeping order and the first event link',()=>{
 const row=(date:string,event:string,dailyId:number)=>({date,event:{value:event,href:`/ai/days/${dailyId}/events?event=${encodeURIComponent(event)}`},dailyId,periodId:null,association:''});
 assert.deepEqual(historyDays([row('2026-06-02','甲',9),row('2026-06-01','乙',8),row('2026-06-01','丙',8),row('2026-06-01','乙',8),{date:'',event:'x'}]),[
  {date:'2026-06-02',dailyId:9,href:'/ai/days/9/events?event=%E7%94%B2',events:[{title:'甲',href:'/ai/days/9/events?event=%E7%94%B2'}]},
  {date:'2026-06-01',dailyId:8,href:'/ai/days/8/events?event=%E4%B9%99',events:[{title:'乙',href:'/ai/days/8/events?event=%E4%B9%99'},{title:'丙',href:'/ai/days/8/events?event=%E4%B8%99'}]},
 ]);
 assert.equal(historyDays([{date:'2026-06-01',event:{value:'甲',href:'javascript:alert(1)'},dailyId:1}])[0]!.href,null);
});
test('a cited video links only through a safe href and says why it has none',()=>{
 const c=(over:Partial<EventCitation>):EventCitation=>({id:'gUBcg8ffIq4',rawId:'gUBcg8ffIq4',media:'台',href:'https://www.youtube.com/watch?v=gUBcg8ffIq4',verification:'stored-reference',...over});
 assert.deepEqual(citationVideo(c({})),{href:'https://www.youtube.com/watch?v=gUBcg8ffIq4',label:'gUBcg8ffIq4',state:null});
 assert.deepEqual(citationVideo(c({href:null,verification:'outside-snapshot'})),{href:null,label:'gUBcg8ffIq4',state:'不屬於原始快照'});
 assert.deepEqual(citationVideo(c({href:null,rawId:'bad',verification:'invalid'})),{href:null,label:'bad',state:'影片識別格式無效'});
});
test('people groups follow supporting, opposing, other and skip empty groups',()=>{
 const person=(name:string)=>({person:name,role:'',stance:'',strength:'',description:'',citations:[]});
 const people:EventPresentation['people']={analysisId:1,mainSubject:'',groups:[{kind:'other',rows:[person('丙')]},{kind:'opposing',rows:[]},{kind:'supporting',rows:[person('甲')]}]};
 assert.deepEqual(peopleGroups(people).map(g=>[g.label,g.rows.map(r=>r.person)]),[['支持者',['甲']],['其他',['丙']]]);
 assert.deepEqual(peopleGroups(null),[]);
});
