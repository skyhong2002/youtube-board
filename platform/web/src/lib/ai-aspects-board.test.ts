import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import type {AspectReportData} from '../../../api/src/report-contracts';
import {aspectConditionHref,aspectFilterChips,aspectFilters,aspectRows,aspectTagNames,aspectTitle} from './ai-aspects-board';
const names=new Map([[3,'泛藍'],[4,'泛綠'],[31,'財經'],[2,'政治人物']]);
test('conditions replace the tag selection the way AiAspectReport did, and drive the Laravel title',()=>{
 const blue=aspectFilters({condition:'blue',tagid:'2',or:'31',limit:'50'});
 assert.deepEqual(blue,{condition:'blue',tagid:[3],or:[31],not:[],limit:50});
 assert.equal(aspectTitle(blue,names),'泛藍 財經 立場分布表');
 const neutral=aspectFilters({condition:'neutral'});
 assert.deepEqual(neutral.not,[3,4,5,6,31,41]);
 assert.equal(aspectTitle(neutral,names),'中立頻道 立場分布表');
 assert.equal(aspectTitle(aspectFilters({}),names),'全部頻道 立場分布表');
 assert.equal(aspectTitle(aspectFilters({tagid:'99'}),names),'99 立場分布表');
 assert.equal(aspectFilters({condition:'other'}).condition,null);
 assert.deepEqual(aspectFilterChips(blue,names),[{label:'條件',value:'泛藍'},{label:'全部包含',value:'泛藍'},{label:'包含任一',value:'財經'},{label:'每頁',value:'50 筆'}]);
});
test('switcher links drop tag filters and the offset but keep other parameters',()=>{
 const search={condition:'blue',tagid:'2',or:'1',not:'5',offset:'100',limit:'50'};
 assert.equal(aspectConditionHref('/ai/aspects',search,'green'),'/ai/aspects?limit=50&condition=green');
 assert.equal(aspectConditionHref('/ai/aspects',{offset:'100'},'all'),'/ai/aspects');
});
test('rows read 傾向 and visible tags from the API, keeping missing scores empty',()=>{
 const data={rows:[
  {channel:{value:'苗博雅',href:'/channels/495',media:{kind:'channel',channelId:495,avatar:null}},台灣:{value:9,detail:'台'},泛綠:{value:9,detail:''},泛白:{value:5,detail:''},泛藍:{value:2,detail:''},泛紅:{value:1,detail:''},中國:{value:1,detail:''},balance:{value:19,detail:''},source:{value:'#573',href:'/channels/495/ai?pk=573'}},
  {channel:{value:'某台',href:'/channels/7'},台灣:{value:3,detail:''},泛綠:null,泛白:null,泛藍:{value:6,detail:''},泛紅:null,中國:null,balance:{value:-3,detail:'部分分數缺值，以 0 計入'},source:{value:'#9'}},
  {channel:{value:'空台',href:'/channels/8'},balance:{value:null,detail:''},source:null},
 ],channelTags:{'495':[{id:4,name:'泛綠'},{id:1,name:'社論'}]}} as unknown as AspectReportData;
 const [a,b,c]=aspectRows(data);
 assert.deepEqual([a!.channelId,a!.balance,a!.partial,a!.scores.台灣,a!.source,a!.tags.map(t=>t.name)],[495,19,false,{value:9,detail:'台'},{label:'#573',href:'/channels/495/ai?pk=573'},['泛綠','社論']]);
 assert.deepEqual([b!.channelId,b!.balance,b!.partial,b!.scores.泛綠.value,b!.source,b!.tags],[7,-3,true,null,null,[]]);
 assert.deepEqual([c!.balance,c!.partial],[null,false]);
 assert.deepEqual(aspectRows({rows:data.rows})[0]!.tags,[]);
});
test('filter tag names come from the API response, ids stand in when absent',()=>{
 const names=aspectTagNames({filterTags:[{id:3,name:'泛藍'},{id:2,name:'政治人物'}]});
 assert.equal(aspectTitle(aspectFilters({condition:'blue',or:'2,77'}),names),'泛藍 政治人物 77 立場分布表');
 assert.equal(aspectTagNames({}).size,0);
});
