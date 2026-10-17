import assert from 'node:assert/strict';
import test from 'node:test';
import {layoutWordCloud,pictureBox} from '../app/_home/word-cloud';
import {LOGO_MASK,MASTHEAD_CANVASES,MASTHEAD_WORDS,mastheadEdition,mastheadFrameVars,mastheadLayouts,mastheadStack} from './masthead-cloud';
const terms=Array.from({length:40},(_,i)=>({label:`關鍵詞${i+1}`,count:80-i*2}));
const overlaps=(a:{x:number;y:number;width:number;height:number},b:{x:number;y:number;width:number;height:number})=>a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height;
test('the parent masthead geometry is kept per canvas and the logo mask is square',()=>{
 assert.deepEqual(MASTHEAD_CANVASES.map(c=>[c.key,c.width,c.height,c.max,c.logo]),[['compact',340,300,420,116],['medium',680,280,780,140],['wide',1120,280,1120,152]]);
 assert.equal(LOGO_MASK.length,16);assert.ok(LOGO_MASK.every(row=>row.length===16&&/^[.#]+$/.test(row)));
 const layouts=mastheadLayouts({compact:'c',medium:'m',wide:'w'});assert.deepEqual(layouts.map(l=>l.className),['c','m','w']);
 assert.ok(layouts.every(l=>l.sizes.words===MASTHEAD_WORDS&&l.sizes.hole.mask===LOGO_MASK&&l.sizes.clear.length===3));
 const vars=mastheadFrameVars();assert.equal(vars['--compact-w'],340);assert.equal(vars['--wide-max'],'1120px');
});
test('masthead words never cover the logo, tagline, edition or link',()=>{
 for(const layout of mastheadLayouts({compact:'c',medium:'m',wide:'w'})){
  const {width:w,height:h,sizes}=layout,c=MASTHEAD_CANVASES.find(x=>x.width===w)!,{hole,clear}=mastheadStack(c);
  const placed=layoutWordCloud(terms,w,h,sizes);assert.ok(placed.length>0,`${w} places words`);
  const cell=hole.width/16,left=(w-hole.width)/2,top=(h-hole.height)/2+hole.dy;
  const ink=LOGO_MASK.flatMap((row,my)=>[...row].flatMap((v,mx)=>v==='#'?[{x:left+mx*cell,y:top+my*cell,width:cell,height:cell}]:[]));
  const boxes=[...ink,...clear.map(b=>({...b,x:w/2+b.x,y:h/2+b.y}))];
  for(const word of placed)for(const box of boxes)assert.ok(!overlaps(word,box),`${word.label} overlaps the masthead on ${w}`);
 }
});
test('the ported layout keeps the earlier column-cloud packing when no masthead options are given',()=>{
 const placed=layoutWordCloud(terms.slice(0,10),340,240,{min:11,max:26,floor:9,budget:1,curve:.9,words:500});
 assert.equal(placed[0]?.label,'關鍵詞1');assert.equal(new Set(placed.map(p=>p.label)).size,placed.length);
 for(const [i,a] of placed.entries())for(const b of placed.slice(i+1))assert.ok(!overlaps(a,b));
});
test('edition is the parent short form, from source time only',()=>{
 assert.equal(mastheadEdition('2026-10-12T01:30:00Z',null),'10/12（一）09:30 更新');
 assert.match(mastheadEdition(null,'2026-10-08'),/觀測資料 2026\/10\/08/);
 assert.equal(mastheadEdition('invalid',null),'等待資料更新');
});
test('pictures are packed as a square or wide box with their caption, clear of the logo',()=>{
 const withPictures=terms.map((t,i)=>i%4===0?{...t,square:true}:i===5?{...t,aspect:4}:t);
 for(const layout of mastheadLayouts({compact:'c',medium:'m',wide:'w'})){
  const {width:w,height:h,sizes}=layout,c=MASTHEAD_CANVASES.find(x=>x.width===w)!,{hole}=mastheadStack(c);
  const placed=layoutWordCloud(withPictures,w,h,sizes);
  const square=placed.find(p=>p.square)!;assert.ok(square,`${w} places a picture`);
  const box=pictureBox(square.label,square.fontSize);assert.equal(square.width,box.width);assert.equal(square.height,box.height);
  const cell=hole.width/16,left=(w-hole.width)/2,top=(h-hole.height)/2+hole.dy;
  const ink=LOGO_MASK.flatMap((row,my)=>[...row].flatMap((v,mx)=>v==='#'?[{x:left+mx*cell,y:top+my*cell,width:cell,height:cell}]:[]));
  for(const word of placed)for(const b of ink)assert.ok(!overlaps(word,b),`${word.label} overlaps the logo on ${w}`);
 }
});
