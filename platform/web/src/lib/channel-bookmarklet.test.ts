import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseChannelSource} from '../../../shared/channel-admin';
import {addParam,bookmarkletSource} from './channel-bookmarklet';

const UC = 'UCabcdefghijklmnopqrstuv';
/** Run the bookmark's code against a stand-in page and return where it navigates to. */
function click(page: {meta?: string; canonical?: string; href: string}) {
 const source = bookmarkletSource('https://youtube.observe.tw');
 assert.ok(source.startsWith('javascript:'));
 const at = new URL(page.href), location = {href: page.href, origin: at.origin, pathname: at.pathname, search: at.search};
 const document = {querySelector: (selector: string) => selector.startsWith('meta') ? (page.meta ? {content: page.meta} : null) : page.canonical ? {href: page.canonical} : null};
 new Function('document', 'location', source.slice('javascript:'.length))(document, location);
 return location.href;
}
const sent = (url: string) => decodeURIComponent(new URL(url).searchParams.get('add')!);

test('the bookmark opens the admin page on this site with what the page says about its channel', () => {
 const url = click({meta: UC, href: 'https://www.youtube.com/@abc.def/videos'});
 assert.ok(url.startsWith('https://youtube.observe.tw/admin/?add='));
 assert.equal(sent(url), UC);
});
test('on a video, live or shorts page it sends a clean video link, not a possibly stale channel meta tag', () => {
 const V = 'dQw4w9WgXc_';
 assert.equal(sent(click({meta: UC, href: `https://www.youtube.com/watch?v=${V}&list=PLx&t=42s&pp=${'x'.repeat(400)}`})), `https://www.youtube.com/watch?v=${V}`);
 assert.equal(sent(click({meta: UC, href: `https://m.youtube.com/watch?app=desktop&v=${V}`})), `https://m.youtube.com/watch?v=${V}`);
 assert.equal(sent(click({href: `https://music.youtube.com/watch?v=${V}&si=x`})), `https://music.youtube.com/watch?v=${V}`);
 assert.equal(sent(click({meta: UC, href: `https://www.youtube.com/live/${V}?si=abc`})), `https://www.youtube.com/live/${V}`);
 assert.equal(sent(click({href: `https://www.youtube.com/shorts/${V}`})), `https://www.youtube.com/shorts/${V}`);
 // A live page of a channel (/@name/live) is a channel page, and /live without an id falls back as before.
 assert.equal(sent(click({meta: UC, href: 'https://www.youtube.com/@abc.def/live'})), UC);
 assert.equal(sent(click({meta: UC, href: 'https://www.youtube.com/watch'})), UC);
});
test('without the meta tag it uses a canonical /channel/ link, then the address', () => {
 assert.equal(sent(click({canonical: `https://www.youtube.com/channel/${UC}`, href: 'https://www.youtube.com/@abc'})), `https://www.youtube.com/channel/${UC}`);
 assert.equal(sent(click({canonical: 'https://www.youtube.com/watch?v=abcdefghijk', href: 'https://www.youtube.com/@abc.def'})), 'https://www.youtube.com/@abc.def');
});
test('what the bookmark sends is accepted by the add form for channel and video pages and refused for unusable ones', () => {
 assert.equal(parseChannelSource(sent(click({meta: UC, href: 'https://www.youtube.com/channel/' + UC + '/about'}))), UC);
 assert.equal(parseChannelSource(sent(click({href: 'https://www.youtube.com/@abc.def/videos'}))), '@abc.def');
 for (const href of ['https://www.youtube.com/watch?v=abcdefghijk&t=1', 'https://m.youtube.com/watch?v=abcdefghijk', 'https://music.youtube.com/watch?v=abcdefghijk', 'https://www.youtube.com/live/abcdefghijk', 'https://www.youtube.com/shorts/abcdefghijk/'])
  assert.equal(parseChannelSource(sent(click({meta: UC, href}))), 'https://youtu.be/abcdefghijk', href);
 assert.equal(parseChannelSource(sent(click({href: 'https://www.youtube.com/watch?v=x'}))), null);
 assert.equal(parseChannelSource(sent(click({href: 'https://www.youtube.com/user/foo'}))), null);
});
test('the origin cannot break out of the bookmark code', () => {
 const source = bookmarkletSource('https://a.example/"+alert(1)+"');
 assert.ok(source.includes('"https://a.example/\\"+alert(1)+\\"/admin/?add="'));
});
test('the add parameter is read back, bounded', () => {
 assert.equal(addParam('?add=' + encodeURIComponent(UC)), UC);
 assert.equal(addParam(''), '');
 assert.equal(addParam('?add=' + 'x'.repeat(301)), '');
});
