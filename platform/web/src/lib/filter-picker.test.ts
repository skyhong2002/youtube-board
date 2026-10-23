import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import FilterPickerInput from '../components/FilterPickerInput';
import {filterOptionsQuery,selectedFilterIds,filterOptionsMatch} from '../../../shared/filter-options';
import {loadFilterOptions,resolveFilterSelection,composingFilterKey} from './filter-picker';
test('legacy comma selection keeps identity while spaces never become an implicit union',()=>{
 assert.deepEqual(selectedFilterIds('001,2,1'),['1','2']);assert.deepEqual(selectedFilterIds(''),[]);
 for(const value of ['1 2','1, 2','1,','0','NaN','9007199254740992'])assert.equal(selectedFilterIds(value),null);
 assert.equal(filterOptionsQuery('tags',{ids:'1',q:'a'}),null);assert.equal(filterOptionsQuery('tags',{limit:'21'}),null);
});
test('SSR picker exposes selected names and keeps unavailable IDs removable without fabricated labels',()=>{
 const html=renderToStaticMarkup(createElement(FilterPickerInput,{name:'tagid',label:'同時符合分類',kind:'tags',value:'1,2,3',initial:[{id:'1',label:'真實分類名'}],failedIds:['3']}));
 assert.match(html,/name="tagid" value="1,2,3"/);assert.match(html,/真實分類名/);assert.match(html,/所選分類 #2/);assert.match(html,/名稱暫時無法讀取/);assert.match(html,/aria-label="移除所選分類 #2/);assert.doesNotMatch(html,/type="number"/);
 const invalid=renderToStaticMarkup(createElement(FilterPickerInput,{name:'tagid',label:'分類',kind:'tags',value:'1 2',initial:[]}));assert.match(invalid,/name="tagid" value="1 2"/);assert.match(invalid,/已保留原值/);
});
test('one taxonomy pill submits the list of its current match mode and names that mode',()=>{
 const modes=[{name:'or',label:'符合任一',description:'任一'},{name:'tagid',label:'全部符合',description:'全部'}];
 const all=renderToStaticMarkup(createElement(FilterPickerInput,{name:'tagid',label:'分類',kind:'tags',value:'1,2',initial:[{id:'1',label:'社論'},{id:'2',label:'新聞'}],layout:'pill',modes}));
 assert.match(all,/<input type="hidden" name="tagid" value="1,2"\/>/);
 assert.match(all,/分類<\/span>（全部符合）：社論、新聞/);
 const any=renderToStaticMarkup(createElement(FilterPickerInput,{name:'or',label:'分類',kind:'tags',value:'',initial:[],layout:'pill',modes}));
 assert.match(any,/<input type="hidden" name="or" value=""\/>/);
 assert.doesNotMatch(any,/（符合任一）/);
});
test('option requests forward cancellation and distinguish unavailable or malformed results',async()=>{
 const controller=new AbortController();let captured:AbortSignal|null|undefined;
 const fetcher=(async(_url,init)=>{captured=init?.signal;return new Response(JSON.stringify({kind:'tags',rows:[],hasMore:false,missingIds:[]}));}) as typeof fetch;
 assert.deepEqual((await loadFilterOptions('tags','交通',controller.signal,fetcher)).rows,[]);assert.equal(captured,controller.signal);
 await assert.rejects(loadFilterOptions('tags','x',controller.signal,(async()=>new Response('{}',{status:503})) as typeof fetch),/OPTIONS_UNAVAILABLE/);
 await assert.rejects(loadFilterOptions('tags','x',controller.signal,(async()=>new Response('{}')) as typeof fetch),/INVALID_OPTIONS_RESPONSE/);
 const pending=loadFilterOptions('tags','x',controller.signal,((_,init)=>new Promise((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError'))))) as typeof fetch);controller.abort();await assert.rejects(pending,{name:'AbortError'});
});

test('duplicate selection parameters remain visibly invalid without silently dropping conditions',()=>{
 const html=renderToStaticMarkup(createElement(FilterPickerInput,{name:'tagid',label:'分類',kind:'tags',value:['1','2'],initial:[]}));
 assert.match(html,/name="tagid" value="1"/);assert.match(html,/name="tagid" value="2"/);assert.match(html,/格式無法辨識/);assert.match(html,/<button[^>]+disabled=""[^>]+aria-expanded="false"/);
 const channel=renderToStaticMarkup(createElement(FilterPickerInput,{name:'channelId',label:'指定頻道',kind:'channels',value:'990002',multiple:false,initial:[{id:'990002',label:'來源頻道'}]}));
 assert.match(channel,/name="channelId" value="990002"/);assert.doesNotMatch(channel,/name="channelIds"/);
 const same=renderToStaticMarkup(createElement(FilterPickerInput,{name:'tagid',label:'分類',kind:'tags',value:'1,2',initial:[{id:'1',label:'同名'},{id:'2',label:'同名'}]}));
 assert.match(same,/aria-label="移除同名 #1"/);assert.match(same,/aria-label="移除同名 #2"/);
});
test('lookup responses must exactly partition requested identities and search respects its limit',()=>{
 const data={kind:'tags',rows:[{id:'1',label:'甲'}],hasMore:false,missingIds:['2']};
 assert.equal(filterOptionsMatch(data,{kind:'tags',ids:['1','2'],limit:20}),true);
 for(const broken of [{...data,missingIds:['1']},{...data,missingIds:[]},{...data,missingIds:['3']},{...data,hasMore:true}])assert.equal(filterOptionsMatch(broken,{kind:'tags',ids:['1','2'],limit:20}),false);
 assert.equal(filterOptionsMatch({...data,missingIds:[]},{kind:'tags',ids:[],limit:1}),true);
 assert.equal(filterOptionsMatch({...data,rows:[{id:'1',label:'甲'},{id:'2',label:'乙'}],missingIds:[]},{kind:'tags',ids:[],limit:1}),false);
});
test('selected resolution batches at20 with concurrency3 and isolates failures or identity drift',async()=>{
 const values=Array.from({length:80},(_,i)=>String(i+1)),calls:string[][]=[];let pending=0,max=0;
 const result=await resolveFilterSelection('tags',values.join(','),async ids=>{calls.push(ids);pending++;max=Math.max(max,pending);await new Promise(resolve=>setTimeout(resolve,5));pending--;if(ids[0]==='21')throw new Error('unavailable');if(ids[0]==='41')return {kind:'tags',rows:[{id:'999',label:'wrong identity'}],hasMore:false,missingIds:ids.slice(1)};return {kind:'tags',rows:ids.map(id=>({id,label:'分類'+id})),missingIds:[],hasMore:false};});
 assert.deepEqual(calls.map(c=>c.length),[20,20,20,20]);assert.equal(max,3);assert.equal(result.initial.length,40);assert.deepEqual(result.failedIds,values.slice(20,60));assert.ok(result.initial.every(row=>values.includes(row.id)));
 let read=false;assert.deepEqual(await resolveFilterSelection('tags',['1','2'],async()=>{read=true;}),{initial:[],failedIds:[]});assert.equal(read,false);
});

test('IME candidate keys never become picker navigation, including Safari keyCode229',()=>{
 assert.equal(composingFilterKey({isComposing:true}),true);assert.equal(composingFilterKey({keyCode:229}),true);assert.equal(composingFilterKey({},true),true);assert.equal(composingFilterKey({isComposing:false,keyCode:13},false),false);
});
