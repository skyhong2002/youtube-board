import {describe,expect,it} from 'vitest';
import {nameVersions} from '../src/reports/channel-title-history.js';

const logo=(revision:string,cachedAt:string)=>({url:`/media/channels/91/${revision.repeat(64)}.png`,revision:revision.repeat(64),width:192 as const,height:192 as const,cachedAt});
describe('channel name versions',()=>{
 it('pairs each name with the newest logo cached before the next name, newest first',()=>{
  const rows=[{title:'多肉團購直播台',observedAt:'2026-10-24T09:35:36.000Z'},{title:'村長詹江村',observedAt:'2020-07-26T04:00:00.000Z'}];
  const old=logo('a','2026-10-17T15:01:00.000Z'),current=logo('b','2026-10-24T09:39:00.000Z');
  expect(nameVersions(rows,[logo('c','2026-10-12T00:00:00.000Z'),old,current].sort((x,y)=>x.cachedAt.localeCompare(y.cachedAt)))).toEqual([
   {title:'多肉團購直播台',observedAt:'2026-10-24T09:35:36.000Z',avatar:current},
   {title:'村長詹江村',observedAt:'2020-07-26T04:00:00.000Z',avatar:old},
  ]);
 });
 it('leaves a name without a logo when nothing was cached while it was current',()=>{
  const current=logo('b','2026-10-24T09:53:00.000Z');
  expect(nameVersions([{title:'Puma Shen',observedAt:'2024-03-15T00:00:00.000Z'},{title:'沈伯洋Puma',observedAt:'2026-10-24T09:35:36.000Z'}],[current]).map(v=>v.avatar)).toEqual([current,null]);
 });
});
