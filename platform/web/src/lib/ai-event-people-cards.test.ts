import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {analysisSubjects,mediaSections,peopleSections} from './ai-event-people-cards';
const setn={channelId:1635,channelTitle:'三立',channelAvatar:null};
const cite=(id:string)=>({value:id,href:'https://www.youtube.com/watch?v='+id});
test('people report rows regroup into one Laravel card per person, in supporting/opposing/other order',()=>{
 const base={role:'機關',stance:'支持',strength:'高',description:'警示'};
 const rows=[
  {...base,person:'乙',section:'其他觀點',video:null,media:null,citationStatus:'未附引用'},
  {...base,person:'甲',section:'支持',video:cite('fQ2vZziaA7g'),media:{value:'三立',sources:[setn]},citationStatus:'歷史儲存引用'},
  {...base,person:'甲',section:'支持',video:cite('0b718GAMAPs'),media:{value:'民視',sources:[]},citationStatus:'歷史儲存引用'},
  {...base,person:'甲',section:'支持',video:cite('fQ2vZziaA7g'),media:{value:'三立',sources:[setn]},citationStatus:'歷史儲存引用'},
  {...base,person:'丙',section:'反對',video:'unknown',media:{value:'自由',sources:[]},citationStatus:'識別格式無效'},
  {...base,person:'',section:'支持',video:null,media:null,citationStatus:''},
 ];
 const sections=peopleSections(rows);
 assert.deepEqual(sections.map(s=>[s.kind,s.label,s.rows.map(r=>r.person)]),[['supporting','支持者',['甲']],['opposing','反對者',['丙']],['other','其他觀點',['乙']]]);
 assert.deepEqual(sections[0]!.rows[0]!.videos,[
  {videoId:'fQ2vZziaA7g',rawId:'fQ2vZziaA7g',media:'三立',source:setn,status:'歷史儲存引用'},
  {videoId:'0b718GAMAPs',rawId:'0b718GAMAPs',media:'民視',source:null,status:'歷史儲存引用'},
 ]);
 assert.deepEqual(sections[1]!.rows[0]!.videos,[{videoId:null,rawId:'unknown',media:'自由',source:null,status:'識別格式無效'}]);
 assert.deepEqual(sections[2]!.rows[0]!.videos,[]);
});
test('media rows keep API order inside Laravel media headings',()=>{
 const sections=mediaSections([
  {media:{value:'中天',sources:[]},section:'反對',stance:'反對',strength:'低',description:'甲'},
  {media:{value:'三立',sources:[setn]},section:'支持',stance:'支持',strength:'高',description:'乙'},
 ]);
 assert.deepEqual(sections.map(s=>[s.label,s.rows.map(r=>[r.media,r.source?.channelId??null])]),[['支持媒體',[['三立',1635]]],['反對媒體',[['中天',null]]]]);
});
test('main subjects are read from the report notes; absent analyses stay null',()=>{
 assert.deepEqual(analysisSubjects(['每日來源 #1；人物分析 #2；媒體分析 #3。','人物分析主體：兩岸統戰。','媒體分析主體：未記錄；列示媒體：中天、三立。']),{people:'兩岸統戰',media:''});
 assert.deepEqual(analysisSubjects(['每日來源 #1；人物分析 尚無；媒體分析 尚無。']),{people:null,media:null});
});
