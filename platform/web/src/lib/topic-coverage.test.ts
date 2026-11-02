import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {coverageFigures,readyCoverage,relatedPage} from './topic-coverage';

const coverage={status:'ready' as const,ruleVersion:'topic-related-v1',window:{from:'',to:''},aiChannels:6,videos:828,channels:124,networks:40,possibleVideos:69,seedRecall:0.5,top:[]};
test('ready coverage leads with the channel count and names AI citations separately',()=>{
 assert.deepEqual(coverageFigures({videoCount:26,coverage}),{channels:'124 個頻道在談',related:'另有 828 支相關影片',cited:'AI 引用 26 筆'});
 assert.equal(coverageFigures({videoCount:26,coverage:{...coverage,videos:0}}).related,null);
});
test('missing or unavailable coverage keeps the old card',()=>{
 assert.deepEqual(coverageFigures({videoCount:26}),{channels:null,related:null,cited:'26 筆影片引用'});
 assert.equal(readyCoverage({coverage:{...coverage,status:'unavailable'}}),null);
 assert.equal(coverageFigures({videoCount:9,grouping:'source-signals'}).cited,'9 支引用影片（去重）');
});
test('related page is a bounded positive integer',()=>{
 assert.equal(relatedPage(undefined),1);assert.equal(relatedPage('3'),3);assert.equal(relatedPage(['2','5']),2);
 for(const bad of ['0','-1','1.5','x','201'])assert.equal(relatedPage(bad),1);
});
