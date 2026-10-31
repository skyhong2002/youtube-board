/**
 * Chrome bookmark that sends the YouTube page being viewed to /admin with the channel prefilled, like tag.observe.tw's
 * 「設定這家媒體」 bookmark. It runs in the YouTube page, so it can read the channel from the page itself.
 * On a video page (watch?v=, /live/, /shorts/) it sends a clean link to the video: YouTube changes videos without reloading
 * the page, so the `<meta itemprop="channelId">` there can still name the channel of the first video opened, while the
 * worker looks the video's channel up exactly. Elsewhere, channel and @handle pages carry that meta tag and a canonical
 * /channel/UC… link; anything else falls back to the address, which the admin form then accepts or explains it cannot use.
 */
export function bookmarkletSource(origin: string): string {
  const target = JSON.stringify(origin + '/admin/?add=');
  return `javascript:(function(){var p=location.pathname,v=new URLSearchParams(location.search).get('v'),w=/^\\/(live|shorts)\\/[\\w-]{11}\\/?$/.test(p),m=document.querySelector('meta[itemprop="channelId"]'),c=document.querySelector('link[rel="canonical"]'),s=p==='/watch'&&v?location.origin+'/watch?v='+v:w?location.origin+p:m&&m.content||(c&&/\\/channel\\/UC/.test(c.href)?c.href:location.href);location.href=${target}+encodeURIComponent(s);})()`;
}
/** The channel the bookmark passed along, as typed text for the add form; empty when there is none. */
export function addParam(search: string): string {
  const value = new URLSearchParams(search).get('add');
  return value && value.length <= 300 ? value : '';
}
