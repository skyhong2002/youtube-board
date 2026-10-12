import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {KeywordEvidenceNotice} from '../components/KeywordEvidenceNotice';
import type {ReportMeta} from '../../../api/src/contracts';

const complete={status:'synchronized',vocabularyVersion:'fixture-v1',sourceVideos:12,freshVideos:12,staleVideos:0,unprocessedVideos:0,keywordMatchedVideos:0};
const render=(coverage:ReportMeta['coverage'],subject='交通',scopeLabel?:string)=>renderToStaticMarkup(createElement(KeywordEvidenceNotice,{coverage,subject,scopeLabel}));

test('unsynchronized vocabulary leaves missing counts unknown rather than inventing zero matches',()=>{
 const html=render({status:'not-synchronized',vocabularyVersion:null});
 assert.match(html,/尚未同步/);assert.match(html,/版本：未提供/);assert.match(html,/空列表不代表沒有相關影片/);
 for(const label of ['來源影片','有效比對','來源文字已變動','尚未比對','符合標籤'])assert.ok(html.includes(`<dt>${label}</dt><dd>未提供</dd>`));
 assert.doesNotMatch(html,/0 部|皆已完成|沒有符合這個共同標籤/);
});
test('stale and unprocessed evidence counts remain visible even when synchronized results are empty',()=>{
 const html=render({...complete,freshVideos:5,staleVideos:3,unprocessedVideos:4},'交通','本看板範圍');
 for(const [label,value]of [['來源影片',12],['有效比對',5],['來源文字已變動',3],['尚未比對',4],['符合標籤',0]])assert.ok(html.includes(`<dt>${label}</dt><dd>${value} 部</dd>`));
 assert.match(html,/詞彙狀態：已同步/);assert.match(html,/fixture-v1/);assert.match(html,/本看板範圍/);
 assert.match(html,/空列表不能視為沒有相關影片/);assert.doesNotMatch(html,/皆已完成有效比對/);
});
test('complete observed no-match differs from no collected sources and positive matches',()=>{
 assert.match(render(complete),/皆已完成有效比對，目前沒有符合這個共同標籤的影片/);
 const absent=render({...complete,sourceVideos:0,freshVideos:0});assert.match(absent,/沒有已收錄影片/);assert.doesNotMatch(absent,/皆已完成有效比對/);
 const positive=render({...complete,keywordMatchedVideos:2});assert.match(positive,/符合標籤<\/dt><dd>2 部/);assert.match(positive,/下方只列出符合這個共同標籤的影片/);assert.doesNotMatch(positive,/目前沒有符合/);
});
test('missing, unsafe or inconsistent coverage never claims completed no-match',()=>{
 for(const coverage of [{},{...complete,vocabularyVersion:null},{...complete,freshVideos:null},{...complete,staleVideos:'0'},{...complete,unprocessedVideos:-1},{...complete,sourceVideos:Infinity},{...complete,sourceVideos:Number.MAX_SAFE_INTEGER+1},{...complete,keywordMatchedVideos:0.5},{...complete,freshVideos:11},{...complete,status:'unknown'}]){
  const html=render(coverage);assert.match(html,/比對涵蓋範圍未完整提供/);assert.doesNotMatch(html,/皆已完成有效比對|NaN|Infinity/);
 }
});
test('exact subjects, scope and version are escaped and maintained vocabulary remains distinct from taxonomy',()=>{
 const html=render({...complete,vocabularyVersion:'<script>version</script>'},' AI & <img> ','<script>scope</script>');
 assert.match(html,/共同標籤「 AI &amp; &lt;img&gt; 」/);assert.match(html,/&lt;script&gt;version&lt;\/script&gt;/);assert.match(html,/&lt;script&gt;scope&lt;\/script&gt;/);
 assert.match(html,/href="\/vocabulary"/);assert.match(html,/與頻道分類分開/);assert.match(html,/文字命中不代表事件歸屬或立場/);assert.doesNotMatch(html,/<script>|<img>/);
});

test('positive partial results disclose incompleteness without calling them an empty list',()=>{
 const html=render({...complete,freshVideos:8,staleVideos:3,unprocessedVideos:1,keywordMatchedVideos:2});
 assert.match(html,/結果可能不完整/);assert.doesNotMatch(html,/空列表|皆已完成/);
 assert.match(render({...complete,sourceVideos:0,freshVideos:0},'交通','本看板範圍'),/本看板範圍沒有已收錄影片/);
});
