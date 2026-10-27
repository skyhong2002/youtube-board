import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseChannelSource} from '../../../shared/channel-admin';
import {addParam,bookmarkletSource} from './channel-bookmarklet';

const UC = 'UCabcdefghijklmnopqrstuv';
/** Run the bookmark's code against a stand-in page and return where it navigates to. */
function click(page: {meta?: string; canonical?: string; href: string}) {
 const source = bookmarkletSource('https://youtube.observe.tw');
 assert.ok(source.startsWith('javascript:'));
 const location = {href: page.href};
 const document = {querySelector: (selector: string) => selector.startsWith('meta') ? (page.meta ? {content: page.meta} : null) : page.canonical ? {href: page.canonical} : null};
 new Function('document', 'location', source.slice('javascript:'.length))(document, location);
 return location.href;
}
const sent = (url: string) => decodeURIComponent(new URL(url).searchParams.get('add')!);

test('the bookmark opens the admin page on this site with what the page says about its channel', () => {
 const url = click({meta: UC, href: 'https://www.youtube.com/watch?v=abcdefghijk'});
 assert.ok(url.startsWith('https://youtube.observe.tw/admin/?add='));
 assert.equal(sent(url), UC);
});
test('without the meta tag it uses a canonical /channel/ link, then the address', () => {
 assert.equal(sent(click({canonical: `https://www.youtube.com/channel/${UC}`, href: 'https://www.youtube.com/@abc'})), `https://www.youtube.com/channel/${UC}`);
 assert.equal(sent(click({canonical: 'https://www.youtube.com/watch?v=abcdefghijk', href: 'https://www.youtube.com/@abc.def'})), 'https://www.youtube.com/@abc.def');
});
test('what the bookmark sends is accepted by the add form for channel pages and refused for unusable ones', () => {
 assert.equal(parseChannelSource(sent(click({meta: UC, href: 'https://www.youtube.com/watch?v=x'}))), UC);
 assert.equal(parseChannelSource(sent(click({href: 'https://www.youtube.com/@abc.def/videos'}))), '@abc.def');
 assert.equal(parseChannelSource(sent(click({href: 'https://www.youtube.com/watch?v=abcdefghijk'}))), null);
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
