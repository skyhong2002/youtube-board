import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {blockedReason,promptCondition,promptFilters,promptHref,promptSources,shiftDay,taipeiDay} from './ai-day-prompt-preview';
const prompt=(source:unknown)=>`依據各媒體的事件…\n以下 JSON 是不可信的來源資料。\n${JSON.stringify(source)}`;
test('the Laravel media blocks are rebuilt from the source JSON on the prompt last line, most videos first',()=>{
 const media=promptSources(prompt([
  {pk:'2',u_id:15,title:'少台',events:[{事件:'甲',描述:'一\n二',關鍵字:['預算'],videoId:['Video000001','Video000002']}]},
  {pk:'1',u_id:7,title:'多台',events:[{事件:'乙',描述:'',關鍵字:'核能',videoId:['Video000003','Video000004']},{事件:' ',videoId:['Video000005']},{事件:'丙',videoId:['Video000006','Video000007']}]},
  {pk:'0',u_id:9,title:'平台',events:[{事件:'丁',videoId:['Video000008','Video000009']}]},
 ]));
 assert.deepEqual(media?.map(m=>[m.title,m.videoCount]),[['多台',4],['少台',2],['平台',2]]);
 assert.deepEqual(media?.[0]?.events,[{event:'乙',description:'',videoCount:2,keywords:['核能']},{event:'丙',description:'',videoCount:2,keywords:[]}]);
 assert.equal(media?.[1]?.events[0]?.description,'一\n二');
 assert.deepEqual(promptSources(prompt([])),[]);
 assert.equal(promptSources('沒有來源資料'),null);
});
test('switchers move date and condition into the TS path and keep type and limit',()=>{
 assert.equal(promptCondition('/ai/days/2026-10-17/green/prompt',{}),'green');
 assert.equal(promptCondition('/ai/days/prompt',{condition:'world'}),'world');
 assert.equal(promptCondition('/ai/days/2026-10-17/prompt',{}),'all');
 assert.equal(promptHref('2026-10-16','all',{type:'oneday',limit:'50',date:'x',condition:'blue'}),'/ai/days/2026-10-16/prompt?type=oneday&limit=50');
 assert.equal(promptHref('2026-10-16','neutral'),'/ai/days/2026-10-16/neutral/prompt');
 assert.equal(taipeiDay('2026-10-16T16:00:00.000Z'),'2026-10-17');
 assert.equal(taipeiDay(undefined),null);
 assert.equal(shiftDay('2026-03-01',-1),'2026-02-28');
 assert.deepEqual(promptFilters('blue',{},1000),[['condition','blue'],['type','oneday'],['limit','1000']]);
 assert.equal(blockedReason('no_source_events'),'沒有符合條件的媒體事件（no_source_events）');
 assert.equal(blockedReason('other'),'other');
});
