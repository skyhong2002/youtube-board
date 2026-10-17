import assert from 'node:assert/strict';
import test from 'node:test';
import {compareKeys} from '../app/manage/SortTable';
import {channelMatches} from '../app/manage/Channels';
import {contributions,interactions,lastSeen,type UserRow} from '../app/manage/users/Users';
import type {ManagedChannel} from '../../../shared/manage-contracts';
test('admin table sort keeps missing values last in both directions',()=>{
 const keys=[3,null,10,1];
 assert.deepEqual([...keys].sort((a,b)=>compareKeys(a,b,'desc')),[10,3,1,null]);
 assert.deepEqual([...keys].sort((a,b)=>compareKeys(a,b,'asc')),[1,3,10,null]);
 assert.deepEqual(['乙','甲',null].sort((a,b)=>compareKeys(a,b,'asc')).at(-1),null);
});
test('channel search matches titles, exact YouTube IDs and local numbers',()=>{
 const row:ManagedChannel={channelId:42,channelTitle:'公視新聞網',youtubeChannelId:'UCabcdefghijklmnopqrstuv',status:'active',tags:[],subscribers:null,videos:null,weekVideos:0,latestVideoAt:null,statsAt:null,addedAt:null};
 for(const q of ['','公視','ucabcdefghijklmnopqrstuv','42'])assert.ok(channelMatches(row,q),q);
 for(const q of ['UCabc','4','民視'])assert.ok(!channelMatches(row,q),q);
});
test('account totals and last activity combine actions with logins',()=>{
 const activity={userId:1,follows:2,saves:3,apiKeys:1,feed:true,sessions:2,editorial:{event:4,nomination:1,decision:2},roleChanges:1,lastActiveAt:'2026-10-16T00:00:00.000Z'};
 assert.equal(interactions(activity),7);assert.equal(contributions(activity),8);assert.equal(interactions(null),null);
 const row={lastLoginAt:'2026-10-15T00:00:00.000Z',activity} as UserRow;
 assert.equal(lastSeen(row),'2026-10-16T00:00:00.000Z');assert.equal(lastSeen({...row,lastLoginAt:'2026-10-17T00:00:00.000Z'}),'2026-10-17T00:00:00.000Z');assert.equal(lastSeen({...row,activity:null}),'2026-10-15T00:00:00.000Z');
});
