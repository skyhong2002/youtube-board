import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {parseKeywordIllustration,KeywordIllustrationView} from '../components/KeywordIllustration';
import {tagPicturePath} from '../../../shared/tag-illustration';
const keyword='沈伯洋',image=tagPicturePath(keyword,'avatar','t3-1');
const body=(illustration:unknown,status='available')=>({data:{keyword,source:'https://tag.observe.tw',status,illustration},meta:{schemaVersion:1}});
const picture={kind:'avatar',label:keyword,image,emoji:null,attribution:{pageUrl:'https://commons.wikimedia.org/wiki/File:Example.jpg',license:'CC BY-SA 4.0',licenseUrl:'https://creativecommons.org/licenses/by-sa/4.0/',artist:'範例作者'}};
const html=(data:unknown)=>renderToStaticMarkup(createElement(KeywordIllustrationView,{view:parseKeywordIllustration(data,keyword)}));
test('maintained picture uses only same-origin source with visible author and license',()=>{
 const output=html(body(picture));assert.match(output,/src="\/media\/tag-illustrations\//);assert.match(output,/圖片來源：新文易數/);assert.match(output,/範例作者/);assert.match(output,/CC BY-SA 4\.0/);assert.match(output,/referrerPolicy="no-referrer"/i);
});
test('empty, disabled and failed source data are distinct',()=>{
 assert.match(html(body(null)),/尚未收錄/);assert.equal(html(body(null,'disabled')),'');assert.match(html(body(null,'unavailable')),/暫時無法讀取/);
 assert.doesNotMatch(html(body(null,'unavailable')),/尚未收錄/);
});
test('external/wrong-tag image, unsafe license link and malformed data are never rendered',()=>{
 for(const p of [{...picture,image:'https://evil.example/image'},{...picture,image:tagPicturePath('另一詞','avatar','t3-1')},{...picture,attribution:{...picture.attribution,pageUrl:'javascript:alert(1)'}},{...picture,emoji:'invalid'}]){const result=html(body(p));assert.match(result,/暫時無法讀取/);assert.doesNotMatch(result,/<img|javascript:|evil\.example/);}
 assert.equal(parseKeywordIllustration({...body(picture),data:{...body(picture).data,keyword:'另一詞'}},keyword).kind,'unavailable');
});
test('copies only recognised source data and escapes labels/author text',()=>{
 const view=parseKeywordIllustration(body({...picture,label:'<script>alert(1)</script>',debug:'SECRET',attribution:{...picture.attribution,artist:'<b>author</b>',token:'SECRET'}}),keyword);
 assert.doesNotMatch(JSON.stringify(view),/SECRET/);const output=renderToStaticMarkup(createElement(KeywordIllustrationView,{view}));assert.doesNotMatch(output,/<script|<b>/);assert.match(output,/&lt;b&gt;author/);
});
test('reviewed emoji visual is shown without an image request',()=>{
 const output=html(body({kind:'emoji',label:'鐵路',image:null,emoji:'🚆',attribution:null}));assert.match(output,/🚆/);assert.doesNotMatch(output,/<img/);
});
