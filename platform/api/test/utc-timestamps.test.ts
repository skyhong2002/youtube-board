import {describe,expect,it} from 'vitest';
import {channel,latest,taipeiDate,taipeiSql,timestamp,timestampWindow,video} from '../src/reports/normalize.js';
import {parseVideoAnalytics} from '../src/reports/video-analytics.js';
import {cacheObservationTime,cacheWindowNotes,publicCacheWindow} from '../src/reports/cache-lineage.js';

describe('UTC timestamp contract with Taipei calendar dimensions',()=>{
 it.each([
  ['2026-10-12 00:00:00','2026-10-11T16:00:00.000Z'],
  ['2026-01-01','2025-12-31T16:00:00.000Z'],
  ['2024-03-01 00:00:00','2024-02-29T16:00:00.000Z'],
  ['2026-10-12 00:00:00.123456','2026-10-11T16:00:00.123Z'],
  ['2026-10-12T00:00:00+08:00','2026-10-11T16:00:00.000Z'],
  ['2026-10-12T00:00:00-04:00','2026-10-12T04:00:00.000Z'],
  ['2026-10-11T16:00:00Z','2026-10-11T16:00:00.000Z'],
 ])('serializes %s as the same instant in UTC',(source,expected)=>expect(timestamp(source)).toBe(expected));
 it.each([null,undefined,'','0000-00-00 00:00:00','invalid','2026-13-01 00:00:00'])('retains unknown/invalid timestamps as null (%s)',source=>expect(timestamp(source)).toBeNull());
 it('keeps sorting and Taipei query/window helpers independent of wire representation',()=>{
  expect(latest('2026-10-12 00:00:00','2026-10-11T17:00:00Z')).toBe('2026-10-11T17:00:00.000Z');
  const date=new Date('2026-10-11T16:00:00Z');
  expect(taipeiDate(date)).toBe('2026-10-12');expect(taipeiSql(date)).toBe('2026-10-12 00:00:00');
 });
 it('changes only timestamp fields, preserving timestamp-shaped source content',()=>{
  const literal='2026-10-12T00:00:00+08:00';
  expect(video({videoId:'abcdefghijk',title:literal,description:literal,publishedAt:'2026-10-12 00:00:00'})).toMatchObject({title:literal,publishedAt:'2026-10-11T16:00:00.000Z'});
  expect(channel({title:literal,description:literal,publishedAt:'2026-10-12 00:00:00'},new Map())).toMatchObject({title:literal,description:literal,publishedAt:'2026-10-11T16:00:00.000Z'});
 });
 it('emits UTC hourly points while keeping Taipei daily buckets across midnight',()=>{
  const data=parseVideoAnalytics('abcdefghijk',{},[{the_date:'2026-10-12',max_current:2,log_json:'{"00:30":2}'}],[],{pageToken:'',comments_json:JSON.stringify({a:{textOriginal:'source',publishedAt:'2026-10-11T16:30:00Z'}})},50);
  expect(data.live.hourly).toEqual([{time:'2026-10-11T16:00:00.000Z',value:2}]);
  expect(data.live.daily).toEqual([{time:'2026-10-12',value:2}]);
  expect(data.comments.hourly).toEqual([{time:'2026-10-11T16:00:00.000Z',value:1}]);
  expect(data.comments.daily).toEqual([{time:'2026-10-12',value:1}]);
 });
 it('normalizes public cache observation instants without changing publication identity or Taipei notes',()=>{
  const window={from:'2026-10-12',to:'2026-10-12',closed:false,observedUntil:'2026-10-12 00:00:00'};
  const output=publicCacheWindow(window);
  expect(output).toEqual({...window,observedUntil:'2026-10-11T16:00:00.000Z'});
  expect(window.observedUntil).toBe('2026-10-12 00:00:00');
  expect(cacheWindowNotes([{_cacheWindow:output}])).toEqual(['2026-10-12～2026-10-12 為部分期間觀測，資料截至台北時間 2026-10-12 00:00:00。']);
  expect(cacheObservationTime(window.observedUntil)).toBe('2026-10-12 00:00:00');
  expect(publicCacheWindow(undefined)).toBeNull();
 });
 it('normalizes explicitly typed vocabulary windows while retaining raw source snapshots',()=>{
  const window={since:'2026-10-12T00:00:00+08:00',until:'2026-10-13T00:00:00+08:00'};
  expect(timestampWindow(window)).toEqual({since:'2026-10-11T16:00:00.000Z',until:'2026-10-12T16:00:00.000Z'});
  expect(window.since).toBe('2026-10-12T00:00:00+08:00');
  expect(timestampWindow({since:window.since,until:'invalid'})).toBeNull();
 });
});
