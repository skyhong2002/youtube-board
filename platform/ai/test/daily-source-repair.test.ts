import {describe,it,expect} from 'vitest';
import type {Connection} from 'mysql2/promise';
import {loadDailySource} from '../src/daily-source.js';
import {planEvent,validateEventDetail} from '../src/event.js';

// Laravel-written channel outputs (2026-07/10) carry truncated or hallucinated video IDs and duplicates; one bad
// ID made the whole day unreadable, so no event analysis could be generated for those days.
const ev=(name:string,videoId:unknown,extra:Record<string,unknown>={})=>({事件:name,描述:'描述',角度:'角度',陣營:'中立',分類:'社會',關鍵字:['k'],人物:[],地名:[],類型:['新聞'],videoId,...extra});
function fakeDb(channels:Record<number,unknown[]>,topics:unknown[],videos:unknown[]=[]){
 const daily={pk:'9',date_from:'2026-09-04 00:00:00',date_to:'2026-09-04 23:59:59',data_type:'oneday',condition_type:'all',user_token:'CLI',ctime:'2026-09-05 00:30:00',channel_id:JSON.stringify({1:'媒體甲',2:'媒體乙'}),result_json:JSON.stringify(topics)};
 const responses=[[daily],[],Object.entries(channels).map(([id,events],i)=>({pk:String(100+i),u_id:Number(id),result_json:JSON.stringify(events)})),videos];
 return {query:async()=>[responses.shift()]} as unknown as Connection;
}

describe('legacy daily source repair',()=>{
 it('keeps well-formed unique video IDs, drops unusable events and their references',async()=>{
  const db=fakeDb({
   1:[ev('甲一',['AAAAAAAAAAA','ewe1GYiRBc','AAAAAAAAAAA','BBBBBBBBBBB']),ev('甲二',['mLv5JTiBiimU']),ev('甲三',['CCCCCCCCCCC'],{描述:''})],
   2:[ev('乙一',['DDDDDDDDDDD'])],
  },[
   {標題:'議題一',媒體事件:{媒體甲:['甲一','甲二'],媒體乙:['乙一'],媒體丙:['丙一']}},
   {標題:'議題二',媒體事件:{媒體甲:['甲二','甲三']}},
   {標題:'議題一',媒體事件:{媒體乙:['乙一']}},
  ]);
  const source=await loadDailySource(db,'2026-09-04');
  expect(source.channels.find(c=>c.u_id===1)!.events.map(e=>[e.事件,e.videoId])).toEqual([['甲一',['AAAAAAAAAAA','BBBBBBBBBBB']]]);
  expect(source.topics.map(t=>[t.title,t.media.map(m=>m.event.事件)])).toEqual([['議題一',['甲一','乙一']]]);
 });
 it('resolves legacy 媒體事件 keyed by event name against every channel',async()=>{
  const db=fakeDb({1:[ev('共同事件',['AAAAAAAAAAA'])],2:[ev('共同事件',['BBBBBBBBBBB']),ev('乙二',['CCCCCCCCCCC'])]},[{標題:'議題一',媒體事件:{共同事件:['共同事件'],媒體乙:['共同事件']}}]);
  const source=await loadDailySource(db,'2026-09-04');
  expect(source.topics[0]!.media.map(m=>[m.channel,m.event.事件])).toEqual([['媒體甲','共同事件'],['媒體乙','共同事件']]);
 });
 it('plans a legacy topic from its ingested videos when some cited IDs were never ingested',async()=>{
  const v=(id:string,u_id:number)=>({videoId:id,u_id,title:'t',publishedAt:'2026-09-04 08:00:00'});
  const db=fakeDb({1:[ev('甲一',['AAAAAAAAAAA','MISSINGVID1'])],2:[ev('乙一',['MISSINGVID2'])]},[{標題:'議題一',媒體事件:{媒體甲:['甲一'],媒體乙:['乙一']}}],[v('AAAAAAAAAAA',1)]);
  const plan=await planEvent(db,{date:'2026-09-04',event:'議題一',promptType:'summary'});
  const source=plan.source as {topic:{media:{channel:string;event:{videoId:string[]}}[]};videos:{videoId:string}[]};
  expect(source.topic.media.map(m=>[m.channel,m.event.videoId])).toEqual([['媒體甲',['AAAAAAAAAAA']]]);
  expect(source.videos.map(x=>x.videoId)).toEqual(['AAAAAAAAAAA']);expect(plan.sourceCount).toBe(1);
 });
 it('people analysis drops unsourced persons and videos whose source item does not name the person',async()=>{
  const v=(id:string,u_id:number)=>({videoId:id,u_id,title:'t',publishedAt:'2026-09-04 08:00:00'});
  const db=fakeDb({1:[ev('甲一',['AAAAAAAAAAA'],{人物:['王甲']})],2:[ev('乙一',['BBBBBBBBBBB'],{人物:['李乙']})]},[{標題:'議題一',媒體事件:{媒體甲:['甲一'],媒體乙:['乙一']}}],[v('AAAAAAAAAAA',1),v('BBBBBBBBBBB',2)]);
  const plan=await planEvent(db,{date:'2026-09-04',event:'議題一',promptType:'people'});
  const person=(name:string,videos:[string,string][])=>({person:name,role:'人物',support_or_opposition:'支持',strength:'中',description:'說明',videos:videos.map(([media,video_id])=>({media,video_id}))});
  const out=validateEventDetail(JSON.stringify({main_subject:'議題一',supporting_persons:[person('王甲',[['媒體甲','AAAAAAAAAAA'],['媒體乙','BBBBBBBBBBB']]),person('李乙',[['媒體甲','AAAAAAAAAAA']])],opposing_persons:[],other_opinions_persons:[]}),plan) as {supporting_persons:{person:string;videos:{video_id:string}[]}[]};
  expect(out.supporting_persons.map(p=>[p.person,p.videos.map(x=>x.video_id)])).toEqual([['王甲',['AAAAAAAAAAA']]]);
  // A person no source item names is dropped, and a repeated person keeps the first entry; a video outside the topic still fails.
  const extra=validateEventDetail(JSON.stringify({main_subject:'議題一',supporting_persons:[person('不存在',[['媒體甲','AAAAAAAAAAA']]),person('王甲',[['媒體甲','AAAAAAAAAAA']]),person('王甲',[['媒體甲','AAAAAAAAAAA']])],opposing_persons:[],other_opinions_persons:[]}),plan) as Record<string,{person:string}[]>;
  expect(extra.supporting_persons!.map(p=>p.person)).toEqual(['王甲']);
  // An answer whose every person is unsupported fails (and is retried) instead of publishing an empty analysis; an empty answer is valid.
  expect(()=>validateEventDetail(JSON.stringify({main_subject:'議題一',supporting_persons:[person('不存在',[['媒體甲','AAAAAAAAAAA']]),person('李乙',[['媒體甲','AAAAAAAAAAA']])],opposing_persons:[],other_opinions_persons:[]}),plan)).toThrow('No sourced event person');
  expect(validateEventDetail(JSON.stringify({main_subject:'議題一',supporting_persons:[],opposing_persons:[],other_opinions_persons:[]}),plan)).toMatchObject({supporting_persons:[]});
  expect(()=>validateEventDetail(JSON.stringify({main_subject:'議題一',supporting_persons:[person('王甲',[['媒體甲','ZZZZZZZZZZZ']])],opposing_persons:[],other_opinions_persons:[]}),plan)).toThrow('pair');
 });
});
