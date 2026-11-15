import {test} from 'node:test';
import assert from 'node:assert/strict';
import {channelTagOptions} from './channel-tag-options';
test('tag counts use distinct channels and sort descending, keeping unused options',()=>{
 const tags=[{id:3,name:'unused'},{id:2,name:'two'},{id:1,name:'one'}];
 const channels=[{tags:[2,2,1]},{tags:[2]}];
 assert.deepEqual(channelTagOptions(tags,channels),[{id:2,name:'two',channelCount:2},{id:1,name:'one',channelCount:1},{id:3,name:'unused',channelCount:0}]);
 assert.equal(tags[0].id,3);
 assert.deepEqual(channelTagOptions([{id:2,name:'b'},{id:1,name:'a'}],[]).map(t=>t.id),[1,2]);
});
