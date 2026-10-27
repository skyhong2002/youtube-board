/**
 * Chrome bookmark that sends the YouTube page being viewed to /admin with the channel prefilled, like tag.observe.tw's
 * 「設定這家媒體」 bookmark. It runs in the YouTube page, so it can read the channel id from the page itself: channel,
 * @handle and video pages all carry `<meta itemprop="channelId">`, and a channel page's canonical link is /channel/UC….
 * Anything else falls back to the address, which the admin form then accepts or explains it cannot use.
 */
export function bookmarkletSource(origin: string): string {
  const target = JSON.stringify(origin + '/admin/?add=');
  return `javascript:(function(){var m=document.querySelector('meta[itemprop="channelId"]'),c=document.querySelector('link[rel="canonical"]'),s=m&&m.content||(c&&/\\/channel\\/UC/.test(c.href)?c.href:location.href);location.href=${target}+encodeURIComponent(s);})()`;
}
/** The channel the bookmark passed along, as typed text for the add form; empty when there is none. */
export function addParam(search: string): string {
  const value = new URLSearchParams(search).get('add');
  return value && value.length <= 300 ? value : '';
}
