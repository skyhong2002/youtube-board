import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import type {TopicRow} from '../../../api/src/contracts';
import {topicVideoId} from './topic-video';

const topic=(evidence:Partial<TopicRow['evidence'][number]>[],videos:string[]=[]):TopicRow=>({id:'1:0',dailyId:1,title:'議題',channelCount:evidence.length,videoCount:0,score:0,keywords:[],people:[],unresolvedReferences:[],
 evidence:evidence.map((e,i)=>({channelId:i+1,channelTitle:`台${i}`,event:'事件',videoIds:[],keywords:[],people:[],source:{table:'urt_channel_ai',id:i+1},...e})),
 summary:{keywords:[],people:[],party:{green:0,blue:0},angle:{taiwan:0,china:0},camp:{dpp:0,kmt:0},videos:videos.map(videoId=>({videoId,channelId:1,channelTitle:'台0',event:'事件'}))}});

test('a locally resolved reference wins',()=>{
 assert.equal(topicVideoId(topic([{videoIds:['Resolved001','Summary0001'],resolvedVideoIds:['Resolved001']}],['Summary0001']),{live:[]}),'Resolved001');
});
test('immutable snapshots without local resolution use the summary representative video',()=>{
 assert.equal(topicVideoId(topic([{videoIds:['Summary0001']}],['Summary0001']),{live:[]}),'Summary0001');
});
test('without resolution or summary only a cited live video is used',()=>{
 const t={...topic([{videoIds:['LiveVideo01']}]),summary:undefined};
 assert.equal(topicVideoId(t,{live:[{id:'LiveVideo01'}] as never}),'LiveVideo01');
 assert.equal(topicVideoId(t,{live:[]}),null);
});
