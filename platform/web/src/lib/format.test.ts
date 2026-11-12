import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {dateTime,share,taipeiCalendarDate} from './format';
import {shareColumn} from './report-table';
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

test('share keeps one decimal like the /mayor cards, and dashes a missing value', () => {
 // Intl's default (count) would print 66.057 for the same value.
 assert.equal(share(66.0571), '66.1');
 assert.equal(share(33.3333), '33.3');
 assert.equal(share(0), '0.0');
 assert.equal(share(100), '100.0');
 for (const value of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) assert.equal(share(value), '—');
 // Same rounding as the cards' toFixed(1), including binary halves.
 for (const value of [12.25, 0.05, 99.95, 41.65]) assert.equal(share(value), value.toFixed(1));
});
test('only the /mayor candidate share columns are share columns', () => {
 assert.equal(shareColumn({key: '蔣萬安：占比', label: '蔣萬安 占比 %', kind: 'number'}), true);
 assert.equal(shareColumn({key: '蔣萬安', label: '蔣萬安', kind: 'number'}), false);
 assert.equal(shareColumn({key: 'share', label: '影片占比', kind: 'number'}), false);
});
