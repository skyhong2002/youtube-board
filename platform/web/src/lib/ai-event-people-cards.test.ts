import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import type {EventCitation,EventPresentation} from '../../../api/src/contracts';
import {mediaSections,peopleSections} from './ai-event-people-cards';
const setn={channelId:1635,channelTitle:'三立',channelAvatar:null};
const cite=(rawId:string,media:string,verification:EventCitation['verification']='stored-reference',sourceChannel?:typeof setn):EventCitation=>{
 const id=/^[A-Za-z0-9_-]{11}$/.test(rawId)?rawId:null;
 return {id,rawId,media,verification,href:id&&verification!=='outside-snapshot'?'https://www.youtube.com/watch?v='+id:null,...(sourceChannel?{sourceChannel}:{})};
};
const person=(name:string,citations:EventCitation[])=>({person:name,role:'機關',stance:'支持',strength:'高',description:'警示',citations});
test('people groups become one Laravel card per person, in supporting/opposing/other order',()=>{
 const people:EventPresentation['people']={analysisId:2,mainSubject:'兩岸統戰',groups:[
  {kind:'other',rows:[person('乙',[cite('','')])]},
  {kind:'opposing',rows:[person('丙',[cite('unknown','自由','invalid'),cite('0b718GAMAPs','民視','outside-snapshot')])]},
  {kind:'supporting',rows:[person('甲',[cite('fQ2vZziaA7g','三立','stored-reference',setn),cite('0b718GAMAPs','民視')])]},
 ]};
 const sections=peopleSections(people);
 assert.deepEqual(sections.map(s=>[s.kind,s.label,s.rows.map(r=>r.person)]),[['supporting','支持者',['甲']],['opposing','反對者',['丙']],['other','其他觀點',['乙']]]);
 assert.deepEqual(sections[0]!.rows[0]!.videos,[
  {videoId:'fQ2vZziaA7g',rawId:'fQ2vZziaA7g',media:'三立',source:setn,status:''},
  {videoId:'0b718GAMAPs',rawId:'0b718GAMAPs',media:'民視',source:null,status:''},
 ]);
 assert.deepEqual(sections[1]!.rows[0]!.videos.map(v=>[v.videoId,v.rawId,v.status]),[[null,'unknown','識別格式無效'],[null,'0b718GAMAPs','不屬於生成時來源']]);
 assert.deepEqual(sections[2]!.rows[0]!.videos,[],'a citation without a video id is not listed, as in Laravel');
 assert.deepEqual(peopleSections(null),[]);
});
test('media groups keep stored order inside Laravel media headings and skip empty groups',()=>{
 const media:EventPresentation['media']={analysisId:3,mainSubject:'',all:['中天','三立'],groups:[
  {kind:'supporting',rows:[{media:'三立',sourceChannel:setn,stance:'支持',strength:'高',description:'乙'}]},
  {kind:'opposing',rows:[{media:'中天',stance:'反對',strength:'低',description:'甲'}]},
  {kind:'other',rows:[]},
 ]};
 assert.deepEqual(mediaSections(media).map(s=>[s.label,s.rows.map(r=>[r.media,r.source?.channelId??null])]),[['支持媒體',[['三立',1635]]],['反對媒體',[['中天',null]]]]);
});
