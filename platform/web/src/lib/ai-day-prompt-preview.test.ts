import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {blockedReason,omittedReason,promptCondition,promptFilters,promptHref,promptPeriod,promptPeriodHref,shiftDay,taipeiDay} from './ai-day-prompt-preview';
test('a preview period is Taipei days and custom periods keep condition, type and limit in the query',()=>{
 assert.deepEqual(promptPeriod({from:'2026-10-16T16:00:00.000Z',to:'2026-10-17T15:59:59.000Z'}),{from:'2026-10-17',to:'2026-10-17',custom:false});
 assert.deepEqual(promptPeriod({from:'2026-10-10T16:00:00.000Z',to:'2026-10-17T15:59:59.000Z'}),{from:'2026-10-11',to:'2026-10-17',custom:true});
 assert.equal(promptPeriod(undefined),null);
 assert.equal(promptPeriodHref('2026-10-11','2026-10-17','green',{type:'week',limit:'50',date:'x',from:'y'}),'/ai/days/prompt?from=2026-10-11&to=2026-10-17&condition=green&type=week&limit=50');
 assert.equal(promptPeriodHref('2026-10-11','2026-10-17','all'),'/ai/days/prompt?from=2026-10-11&to=2026-10-17');
 assert.equal(omittedReason('no_qualifying_events'),'這個媒體沒有符合 legacy prompt 條件的事件。');
 assert.equal(omittedReason('other'),'未納入提示詞（other）。');
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
