import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {CLOUD_VISIBLE_WORDS,ReportWordCloud,wordCloudLayout} from '../components/ReportWordCloud';

const words=Array.from({length:200},(_,i)=>({term:`詞${i}`,weight:i<20?20-i:.476,href:`/keywords/${encodeURIComponent(`詞${i}`)}/videos`}));

test('word cloud draws the heaviest 60 words across the whole 13–30px range and keeps the tail for the list',()=>{
 const {shown,rest}=wordCloudLayout([...words].reverse());
 assert.equal(shown.length,CLOUD_VISIBLE_WORDS);assert.equal(rest.length,140);
 assert.deepEqual(shown.slice(0,3).map(s=>s.word.term),['詞0','詞1','詞2']);
 assert.equal(shown[0]!.fontSize,30);assert.equal(shown.at(-1)!.fontSize,13);
 for(let i=1;i<shown.length;i++)assert.ok(shown[i]!.fontSize<=shown[i-1]!.fontSize);
 assert.equal(shown[0]!.tier,'top');assert.equal(shown.at(-1)!.tier,'low');
 // Ties keep the API order.
 assert.deepEqual(wordCloudLayout([{term:'甲',weight:1},{term:'乙',weight:1}]).shown.map(s=>[s.word.term,s.fontSize,s.tier]),[['甲',21.5,'mid'],['乙',21.5,'mid']]);
 assert.equal(wordCloudLayout([{term:'甲',weight:Number.NaN},{term:'乙',weight:4}]).shown[0]!.word.term,'乙');
});

test('word cloud shows terms without weight numbers; weights stay in the tooltip and accessible name',()=>{
 const html=renderToStaticMarkup(createElement(ReportWordCloud,{words}));
 assert.match(html,/aria-label="關鍵詞分布"/);
 assert.match(html,/<a (?=[^>]*href="\/keywords\/%E8%A9%9E0\/videos")(?=[^>]*title="詞0：20")[^>]*>詞0<span class="sr-only">（權重 20）<\/span><\/a>/);
 assert.doesNotMatch(html.replace(/<span class="sr-only">[^<]*<\/span>/g,'').replace(/title="[^"]*"/g,''),/0\.476|<small/);
 assert.match(html,/<details[^>]*><summary[^>]*>.*顯示其餘 140 個詞/);
 assert.equal(html.match(/<a /g)?.length,200);
 const few=renderToStaticMarkup(createElement(ReportWordCloud,{words:words.slice(0,5).map(({term,weight})=>({term,weight}))}));
 assert.doesNotMatch(few,/<details|<a /);
});

test('narrow report sections preview the first rows and only they get the toggle',()=>{
 const source=readFileSync(new URL('../components/ExpandedReport.tsx',import.meta.url),'utf8');
 const rows=Number(source.match(/SECTION_PREVIEW_ROWS = (\d+)/)?.[1]);
 assert.equal(rows,30);
 assert.ok(source.includes(`tbody>tr:nth-child(n+${rows+1})]:hidden!`),'preview class must hide rows after SECTION_PREVIEW_ROWS');
 assert.match(source,/section\.columns\.length <= NARROW_SECTION_COLUMNS && section\.rows\.length > SECTION_PREVIEW_ROWS/);
 assert.match(source,/<ReportTable columns=\{data\.columns\} rows=\{data\.rows\}/,'the main observation table stays unbounded');
});
