import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import type {AiEventData,EventCitation,VideoRow} from '../../../api/src/contracts';
import {OTHER_VIDEO_LIMIT,wallVideos} from './ai-event-wall-videos';
const cite=(id:string,media='',href=true):EventCitation=>({id,rawId:id,media,href:href?'https://www.youtube.com/watch?v='+id:null,verification:'stored-reference'});
const video=(id:string,title:string):VideoRow=>({id,channelId:7,youtubeChannelId:'UC7',channelTitle:'七台',title,description:'',thumbnail:null,publishedAt:null,views:null,likes:null,comments:null,updatedAt:null} as VideoRow);
test('the wall lists fact, opinion and then people citations once each, like Laravel',()=>{
 const data={videos:[video('Person00001','人物影片'),video('Unrelated01','未引用'),video('Fact0000001','事實影片')],presentation:{
  summaries:[{analysisId:1,title:'',description:'',keywords:[],media:[],facts:[{headline:'事實標題',citation:cite('Fact0000001','甲台')},{headline:'無連結',citation:cite('bad',"甲台",false)}],opinions:[{stance:'',intensity:'',content:'觀點內容',citation:cite('Opinion0001','乙台')},{stance:'',intensity:'',content:'重複',citation:cite('Fact0000001','甲台')}]}],
  people:{analysisId:2,mainSubject:'',groups:[
   {kind:'other' as const,rows:[{person:'丁',role:'',stance:'',strength:'',description:'',citations:[cite('Other000001')]}]},
   {kind:'supporting' as const,rows:[{person:'丙',role:'',stance:'',strength:'',description:'',citations:[cite('Person00001'),cite('Opinion0001')]}]},
  ]},media:null}} satisfies Pick<AiEventData,'presentation'|'videos'>;
 const wall=wallVideos(data);
 assert.deepEqual(wall.cited.map(v=>[v.videoId,v.label,v.media,v.kind,v.title]),[
  ['Fact0000001','事實標題','甲台','fact','事實影片'],
  ['Opinion0001','觀點內容','乙台','opinion',null],
  ['Person00001','丙','七台','supporting','人物影片'],
  ['Other000001','丁','','other',null],
 ]);
 assert.equal(wall.cited[2]!.source?.channelId,7);
 assert.deepEqual(wall.others.map(v=>[v.videoId,v.label,v.kind]),[['Unrelated01','未引用','source']]);
 assert.equal(wall.othersTotal,1);
});
test('uncited source videos are capped',()=>{
 const videos=Array.from({length:OTHER_VIDEO_LIMIT+5},(_,i)=>video('Video'+String(i).padStart(6,'0'),'v'+i));
 const wall=wallVideos({videos,presentation:{summaries:[],people:null,media:null}});
 assert.equal(wall.cited.length,0);assert.equal(wall.others.length,OTHER_VIDEO_LIMIT);assert.equal(wall.othersTotal,OTHER_VIDEO_LIMIT+5);
});
