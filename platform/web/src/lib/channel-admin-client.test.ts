import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {ChannelAdminRequest} from '../../../shared/channel-admin';
import {requestOutcome,requestSummary,tagChange,tagString} from './channel-admin-client';

const names={tag:(id:number)=>({1:'社論',5:'泛藍'} as Record<number,string>)[id]??`#${id}`,channel:(uId:number)=>uId===3?'甲台':`頻道 #${uId}`};
const base={id:1,requestId:'3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b',actor:'user:1',errorCode:null,result:null,createdAt:'2026-10-26T19:00:00.000Z',appliedAt:null};
const set=(over:Partial<ChannelAdminRequest>):ChannelAdminRequest=>({...base,kind:'set-tags',payload:{kind:'set-tags',uId:3,add:[5],remove:[1]},status:'pending',...over}as ChannelAdminRequest);

test('a request is described with the names the administrator sees',()=>{
 assert.equal(requestSummary(set({}),names),'甲台：加入 「泛藍」，移除 「社論」');
 assert.equal(requestSummary(set({payload:{kind:'set-tags',uId:9,add:[],remove:[1]}}),names),'頻道 #9：移除 「社論」');
 assert.equal(requestSummary(set({kind:'create-tag',payload:{kind:'create-tag',name:'新分類'}}),names),'新增分類「新分類」');
 assert.equal(requestSummary(set({kind:'add-channel',payload:{kind:'add-channel',source:'@abc.def',tags:[1,5]}}),names),'新增頻道 @abc.def，分類 「社論」、「泛藍」');
 assert.equal(requestSummary(set({kind:'add-channel',payload:{kind:'add-channel',source:'UCabcdefghijklmnopqrstuv',tags:[]}}),names),'新增頻道 UCabcdefghijklmnopqrstuv');
});

test('the outcome says whether it is waiting, applied or refused, and why',()=>{
 assert.match(requestOutcome(set({status:'pending'})),/等待套用/);
 assert.equal(requestOutcome(set({status:'failed',errorCode:'TAGS_TOO_LONG'})),'這個頻道的分類已滿（上限約 20 個）');
 assert.equal(requestOutcome(set({status:'failed',errorCode:null})),'未能套用');
 assert.equal(requestOutcome(set({status:'done',result:{added:[5],removed:[1]}})),'已套用（加入 1、移除 1）');
 assert.equal(requestOutcome(set({status:'done',result:{added:[],removed:[]}})),'沒有變動，分類本來就是這樣');
 assert.equal(requestOutcome(set({status:'done',kind:'add-channel',payload:{kind:'add-channel',source:'UCabcdefghijklmnopqrstuv',tags:[]},result:{uId:4155,created:true}})),'已新增為 #4155，統計與影片稍後補齊');
 assert.equal(requestOutcome(set({status:'done',kind:'add-channel',payload:{kind:'add-channel',source:'UCabcdefghijklmnopqrstuv',tags:[]},result:{uId:12,created:false}})),'已有此頻道（#12），沒有重複新增');
 assert.equal(requestOutcome(set({status:'done',kind:'create-tag',payload:{kind:'create-tag',name:'x'},result:{tagId:115,created:true}})),'已建立，編號 115');
 assert.equal(requestOutcome(set({status:'done',kind:'create-tag',payload:{kind:'create-tag',name:'x'},result:{tagId:115,created:false}})),'已有同名分類（#115）');
 // A result the worker never wrote must not break the row.
 assert.equal(requestOutcome(set({status:'done',result:null})),'沒有變動，分類本來就是這樣');
});

test('toggling categories yields the delta to send, nothing when unchanged, and a refusal when the column would overflow',()=>{
 assert.deepEqual(tagChange([1,2],[2,5]),{add:[5],remove:[1],problem:null});
 assert.deepEqual(tagChange([1,2],[2,1]),{add:[],remove:[],problem:'none'});
 assert.equal(tagString([1,12]),'[1][12]');
 const nearlyFull=Array.from({length:19},(_,i)=>100+i);
 assert.equal(tagChange([...nearlyFull,1],[...nearlyFull,1,2]).problem,'full');
 assert.equal(tagChange([...nearlyFull,1],[...nearlyFull,2]).problem,null);
});
