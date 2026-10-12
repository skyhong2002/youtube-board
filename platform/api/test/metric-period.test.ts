import {it,expect} from 'vitest';
import {metricPeriod,metricType,metricFilters} from '../src/reports/metric-period.js';
import {observedMetric} from '../src/reports/observed-metrics.js';
const now=()=>new Date('2026-05-25T00:00:00Z');
it('group excludes from while tag includes it and defaults to the prior Taipei day',()=>{
 expect(metricPeriod({},now,'group')).toMatchObject({from:'2026-05-18',to:'2026-05-25',dates:['2026-05-19','2026-05-20','2026-05-21','2026-05-22','2026-05-23','2026-05-24','2026-05-25'],today:0});
 expect(metricPeriod({},now,'tag')).toMatchObject({from:'2026-05-17',to:'2026-05-24',today:1});expect(metricPeriod({},now,'tag').dates).toHaveLength(8);
 expect(metricPeriod({from:'2026-05-22',to:'2026-05-24'},now,'group').dates).toEqual(['2026-05-23','2026-05-24']);
 expect(metricPeriod({from:'2026-05-24',to:'2026-05-22'},now,'tag').dates).toEqual(['2026-05-22','2026-05-23','2026-05-24']);
 expect(metricPeriod({from:'2026-05-24',to:'2026-05-24'},now,'group').dates).toEqual(['2026-05-24']);
});
it('year aliases retain January2 group boundary and January1 fallback, leap days and offsets',()=>{
 for(const query of [{days:'year'},{from:'year'}]){expect(metricPeriod({...query,to:'2024-12-31'},now,'group').dates).toHaveLength(365);expect(metricPeriod({...query,to:'2024-12-31'},now,'tag').dates).toHaveLength(366);expect(metricPeriod({...query,to:'2024-01-01'},now,'group').dates).toEqual(['2024-01-01']);}
 expect(metricPeriod({days:'1',today:'1'},()=>new Date('2024-03-01T00:00:00Z'),'group').dates).toEqual(['2024-02-29']);
 expect(metricPeriod({days:'1',today:'0'},()=>new Date('2026-05-24T16:01:00Z'),'group').to).toBe('2026-05-25');
 expect(metricPeriod({to:'2026-05-20',days:'3'},now,'group')).toMatchObject({from:'2026-05-20',to:'2026-05-22',dates:['2026-05-21','2026-05-22']});
});
it('blank controls retain defaults and invalid/oversized date selections fail400',()=>{
 expect(metricPeriod({days:'',from:'',to:'',today:''},now,'tag')).toEqual(metricPeriod({},now,'tag'));
 for(const q of [{days:'0'},{days:'367'},{today:'-1'},{today:'3651'},{from:'2024-02-30'},{days:['year','7']},{days:['7','8'],from:'year'},{days:'wrong',from:'year'},{from:'2024-01-01',to:'2026-01-01'}])expect(()=>metricPeriod(q,now,'group')).toThrow();
 const selected=metricFilters({days:'14'},metricPeriod({days:'14'},now,'group'))[0]!;expect(selected.options?.some(o=>o.value===selected.value)).toBe(true);
 expect(metricType('views_video','tag')).toBe('average');for(const alias of ['tags_video','videos'])expect(metricType(alias,'group')).toBe('count_videos');for(const v of ['wrong','__proto__',[]])expect(()=>metricType(v,'group')).toThrow();
});
it('recorded-only totals and medians distinguish nulls, zeros and exact even medians',()=>{
 expect(observedMetric([null,0,10,30,undefined])).toEqual({sum:40,median:10,knownDays:3});expect(observedMetric([10,15])).toEqual({sum:25,median:12.5,knownDays:2});expect(observedMetric([null,undefined])).toEqual({sum:null,median:null,knownDays:0});expect(observedMetric([0])).toEqual({sum:0,median:0,knownDays:1});
 expect(()=>observedMetric([Number.MAX_SAFE_INTEGER,1])).toThrow('precision');expect(()=>observedMetric(['9007199254740993'])).toThrow('precision');expect(()=>observedMetric([true])).toThrow();
});
