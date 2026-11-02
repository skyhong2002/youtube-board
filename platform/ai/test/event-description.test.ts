import {describe,expect,it} from 'vitest';
import {cleanDescription} from '../src/event.js';

describe('event person/media descriptions',()=>{
 it('drops method caveats and keeps what the person said or did',()=>{
  // 2026-11-01「沈伯洋於大安森林公園終點站開講」as published before the rule.
  const raw='僅依提供的影片標題與上游摘要整理，未觀看影片或進行事實查核。來源描述沈伯洋車掃後抵達大安森林公園開講；自由時報電子報標題另稱其高唱「白浪滔滔我不怕」，鏡新聞標題引述其稱「聲音最大的一場」。這些資料不足以判定其對特定議題的支持或反對立場，故列為其他，強度低表示立場證據不足。現場人數均為來源所稱，未經獨立確認；鏡新聞上游摘要稱線上15萬人收看，但對應影片 h78BACwLbO4 的標題為線上20萬人，兩者不一致，不視為已確認數字。';
  expect(cleanDescription(raw)).toBe('來源描述沈伯洋車掃後抵達大安森林公園開講；自由時報電子報標題另稱其高唱「白浪滔滔我不怕」，鏡新聞標題引述其稱「聲音最大的一場」。');
 });
 it('leaves ordinary descriptions alone and empties pure caveats',()=>{
  expect(cleanDescription('批評對手只會背稿，主張再辯一場。')).toBe('批評對手只會背稿，主張再辯一場。');
  expect(cleanDescription('證據不足，故列為其他。')).toBe('');
  expect(cleanDescription(undefined)).toBe('');
 });
});
