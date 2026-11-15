import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import type {ContentLookup} from '../../../shared/content-admin';
import ContentIntake,{ContentStatus} from '../app/admin/ContentIntake';
import ChannelTools,{TagPicker} from '../app/admin/ChannelTools';

const empty:ContentLookup={source:'https://youtu.be/abcdefghijk',videoId:'abcdefghijk',channel:null,video:null,live:null,matches:[],generatedAt:'2026-11-15T00:00:00.000Z'};
const html=(lookup:ContentLookup)=>renderToStaticMarkup(createElement(ContentStatus,{lookup,onEdit:()=>{}}));
test('lookup absent observations do not claim successful collection or known owner',()=>{
 const out=html(empty);assert.match(out,/尚未收錄/);assert.match(out,/沒有直播追蹤紀錄/);assert.match(out,/尚無可確認的收錄紀錄/);assert.match(out,/送出後會由 YouTube 核對/);assert.doesNotMatch(out,/href="\/videos/);
});
test('collected observations link video, live and channel reports, escape metadata, and explain cache lag',()=>{
 const out=html({...empty,video:{videoId:'abcdefghijk',title:'<img src=x onerror=1>',channelId:42,collectedAt:null},live:{videoId:'abcdefghijk',title:'live',channelId:42,retired:false},channel:{channelId:42,youtubeChannelId:'UCabcdefghijklmnopqrstuv',title:'<script>bad</script>',tags:[1],archived:false}});
 assert.match(out,/href="\/videos\/abcdefghijk"/);assert.match(out,/href="\/live\/videos\/abcdefghijk\/trend"/);assert.match(out,/href="\/channels\/42"/);assert.match(out,/增減頻道標籤/);assert.match(out,/快取更新/);assert.match(out,/已納入追蹤/);assert.doesNotMatch(out,/<img src=x|<script>/);
});
test('retired source records clearly distinguish archived channel and stopped live',()=>{
 const out=html({...empty,live:{videoId:'abcdefghijk',title:'old',channelId:42,retired:true},channel:{channelId:42,youtubeChannelId:'UCabcdefghijklmnopqrstuv',title:'old',tags:[],archived:true}});
 assert.match(out,/已停止追蹤/);assert.match(out,/已封存/);assert.doesNotMatch(out,/已納入追蹤/);
});
test('new workspace opens intake first and keeps old history secondary',()=>{
 const data={channels:[],tags:[],generatedAt:'2026-11-15T00:00:00.000Z',quietDays:30,staleDays:3};
 const out=renderToStaticMarkup(createElement(ChannelTools,{data,editing:null,onEdit:()=>{},onApplied:()=>{}}));
 assert.match(out,/YouTube 內容與頻道標籤/);assert.doesNotMatch(out,/搜尋已收錄內容|管理方式/);assert.match(out,/安裝快速管理書籤/);assert.doesNotMatch(out,/建立新標籤|收起工具|開啟工具/);assert.match(out,/最近的變更/);assert.doesNotMatch(out,/<details/);
 const intake=renderToStaticMarkup(createElement(ContentIntake,{tags:[],channels:[],onQueued:()=>{},onEdit:()=>{},refreshKey:''}));assert.match(intake,/貼上網址後會自動檢查/);assert.doesNotMatch(intake,/已送出/);assert.match(intake,/aria-label="加入時的頻道標籤"/);assert.doesNotMatch(intake,/<details/);assert.match(intake,/lg:grid-cols-3/);
});

test('channel tags all stay visible without a nested scroll area',()=>{
 const tags=Array.from({length:120},(_,i)=>({id:i+1,name:`分類 ${i+1}`}));
 const picker=renderToStaticMarkup(createElement(TagPicker,{tags,selected:new Set([120]),onToggle:()=>{},label:'分類'}));
 assert.equal((picker.match(/aria-pressed=/g)||[]).length,120);
 assert.match(picker,/aria-pressed="true"[^>]*>分類 120/);
 assert.doesNotMatch(picker,/max-h-|overflow-y-auto/);
 const intake=renderToStaticMarkup(createElement(ContentIntake,{tags,channels:[],onQueued:()=>{},onEdit:()=>{},refreshKey:''}));
 assert.equal((intake.match(/type="checkbox"/g)||[]).length,120);
 assert.doesNotMatch(intake,/max-h-|overflow-y-auto/);
});
