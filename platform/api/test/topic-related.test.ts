import {describe,expect,it} from 'vitest';
import {matchTopics,topicCoverage,topicRelatedCache,withTopicCoverage,TOPIC_RELATED_RULE,type CandidateVideo,type TopicInput} from '../src/reports/topic-related.js';
import type { TopicRow } from '../src/contracts.js';
import type {Reader} from '../src/db/client.js';

let seq=0;
const video=(title:string,extra:Partial<CandidateVideo>={}):CandidateVideo=>({videoId:`vid${String(++seq).padStart(8,'0')}`,channelId:1000+seq,channelTitle:`台${seq}`,title,description:'',publishedAt:'2026-10-31 12:00:00',views:seq,tags:[],...extra});
const topic=(id:string,people:string[],keywords:string[],seeds:string[]=[],channelId=1):TopicInput=>({id,title:id,people,keywords,evidence:[{channelId,channelTitle:'AI台',event:'事件',videoIds:seeds,keywords:[],people:[],source:{table:'urt_channel_ai',id:1}}]});
/** Filler keeps keyword document frequency below the generic-word cut. */
const filler=(n:number)=>Array.from({length:n},(_,i)=>video(`天氣晴朗 第${i}則`));

describe('topic related videos',()=>{
 it('needs a named person and an event word in the title; the description only adds weight',()=>{
  const debate=topic('debate',['蔣萬安','沈伯洋'],['首場辯論','九連問']);
  const hit=video('沈伯洋九連問 蔣萬安這樣回'),personOnly=video('沈伯洋今天去市場'),descOnly=video('沈伯洋談政見',{description:'首場辯論精華'}),eventOnly=video('首場辯論誰贏了');
  const m=matchTopics([debate],[hit,personOnly,descOnly,eventOnly,...filler(200)]).get('debate')!;
  expect(m.primary.map(v=>v.videoId)).toEqual([hit.videoId]);
  expect(m.primary[0]!.matchedTerms).toEqual(['蔣萬安','沈伯洋','九連問']);
 });
 it('drops anonymous people, noise, digits and words common across the day',()=>{
  const t=topic('t',['鄭姓男子','沈伯洋'],['1031','市政','深偽音檔','國際新聞']);
  const common=Array.from({length:20},(_,i)=>video(`市政 新聞 ${i}`));
  const m=matchTopics([t],[...common,...filler(200)]).get('t')!;
  expect(m.terms).toEqual({people:['沈伯洋'],events:['深偽音檔']});
 });
 it('matches Latin keywords as whole words only',()=>{
  const t=topic('line',['沈伯洋'],['LINE']);
  const yes=video('沈伯洋想加LINE'),no=video('沈伯洋 ONLINE 直播');
  expect(matchTopics([t],[yes,no,...filler(100)]).get('line')!.primary.map(v=>v.videoId)).toEqual([yes.videoId]);
 });
 it('a topic without named people needs two event words and a minimum score',()=>{
  const crash=topic('crash',[],['聯結車','連環撞','國道']);
  const strong=video('國道聯結車爆胎 連環撞'),weak=video('國道塞車');
  const m=matchTopics([crash],[strong,weak,...filler(300)]).get('crash')!;
  expect(m.primary.map(v=>v.videoId)).toEqual([strong.videoId]);
 });
 it('ignores a show name that fills one channel\'s titles',()=>{
  const t=topic('rally',['沈伯洋'],['開講','車掃']);
  const show=Array.from({length:6},(_,i)=>video(`【頭家來開講】第${i}集 ${i===0?'沈伯洋':'其他'}`,{channelId:7}));
  const real=video('沈伯洋車掃現場',{channelId:8});
  const m=matchTopics([t],[...show,real,...filler(300)]).get('rally')!;
  expect(m.primary.map(v=>v.videoId)).toEqual([real.videoId]);
 });
 it('gives a video to one topic only when it clearly wins; otherwise it is possible for both',()=>{
  const a=topic('a',['沈伯洋'],['首場辯論']),b=topic('b',['沈伯洋'],['加LINE','再辯一場']);
  const clear=video('沈伯洋加LINE 再辯一場'),tie=video('沈伯洋 首場辯論 加LINE');
  const m=matchTopics([a,b],[clear,tie,...filler(300)]);
  expect(m.get('b')!.primary.map(v=>v.videoId)).toEqual([clear.videoId]);
  expect(m.get('a')!.possible.map(v=>v.videoId)).toEqual([tie.videoId]);
  expect(m.get('b')!.possible.map(v=>v.videoId)).toEqual([tie.videoId]);
 });
 it('never counts AI-cited videos as related, and reports how many of them the rule finds',()=>{
  const seed=video('沈伯洋 深偽音檔 提告'),missed=video('一段新聞');
  const t=topic('t',['沈伯洋'],['深偽音檔'],[seed.videoId,missed.videoId]);
  const m=matchTopics([t],[seed,missed,...filler(100)]).get('t')!;
  expect(m.primary).toEqual([]);
  expect([m.seedMatched,m.seedTotal]).toEqual([1,2]);
 });
 it('coverage counts AI and related channels, networks and recall',()=>{
  const t=topic('t',['沈伯洋'],['深偽音檔'],[],5);
  const r=video('沈伯洋 深偽音檔',{channelId:6}),r2=video('沈伯洋 深偽音檔 2',{channelId:7});
  const m=matchTopics([t],[r,r2,...filler(100)]).get('t')!;
  const c=topicCoverage(t,m,new Map([[6,[64]],[7,[64]]]),{from:'a',to:'b'});
  expect(c).toMatchObject({status:'ready',ruleVersion:TOPIC_RELATED_RULE,aiChannels:1,videos:2,channels:3,networks:2,possibleVideos:0,seedRecall:null});
  expect(topicCoverage(t,undefined,new Map(),{from:'a',to:'b'}).status).toBe('unavailable');
 });
 it('caches one query per day and leaves topics untouched when the read fails',async()=>{
  let calls=0;
  const reader={rows:async()=>{calls++;return [{videoId:'abcdefghijk',u_id:9,title:'沈伯洋 深偽音檔',description:'',publishedAt:'2026-10-31 01:00:00',viewCount:'12',channelTitle:'台',tags:'[64]'}];},close:async()=>{}} as unknown as Reader;
  const load=topicRelatedCache(reader,()=>new Date('2026-11-01T00:00:00Z'));
  const topics:TopicRow[]=[{...topic('t',['沈伯洋'],['深偽音檔']),dailyId:1,channelCount:1,videoCount:0,score:0,unresolvedReferences:[]}];
  const [first]=await withTopicCoverage(load,topics,'2026-10-31');const afterFirst=calls;await withTopicCoverage(load,topics,'2026-10-31');
  // Videos plus the cited channel's network tags; the second read is served from the cache.
  expect([afterFirst,calls]).toEqual([2,2]);
  expect(first!.coverage).toMatchObject({videos:1,channels:2});
  const failing=topicRelatedCache({rows:async()=>{throw new Error('down');},close:async()=>{}} as unknown as Reader);
  expect(await withTopicCoverage(failing,topics,'2026-10-31')).toEqual(topics);
 });
});
