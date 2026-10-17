import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {existsSync,readFileSync,readdirSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ReportMethod,metaNotes} from '../components/ReportMethod';
import {DataNotice,Heading} from '../components/ReportUI';
import type {ReportMeta} from '../../../api/src/contracts';

const meta=(warnings:string[],dataset:ReportMeta['dataset']='live'):ReportMeta=>({schemaVersion:1,requestedAt:'2026-10-17T00:00:00Z',updatedAt:'2026-10-17T03:00:00Z',timezone:'Asia/Taipei',source:'mariadb',dataset,warnings,coverage:{}});
const render=(path:string,props:Partial<Parameters<typeof ReportMethod>[0]>={})=>renderToStaticMarkup(createElement(ReportMethod,{path,...props}));

test('a report method block is the tag.observe.tw footer disclosure: blocks, page notes, 資料來源, full write-up link',()=>{
 const html=render('/channels',{description:'查看頻道的收錄影片。',notes:['目前門檻：累計觀看至少 1,000。'],meta:meta(['此處為 YouTube 頻道分類。'])});
 assert.match(html,/^<details[^>]*data-page-method=""/);
 assert.match(html,/<summary[^>]*><span>本頁的資料來源與計算方式<span[^>]*>ⓘ<\/span><\/span>/);
 assert.match(html,/<div id="method" class="max-w-3xl scroll-mt-32 space-y-2.5 pb-5 text-\[13px\] leading-\[1.9\]">/);
 // 「標籤：說明」 notes read as a term list after the plain paragraphs, as the blocks' <dl>s.
 const order=['>頻道觀測的指標<','>本頁資料範圍<','查看頻道的收錄影片。','此處為 YouTube 頻道分類。','>目前門檻</dt><dd>累計觀看至少 1,000。</dd>','>資料來源<','完整的資料來源與計算方式 →'].map(label=>html.indexOf(label));
 assert.ok(order.every((at,i)=>at>=0&&(i===0||at>order[i-1]!)),String(order));
 assert.match(html,/href="\/about"/);
});

test('report paths pick the blocks that explain them',()=>{
 const cases:Array<[string,string[],string[]]>=[
  ['/live/current',['直播觀測'],['頻道觀測的指標']],
  ['/videos/AbCdEfGh123',['影片的數字','共同標籤'],['直播觀測']],
  ['/channels/42/videos',['影片的數字','頻道觀測的指標'],[]],
  ['/channels/42/ai/days',['AI 議題','頻道觀測的指標'],[]],
  ['/ai/days',['AI 議題'],['影片的數字']],
  ['/tags/13/channels',['頻道分類','頻道觀測的指標'],[]],
  ['/groups/news/trends',['頻道群組'],[]],
  ['/mayor/cities/taipei',['地方選戰觀測','聲量占比'],[]],
  ['/comments/authors/abc',['留言觀測'],[]],
  ['/keywords/%E4%BA%A4%E9%80%9A/videos',['共同標籤'],[]],
 ];
 for(const [path,present,absent] of cases){
  const html=render(path);
  for(const label of present)assert.ok(html.includes(`>${label}<`),`${path} → ${label}`);
  for(const label of absent)assert.ok(!html.includes(`>${label}<`),`${path} ✕ ${label}`);
  assert.ok(html.includes('>資料來源<'),path);
 }
});

test('the head keeps one line: update time and the method link; scope warnings move to the method block',()=>{
 const m=meta(['此處為 YouTube 頻道分類；共用新聞內容詞彙請見 /vocabulary。']);
 const head=renderToStaticMarkup(createElement(Heading,{title:'頻道分類',meta:m}));
 assert.match(head,/更新於 .* · 台北時間 · <a href="#method"[^>]*>本頁的資料來源與計算方式(<!-- -->)? ⓘ<\/a>/);
 assert.doesNotMatch(renderToStaticMarkup(createElement(Heading,{title:'無法讀取',method:false})),/#method/);
 assert.equal(renderToStaticMarkup(createElement(DataNotice,{meta:m})),'');
 assert.deepEqual(metaNotes(m),m.warnings);
 // Development data still warns on the page, and its own warning is not repeated below.
 const fixture=meta(['此環境使用合成範例 YouTube 資料。'],'fixture');
 assert.match(renderToStaticMarkup(createElement(DataNotice,{meta:fixture})),/開發驗證資料/);
 assert.deepEqual(metaNotes(fixture),[]);
});

test('every page heading that links to #method renders a method block of its own',()=>{
 const root=existsSync(join(process.cwd(),'src/app'))?join(process.cwd(),'src'):join(process.cwd(),'platform/web/src');
 const files=(dir:string):string[]=>readdirSync(dir).flatMap(name=>{const path=join(dir,name);return statSync(path).isDirectory()?files(path):/\.tsx$/.test(name)?[path]:[];});
 for(const file of files(root)){
  const source=readFileSync(file,'utf8');
  const headings=(source.match(/<Heading\b[^>]*>/g)??[]).filter(tag=>!/method=\{false\}/.test(tag));
  const links=headings.length+(source.match(/<MethodLink\b/g)??[]).length;
  // Shared heads (ReportUI, EventHeader) are checked through the pages that use them.
  if(!links||/components\/(ReportUI|MethodLink|EventHeader)\.tsx$/.test(file))continue;
  assert.match(source,/<(ReportMethod|PageMethod)\b/,file);
 }
});
