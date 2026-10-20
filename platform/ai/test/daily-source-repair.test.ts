import {describe,it,expect} from 'vitest';
import type {Connection} from 'mysql2/promise';
import {loadDailySource} from '../src/daily-source.js';

// Laravel-written channel outputs (2026-07/10) carry truncated or hallucinated video IDs and duplicates; one bad
// ID made the whole day unreadable, so no event analysis could be generated for those days.
const ev=(name:string,videoId:unknown,extra:Record<string,unknown>={})=>({事件:name,描述:'描述',角度:'角度',陣營:'中立',分類:'社會',關鍵字:['k'],人物:[],地名:[],類型:['新聞'],videoId,...extra});
function fakeDb(channels:Record<number,unknown[]>,topics:unknown[]){
 const daily={pk:'9',date_from:'2026-09-04 00:00:00',date_to:'2026-09-04 23:59:59',data_type:'oneday',condition_type:'all',user_token:'CLI',ctime:'2026-09-05 00:30:00',channel_id:JSON.stringify({1:'媒體甲',2:'媒體乙'}),result_json:JSON.stringify(topics)};
 const responses=[[daily],[],Object.entries(channels).map(([id,events],i)=>({pk:String(100+i),u_id:Number(id),result_json:JSON.stringify(events)}))];
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
  ]);
  const source=await loadDailySource(db,'2026-09-04');
  expect(source.channels.find(c=>c.u_id===1)!.events.map(e=>[e.事件,e.videoId])).toEqual([['甲一',['AAAAAAAAAAA','BBBBBBBBBBB']]]);
  expect(source.topics.map(t=>[t.title,t.media.map(m=>m.event.事件)])).toEqual([['議題一',['甲一','乙一']]]);
 });
});
