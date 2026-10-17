import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import type {ReportData} from '../../../api/src/report-contracts';
import {aspectConditionHref,aspectFilterChips,aspectFilters,aspectRows,aspectTitle,tagLookupSearch,visibleChannelTags} from './ai-aspects-board';
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
test('rows keep missing scores empty and compute 傾向 with missing as zero',()=>{
 const data={rows:[
  {channel:{value:'苗博雅',href:'/channels/495',media:{kind:'channel',channelId:495,avatar:null}},台灣:{value:9,detail:'台'},泛綠:{value:9,detail:''},泛白:{value:5,detail:''},泛藍:{value:2,detail:''},泛紅:{value:1,detail:''},中國:{value:1,detail:''},source:{value:'#573',href:'/channels/495/ai?pk=573'}},
  {channel:{value:'某台',href:'/channels/7'},台灣:{value:3,detail:''},泛綠:null,泛白:null,泛藍:{value:6,detail:''},泛紅:null,中國:null,source:{value:'#9'}},
  {channel:{value:'空台',href:'/channels/8'},source:null},
 ]} as unknown as Pick<ReportData,'rows'>;
 const [a,b,c]=aspectRows(data);
 assert.deepEqual([a!.channelId,a!.balance,a!.partial,a!.scores.台灣,a!.source],[495,19,false,{value:9,detail:'台'},{label:'#573',href:'/channels/495/ai?pk=573'}]);
 assert.deepEqual([b!.channelId,b!.balance,b!.partial,b!.scores.泛綠.value,b!.source],[7,-3,true,null,null]);
 assert.deepEqual([c!.balance,c!.partial],[null,false]);
});
test('only the tags Laravel printed are kept, and the lookup narrows by the page selection',()=>{
 const tags=visibleChannelTags([{id:1,tags:[{id:12,name:'電視台',kind:'channel'},{id:4,name:'泛綠',kind:'channel'},{id:1,name:'社論',kind:'channel'}]}]);
 assert.deepEqual(tags.get(1)!.map(t=>t.name),['泛綠','社論']);
 assert.deepEqual(tagLookupSearch(aspectFilters({condition:'neutral',or:'2'})),{or:'1,2,3,4,5,6,60,43,48,49,81',not:'3,4,5,6,31,41',limit:'200'});
 assert.deepEqual(tagLookupSearch(aspectFilters({condition:'blue'})),{or:'1,2,3,4,5,6,60,43,48,49,81',tagid:'3',limit:'200'});
});
