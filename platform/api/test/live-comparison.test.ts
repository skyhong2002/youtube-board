import {it,expect} from 'vitest';
import {liveComparisonOptions,liveComparisonPeriod} from '../src/reports/live-comparison.js';
import {buildApp} from '../src/app.js';
const clock=()=>new Date('2038-09-20T00:00:00Z');
it('keyword group takes precedence over view and preserves reviewed metric aliases',()=>{
 expect(liveComparisonOptions('keyword',{group:'media',view:'position',type:'views'})).toMatchObject({key:'media',metric:'tags_views'});
 for(const type of ['videos','count_videos','tags_video'])expect(liveComparisonOptions('keyword',{type}).metric).toBe('tags_video');
 expect(liveComparisonOptions('keyword',{group:'',view:'position'}).key).toBe('media');
 for(const kind of ['keyword','group']as const)expect(liveComparisonOptions(kind,{view:' me-dia!'}).key).toBe('media');
 for(const type of ['videos','count_videos'])expect(liveComparisonOptions('group',{type}).metric).toBe('tags_views');
 expect(liveComparisonOptions('group',{group:'media',view:'position',all:'yes'})).toMatchObject({key:'position',includeAll:true,allExpansion:'unavailable'});
});
it('keyword defaults to today and inclusive preceding ten days, group defaults latest scoped thirty dates',()=>{
 expect(liveComparisonPeriod('keyword',{},clock,'2038-08-01')).toMatchObject({from:'2038-09-10',to:'2038-09-20'});expect(liveComparisonPeriod('keyword',{},clock).dates).toHaveLength(11);
 expect(liveComparisonPeriod('keyword',{days:'1',today:'1'},clock)).toMatchObject({from:'2038-09-18',to:'2038-09-19'});
 expect(liveComparisonPeriod('group',{},clock,'2038-09-19')).toMatchObject({from:'2038-08-21',to:'2038-09-19'});
 expect(liveComparisonPeriod('group',{today:'',days:'1'},clock,'2038-09-19').to).toBe('2038-09-19');
 expect(liveComparisonPeriod('group',{today:'0',days:'1'},clock,'2038-09-19')).toMatchObject({from:'2038-09-20',to:'2038-09-20'});
 expect(liveComparisonPeriod('keyword',{from:'2038-09-02',to:'2038-09-02'},clock).dates).toEqual(['2038-09-02']);
});
it('group live uses the keyword fallback definition rather than the separate live-hour family',()=>{
 const p=liveComparisonOptions('group',{view:'politic'});expect(p.definition.groups[0]).toEqual({name:'全部',filters:{or:'1,2,13,14'}});expect(p.definition.groups).toHaveLength(6);
 expect(liveComparisonOptions('keyword',{group:'no-such-group'}).key).toBe('media');expect(liveComparisonOptions('group',{view:'no-such-group'}).key).toBe('position');
});
it('rejects malformed or excessive selectors and periods before any source read',async()=>{
 let reads=0;const app=buildApp({reader:{rows:async()=>{reads++;return [];},close:async()=>{}}});
 try{for(const query of ['group=media&group=position','type=wrong','type=constructor','type=__proto__','days=91','all=maybe','today=3651','from=2038-02-30','from=2038-09-03&to=2038-09-02'])expect((await app.inject('/api/v1/keywords/term/live/trends?'+query)).statusCode,query).toBe(400);for(const query of ['view=media&view=position','type=wrong','days=121','all=maybe','today=366','from=2038-02-30'])expect((await app.inject('/api/v1/groups/known/live?'+query)).statusCode,query).toBe(400);expect((await app.inject('/api/v1/groups/tags_unknown/live')).statusCode).toBe(404);expect(reads).toBe(0);}finally{await app.close();}
});
