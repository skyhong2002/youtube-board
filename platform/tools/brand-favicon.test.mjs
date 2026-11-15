import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const publicFile=path=>readFileSync(new URL('../web/public/'+path,import.meta.url));
const sizes=[16,32,48];
for(const mode of ['light','dark'])test(`${mode} favicon embeds the current logo PNGs at their native sizes`,()=>{
 const ico=publicFile(`brand/favicon-${mode}.ico`);
 assert.equal(ico.readUInt16LE(0),0,'reserved');
 assert.equal(ico.readUInt16LE(2),1,'ICO type');
 assert.equal(ico.readUInt16LE(4),sizes.length,'frame count');
 let nextOffset=6+16*sizes.length;
 for(const [index,size] of sizes.entries()){
  const entry=6+16*index;
  assert.equal(ico[entry],size,'frame width');
  assert.equal(ico[entry+1],size,'frame height');
  assert.equal(ico.readUInt16LE(entry+4),1,'planes');
  assert.equal(ico.readUInt16LE(entry+6),32,'bit depth');
  const length=ico.readUInt32LE(entry+8),offset=ico.readUInt32LE(entry+12);
  assert.equal(offset,nextOffset,'contiguous frame offset');
  const png=publicFile(`brand/icon-${size}-${mode}.png`);
  assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a','PNG signature');
  assert.equal(png.readUInt32BE(16),size,'native PNG width');
  assert.equal(png.readUInt32BE(20),size,'native PNG height');
  assert.equal(length,png.length);
  assert.deepEqual(ico.subarray(offset,offset+length),png,'ICO frame must match current logo orientation');
  nextOffset+=length;
 }
 assert.equal(ico.length,nextOffset,'no extra or missing frame bytes');
});
test('public fallback favicon is the current light ICO',()=>{
 assert.deepEqual(publicFile('favicon.ico'),publicFile('brand/favicon-light.ico'));
});
