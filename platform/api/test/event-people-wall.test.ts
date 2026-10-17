import {describe,it,expect} from 'vitest';
import {registerEventExtra} from '../src/reports/event-extra.js';
import type {ReportService} from '../src/reports/service.js';

const video=(id:string,title:string,publishedAt:string)=>({id,title,channelId:7,youtubeChannelId:'UCfixture',channelTitle:'測試頻道',publishedAt});
const event={id:5,dailyId:19,title:'合成議題',date:'2026-10-17',resolution:{requestedTitle:'合成議題',canonicalTitle:'合成議題',kind:'exact',sourceDailyId:19,topicIds:[]},evidenceCoverage:{sourceDailyId:19},
 videos:[video('SourceNew01','較新來源','2026-10-17T10:00:00Z'),video('FactVideo01','事實影片','2026-10-17T09:00:00Z'),video('SourceOld01','較舊來源','2026-10-16T09:00:00Z')],
 analyses:[
  {id:21,type:'summary',updatedAt:null,result:{events:[{event:'合成議題',fact:[{headline:'事實標題',media:'甲台',video_id:'FactVideo01'},{headline:'重複引用',media:'甲台',video_id:'FactVideo01'}],opinion:[{content:'觀點內容',media:'乙台',video_id:'OpinionVid1'},{content:'無效引用',media:'乙台',video_id:'bad'}]}]}},
  {id:22,type:'people',updatedAt:null,result:{main_subject:'主角',other_opinions_persons:[{person:'丙',videos:[{media:'丙台',video_id:'OtherPers01'}]}],supporting_persons:[{person:'甲',role:'立委',support_or_opposition:'支持',strength:'強',description:'描述',videos:[{media:'甲台',video_id:'PersonVid01'},{media:'甲台',video_id:'FactVideo01'}]}]}},
  {id:23,type:'media',updatedAt:null,result:{main_subject:'媒體主體',all_medias:['甲台','乙台'],opposing_medias:[{media:'乙台',support_or_opposition:'反對',strength:'中',description:'媒體描述'}]}},
 ]};
async function handlers(){
 const map=new Map<string,Function>();registerEventExtra((path,handler)=>map.set(path,handler),{aiEvent:async()=>structuredClone(event)} as unknown as ReportService);
 return {people:await map.get('/ai/events/:id/people')!({id:'5'},{limit:'1'}),wall:await map.get('/ai/events/:id/wall')!({id:'5'},{})};
}
describe('event people and wall Laravel fields',()=>{
 it('people returns the header and structured people/media blocks besides the paged rows',async()=>{
  const {people}=await handlers();
  expect(people).toMatchObject({event:'合成議題',date:'2026-10-17',dailyId:19,people:{analysisId:22,mainSubject:'主角'},media:{analysisId:23,mainSubject:'媒體主體',all:['甲台','乙台']}});
  expect(people.rows).toHaveLength(1);expect(people.total).toBe(3);
  expect(people.people.groups.map((g:any)=>[g.kind,g.rows.map((r:any)=>r.person)])).toEqual([['supporting',['甲']],['opposing',[]],['other',['丙']]]);
  expect(people.people.groups[0].rows[0]).toMatchObject({role:'立委',stance:'支持',strength:'強',description:'描述'});
  expect(people.people.groups[0].rows[0].citations.map((c:any)=>c.id)).toEqual(['PersonVid01','FactVideo01']);
  expect(people.media.groups[1].rows[0]).toMatchObject({media:'乙台',stance:'反對',strength:'中'});
  expect(people.notes).toContain('人物分析主體：主角。');expect(people.sections[0].key).toBe('media');
 });
 it('wall keeps the live-wall shape and adds Laravel cited videos in order, unique by id',async()=>{
  const {wall}=await handlers();
  expect(wall).toMatchObject({title:'合成議題：來源影片牆',variant:'event',tabs:[],event:'合成議題',date:'2026-10-17',dailyId:19,resolution:{kind:'exact'}});
  expect(wall.streams.every((s:any)=>typeof s.id==='string'&&typeof s.label==='string'&&typeof s.slot==='number')).toBe(true);
  expect(wall.citedVideos.map((v:any)=>[v.videoId,v.label,v.kind,v.media])).toEqual([['FactVideo01','事實標題','fact','甲台'],['OpinionVid1','觀點內容','opinion','乙台'],['PersonVid01','甲','supporting','甲台'],['OtherPers01','丙','other','丙台']]);
  expect(wall.citedVideos[0].title).toBe('事實影片');expect(wall.citedVideos[1].title).toBeNull();
  expect(wall.sourceVideos.map((v:any)=>[v.videoId,v.kind,v.source.channelId])).toEqual([['SourceNew01','source',7],['SourceOld01','source',7]]);
  expect(wall.sourceVideosTotal).toBe(2);
 });
});
