import {it,expect} from 'vitest';
import {eventPresentation,presentationCitations,resolveEventAlias} from '../src/reports/event-shapes.js';
import type {EventAnalysis,TopicRow} from '../src/contracts.js';
const a=(type:string,result:unknown):EventAnalysis=>({id:1,type,result,updatedAt:null});
const topic=(id:string,title:string,alias:string)=>({id,title,evidence:[],unresolvedReferences:[{event:alias,channelTitle:'甲'}]}) as unknown as TopicRow;
it('preserves media/people classifications and all case-distinct exact citations in historical formats',()=>{
 const p=eventPresentation([a('summary',{events:[{事件:'報導',描述:'描述',關鍵字:['一'],媒體:'甲',facts:[{標題:'引文',媒體:'甲',videoId:'EventAa0001'}],opinions:[{內容:'觀點',角度:'支持',強度:'中',video_id:'bad id!'}]}]}),a('people',{主體角色:'報導',supporting_persons:[{人物:'某人',角色:'來賓',立場:'支持',強度:'低',描述:'描述',videos:[{video_id:'EventAa0001'},{video_id:'Eventaa0001'}]}]}),a('media',{主體角色:'報導',全部媒體:['甲','乙'],supporting_medias:[{媒體:'甲',立場:'支持',強度:'高',描述:'媒體內容'}],other_opinions_medias:[{media:'乙',support_or_opposition:'中立'}]})]);
 expect(p.summaries[0]).toMatchObject({title:'報導',keywords:['一'],media:['甲']});expect(p.media).toMatchObject({mainSubject:'報導',all:['甲','乙']});expect(p.people?.groups[0]?.rows[0]?.citations.map(c=>c.id)).toEqual(['EventAa0001','Eventaa0001']);expect(presentationCitations(p).find(c=>c.rawId==='bad id!')).toMatchObject({id:null,verification:'invalid',href:null});
});
it('never turns malformed or out-of-snapshot citations into links',()=>{
 const analysis=a('summary',{events:[{event:'題',fact:[{headline:'一',media:'甲',video_id:'EventAa0001'},{headline:'二',media:'乙',video_id:'EventAa0001'},{headline:'三',video_id:'https://evil.invalid'},{headline:'四'}]}]});analysis.lineage={state:'immutable-snapshot',runId:'x',dailyResultSha256:'a',sourceChanged:false,sourceVideos:[{id:'EventAa0001',media:'甲',channelId:1,title:'原始標題'}]};const citations=presentationCitations(eventPresentation([analysis]));expect(citations.map(c=>c.verification)).toEqual(['snapshot','outside-snapshot','invalid','missing']);expect(citations.slice(1).every(c=>c.href===null)).toBe(true);
});
it('aliases use only exact one-source daily mappings and reject ambiguous canonical targets',()=>{
 const rows=[topic('1','正式題','來源題'),topic('2','第二題','第二來源')];expect(resolveEventAlias(rows,'來源題')).toMatchObject({title:'正式題',kind:'same-day-source-alias'});expect(resolveEventAlias(rows,'來源')).toMatchObject({title:'來源',kind:'exact',topics:[]});expect(resolveEventAlias(rows,'正式題').kind).toBe('exact');expect(()=>resolveEventAlias([...rows,topic('3','別題','來源題')],'來源題')).toThrow();expect(()=>resolveEventAlias([...rows,topic('4','正式題','其他來源')],'來源題')).toThrow();
});
it('bounded shape decoding fails visibly instead of truncating',()=>{expect(()=>eventPresentation([a('media',{all_medias:Array(5001).fill('媒體')})])).toThrow('capacity');expect(()=>eventPresentation([a('summary',{events:Array(1001).fill({event:'題'})})])).toThrow('capacity');});
it('source avatars use exact immutable citation identities and leave ambiguous media names unresolved',()=>{
 const analysis=a('media',{全部媒體:['同名','唯一'],supporting_medias:[{媒體:'同名'},{媒體:'唯一'}]});analysis.lineage={state:'immutable-snapshot',runId:'x',dailyResultSha256:'a',sourceChanged:false,sourceVideos:[{id:'EventAa0001',media:'同名',channelId:1,title:'A'},{id:'Eventaa0001',media:'同名',channelId:2,title:'B'},{id:'EventAa0002',media:'唯一',channelId:3,title:'C'}]};
 const media=eventPresentation([analysis]).media;expect(media?.groups[0]?.rows.map(r=>r.sourceChannel?.channelId)).toEqual([null,3]);expect(media?.sourceChannels?.map(s=>s.channelId)).toEqual([null,3]);
 const summary=a('summary',{events:[{event:'題',media:['同名'],fact:[{headline:'一',media:'同名',video_id:'EventAa0001'},{headline:'二',media:'同名',video_id:'Eventaa0001'},{headline:'錯誤',media:'他名',video_id:'EventAa0001'}]}]});summary.lineage=analysis.lineage;
 expect(presentationCitations(eventPresentation([summary])).map(c=>c.sourceChannel?.channelId)).toEqual([1,2,null]);
});
it('legacy citation source identity comes only from its exact video and never lends identity to label-only claims',()=>{
 const analysis=a('summary',{events:[{event:'題',media:['甲'],fact:[{headline:'一',media:'甲',video_id:'EventAa0001'},{headline:'二',media:'甲',video_id:'Eventaa0001'}]}]}),sources=new Map([['EventAa0001',{channelId:1,channelTitle:'甲',channelAvatar:null}]]);
 const result=eventPresentation([analysis],sources);expect(presentationCitations(result).map(c=>c.sourceChannel?.channelId)).toEqual([1,null]);expect(result.summaries[0]?.sourceChannels?.[0]?.channelId).toBeNull();
});
