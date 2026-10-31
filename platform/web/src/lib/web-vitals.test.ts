import assert from 'node:assert/strict';
import {test} from 'node:test';
import {webVitalEvent} from './web-vitals';

const metric=(name:string,value:number,rating='good',extra:Record<string,unknown>={})=>({name,value,rating,id:'v6-1761955200000-1234567890123',navigationType:'navigate',...extra});

test('web_vital carries only the metric and the fixed landing page type',()=>{
 assert.deepEqual(webVitalEvent(metric('LCP',2500.5,'needs-improvement'),'video'),{name:'web_vital',params:{
  metric_name:'LCP',metric_value:2501,metric_rating:'needs-improvement',page_type:'video',metric_id:'v6-1761955200000-1234567890123',navigation_type:'navigate'}});
 const extra=webVitalEvent(metric('INP',64.4,'good',{attribution:{interactionTarget:'#secret'},entries:[{name:'x'}],navigationType:'back-forward-cache'}),'home');
 assert.deepEqual(Object.keys(extra!.params).sort(),['metric_id','metric_name','metric_rating','metric_value','navigation_type','page_type']);
 assert.equal(extra!.params.navigation_type,'back-forward-cache');
});
test('LCP and INP round to whole ms; CLS keeps three decimals',()=>{
 assert.equal(webVitalEvent(metric('LCP',1234.4),'home')!.params.metric_value,1234);
 assert.equal(webVitalEvent(metric('INP',199.5),'home')!.params.metric_value,200);
 assert.equal(webVitalEvent(metric('CLS',0.12345),'home')!.params.metric_value,0.123);
 assert.equal(webVitalEvent(metric('CLS',0.0996),'home')!.params.metric_value,0.1);
 assert.equal(webVitalEvent(metric('CLS',0),'home')!.params.metric_value,0);
});
test('other metrics and malformed values are dropped',()=>{
 for(const bad of [metric('TTFB',100),metric('FCP',100),metric('FID',10),metric('LCP',Number.NaN),metric('LCP',-1),metric('LCP',Infinity),
  metric('LCP',100,'great'),metric('LCP',100,'good',{id:'https://youtube.observe.tw/videos?q=secret'})])
  assert.equal(webVitalEvent(bad,'home'),null,JSON.stringify(bad));
 assert.equal(webVitalEvent(metric('LCP',100,'good',{navigationType:undefined}),'home')!.params.navigation_type,'unknown');
 assert.equal(webVitalEvent(metric('LCP',100,'good',{navigationType:'/videos?q=secret'}),'home')!.params.navigation_type,'unknown');
});
