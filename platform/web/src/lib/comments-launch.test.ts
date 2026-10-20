import assert from 'node:assert/strict';
import {test} from 'node:test';
import {COMMENTS_PUBLISHED,isCommentPage} from './comments-launch';
import {resolveRoute} from './routes';
import {familyTabs} from './report-navigation';

const pages=[['comments','authors','someone'],['channels','12','comments'],['tags','comments'],['tags','3','comments']];
test('comment pages are recognised, and only those',()=>{
 for(const page of pages)assert.ok(isCommentPage(page),page.join('/'));
 for(const page of [['channels','12','videos'],['tags','3','cloud'],['videos','x','analytics'],['keywords','comments','videos']])assert.ok(!isCommentPage(page),page.join('/'));
});
test('unpublished comment pages 404 and leave the family tabs',{skip:COMMENTS_PUBLISHED},()=>{
 for(const page of pages)assert.equal(resolveRoute(page),null,page.join('/'));
 for(const path of ['/channels/12/videos','/tags/3/videos','/tags/videos'])assert.ok(familyTabs(path).every(tab=>!tab.href.includes('/comments')&&tab.label!=='留言'),path);
});
