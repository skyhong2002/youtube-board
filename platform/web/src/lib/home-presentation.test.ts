import assert from 'node:assert/strict';
import test from 'node:test';
import {homeEdition,visibleHomeKeywords} from './home-presentation';
test('home edition uses recorded observation time with Taipei dates and a neutral missing state',()=>{assert.match(homeEdition('2026-10-10T18:00:00Z','2026-10-08'),/2026\/10\/11/);assert.match(homeEdition(null,'2026-10-08'),/2026\/10\/08/);assert.equal(homeEdition(null,null),'持續觀察 YouTube 公共討論');assert.equal(homeEdition('invalid',null),'持續觀察 YouTube 公共討論');});
test('unavailable or unsynchronized home vocabulary never exposes old rows as current',()=>{const rows=[{key:'news',term:'新聞',videoCount:3,views:null,unknownViewVideos:3}];assert.deepEqual(visibleHomeKeywords({status:'unavailable',rows}),[]);assert.deepEqual(visibleHomeKeywords({status:'not-synchronized',rows}),[]);assert.equal(visibleHomeKeywords({status:'synchronized',rows}),rows);});
