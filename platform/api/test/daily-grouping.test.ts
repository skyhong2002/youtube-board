import {it,expect} from 'vitest';
import {dailySignals,needsDailyRegroup,preferDailyRegroup,regroupDaily} from '../src/reports/daily-grouping.js';
import {buildTopics} from '../src/reports/topics.js';
import type {TopicRow} from '../src/contracts.js';
const source=(id:number,title:string,keywords:string[],videos=['DailyAa0001','DailyAa0002'])=>({pk:id,u_id:id,title:'channel'+id,result_json:JSON.stringify([{事件:title,關鍵字:keywords,videoId:videos}])});
it('requires two strong signals, rejects shared politicians/countries and never invents one video',()=>{
 expect(dailySignals('台灣最新新聞',['川普','AI','台灣'],[])).toEqual([]);
 expect(regroupDaily([source(1,'報導甲',['半導體']),source(2,'報導乙',['半導體'])],'2200-01-01','all')).toHaveLength(2);
 const grouped=regroupDaily([source(1,'報導甲',['半導體','出口管制']),source(2,'報導乙',['半導體','出口管制'])],'2200-01-01','all');expect(grouped).toHaveLength(1);expect(grouped[0]).toMatchObject({channelCount:2,videoCount:2,grouping:'source-signals',dailyId:0});expect(grouped[0]!.detailUrl).not.toContain('/events');
 expect(regroupDaily([source(1,'無影片',['單一'],[])],'2200-01-01','all')).toEqual([]);
 expect(regroupDaily([source(1,'甲',['出口','管制'],[]),source(2,'乙',['出口','管制'],[])],'2200-01-01','all')[0]).toMatchObject({channelCount:2,videoCount:0});
});
it('preserves stronger caches instead of replacing eight or oversized topics with one',()=>{
 const topic=(channels:number)=>({channelCount:channels} as TopicRow);
 expect(needsDailyRegroup(Array.from({length:8},()=>topic(1)),'all')).toBe(true);
 expect(preferDailyRegroup(Array.from({length:8},()=>topic(1)),[topic(2)],'all')).toBe(false);
 expect(preferDailyRegroup(Array.from({length:45},()=>topic(1)),[topic(2)],'all')).toBe(false);
 expect(preferDailyRegroup(Array.from({length:8},()=>topic(1)),Array.from({length:5},()=>topic(2)),'all')).toBe(true);
 expect(needsDailyRegroup(Array.from({length:5},()=>topic(2)),'all')).toBe(false);
 expect(regroupDaily(Array.from({length:50},(_,i)=>source(i,'獨立事件'+i,[])),'2200-01-01','all')).toHaveLength(40);
 expect(regroupDaily(Array.from({length:50},(_,i)=>source(i,'獨立事件'+i,[])),'2200-01-01','green')).toHaveLength(25);
});
it('source identities survive duplicate channel names and ambiguous cached event names remain unresolved',()=>{
 const rows=[source(1,'事件甲',['共通','訊號']),source(2,'事件乙',['共通','訊號'])].map(r=>({...r,title:'同名'}));expect(regroupDaily(rows,'2200-01-01','all')[0]!.evidence.map(e=>e.channelId).sort()).toEqual([1,2]);
 expect(buildTopics(1,[{標題:'彙整',媒體事件:{甲:['事件']}}],new Map([[1,'甲']]),new Map([[1,{pk:1,result_json:[{事件:'事件',videoId:['DailyAa0001']},{事件:'事件',videoId:['DailyAa0002']}]}]]))[0]).toMatchObject({evidence:[],unresolvedReferences:[{channelTitle:'甲',event:'事件'}]});
});

it('bounded regrouping rejects oversized event/signal sets instead of silently truncating evidence',()=>{
 expect(()=>regroupDaily([{pk:1,u_id:1,title:'甲',result_json:JSON.stringify(Array.from({length:2001},(_,i)=>({事件:'事件'+i,videoId:['DailyAa0001']})))}],'2200-01-01','all')).toThrow('capacity');
 expect(()=>regroupDaily([source(1,'事件',Array.from({length:129},(_,i)=>'signal'+i))],'2200-01-01','all')).toThrow('capacity');
});

it('qualification deduplicates syntactically valid IDs and tie-breaking retains the first cluster',()=>{
 expect(regroupDaily([source(1,'甲',[],['DailyAa0001','DailyAa0001','invalid'])],'2200-01-01','all')).toEqual([]);
 expect(regroupDaily([source(1,'甲',['出口','管制'],['DailyAa0001']),source(1,'乙',['出口','管制'],['DailyAa0001'])],'2200-01-01','all')).toEqual([]);
 const rows=[source(3,'先',['AA','BB']),source(2,'後',['CC','DD']),source(1,'平手',['AA','BB','CC','DD'])];
 const topics=regroupDaily(rows,'2200-01-01','all');expect(topics.find(t=>t.title==='先')!.evidence.map(e=>e.event)).toEqual(['先','平手']);
 const cached={channelCount:10,evidence:[]} as unknown as TopicRow,candidate={channelCount:2,evidence:[{channelId:1},{channelId:2}]} as TopicRow;
 expect(preferDailyRegroup([cached],[candidate],'all')).toBe(true);
});
