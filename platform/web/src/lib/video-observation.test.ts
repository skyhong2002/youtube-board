import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ObservationChart,observedPoints} from '../components/ObservationChart';
import {EvidenceDisclosure} from '../components/EvidenceDisclosure';
const webSource=(file:string)=>{const local=join(process.cwd(),file),root=join(process.cwd(),'platform/web',file);return readFileSync(existsSync(local)?local:root,'utf8');};
const render=(points:{time:string;value:number|null}[])=>renderToStaticMarkup(createElement(ObservationChart,{points,label:'影片累計觀看數觀測',unit:'次'}));

test('a single view observation is a compact value and time, not a full chart',()=>{
 const html=render([{time:'2026-10-21',value:2069}]);
 assert.match(html,/data-observation="single"/);assert.match(html,/目前僅一筆觀測/);assert.match(html,/<time dateTime="2026-10-21">2026-10-21<\/time>/);assert.match(html,/2,069<span[^>]*>次<\/span>/);
 assert.doesNotMatch(html,/<figure|查看數值表格/);
});
test('gaps do not count as observations: one valid point among missing values stays compact',()=>{
 const points=[{time:'2026-10-20',value:null},{time:'2026-10-21',value:2069}];
 assert.equal(observedPoints(points).length,1);assert.match(render(points),/data-observation="single"/);
});
test('two or more observations keep the time chart',()=>{
 const html=render([{time:'2026-10-20',value:1000},{time:'2026-10-21',value:2069}]);
 assert.match(html,/<figure/);assert.doesNotMatch(html,/data-observation="single"/);
});
test('tag evidence is one heading, tag chips, and a disclosure the #keyword-evidence anchor opens',()=>{
 const closed=renderToStaticMarkup(createElement(EvidenceDisclosure,{anchor:'keyword-evidence',summary:'比對依據（58 處）',children:'list'}));
 assert.match(closed,/<details class="group mt-3">/);assert.doesNotMatch(closed,/<details[^>]* open/);
 assert.match(renderToStaticMarkup(createElement(EvidenceDisclosure,{anchor:'keyword-evidence',open:true,summary:'x',children:'list'})),/<details[^>]* open=""/);
 assert.match(webSource('src/components/EvidenceDisclosure.tsx'),/location\.hash[\s\S]*hashchange/);
 const source=webSource('src/components/VocabularyReport.tsx');
 assert.doesNotMatch(source,/共同標籤與比對依據/);assert.match(source,/id="keyword-evidence"[^>]*>\s*<SectionHeading title="共同標籤"/);
 assert.doesNotMatch(webSource('src/lib/report-pages.tsx'),/<SectionHeading title="共同標籤"|資料最後記錄：/);
});
