import {it,expect} from 'vitest';
import {buildApp} from '../src/app.js';
import {familyTabs,wallVariantTabs} from '../../web/src/lib/report-navigation.js';
import {resolveRoute} from '../../web/src/lib/routes.js';
it('every generated reader tab has a real API registration without accessing data',async()=>{
 const app=buildApp({reader:{rows:async()=>{throw new Error('Navigation registry must not read data');},close:async()=>{}}});
 try{
  const response=await app.inject('/api/v1/status');expect(response.statusCode).toBe(200);
  const registered=response.json().data.routes as string[];
  const templates=registered.map(route=>new RegExp('^'+route.split('/').map(segment=>segment.startsWith(':')?'[^/]+':segment.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('/')+'$'));
  const paths=['/channels/8','/channels/8/ai/days','/channels/8/ai/days/2026-10-11','/tags','/tags/102/channels','/tags/compare','/keywords/'+encodeURIComponent('交通%41')+'/videos','/groups/tags_economy','/groups/position','/live/current','/live/days/2026-10-11','/ai/days/2026-10-11/blue','/ai/days/2026-10-11/prompt','/ai/days/45/events','/ai/events/999','/ai/events/999/people'];
  const tabs=paths.flatMap(path=>familyTabs(path,path.includes('/45/')?{event:'事件'}:{})).concat(wallVariantTabs());
  // /events and /compare/titles are dedicated web pages outside the report catch-all.
  for(const tab of tabs.filter(tab=>!['/events','/compare/titles'].includes(new URL(tab.href,'http://local').pathname))){const path=new URL(tab.href,'http://local').pathname,route=resolveRoute(path.split('/').filter(Boolean).map(decodeURIComponent));expect(route,tab.href).toBeTruthy();expect(templates.some(template=>template.test('/api/v1/'+route!.apiPath)),tab.href).toBe(true);}
 }finally{await app.close();}
});
