import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {dateTime,taipeiCalendarDate} from './format';
test('UTC Z instants from the v1 API render in Asia/Taipei, including across Taipei midnight',()=>{
 assert.equal(dateTime('2026-10-11T16:00:00.000Z'),dateTime('2026-10-12T00:00:00+08:00'));
 assert.match(dateTime('2026-10-11T16:00:00.000Z'),/^2026\/10\/12\D*12:00$/);
 assert.match(dateTime('2026-10-11T15:59:00.000Z'),/^2026\/10\/11\D*11:59$/);
 assert.equal(dateTime('2026-10-11T16:00:00.000Z',true),'2026/10/12');
 assert.equal(dateTime('2026-10-12',true),'2026/10/12');
 assert.equal(dateTime('not-a-date'),'未記錄');
});
test('calendar dates derived from UTC instants use the Taipei day, date-only values pass through',()=>{
 assert.equal(taipeiCalendarDate('2026-10-11T16:00:00.000Z'),'2026-10-12');
 assert.equal(taipeiCalendarDate('2026-10-11T15:59:59.999Z'),'2026-10-11');
 assert.equal(taipeiCalendarDate('2026-10-12T00:00:00+08:00'),'2026-10-12');
 assert.equal(taipeiCalendarDate('2026-10-12'),'2026-10-12');
 for(const value of [undefined,null,'','2026-10','invalid','2026-13-40T00:00:00Z'])assert.equal(taipeiCalendarDate(value),'');
});
