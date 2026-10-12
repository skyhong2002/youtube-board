import type {ChannelAvatar} from '../../../shared/media-assets';
/** Never use raw legacy avatar/thumbnail URLs in the UI. */
export function localAvatarSource(avatar:ChannelAvatar|null|undefined):string|null {
 if(!avatar||avatar.width!==192||avatar.height!==192||typeof avatar.revision!=='string'||!/^[a-f0-9]{64}$/.test(avatar.revision)||typeof avatar.url!=='string')return null;
 const match=avatar.url.match(/^\/media\/channels\/([1-9]\d*)\/([a-f0-9]{64})\.png$/);
 return match&&Number.isSafeInteger(Number(match[1]))&&match[2]===avatar.revision?avatar.url:null;
}
export function firstGrapheme(value:string|null|undefined):string {
 const text=value?.trim();if(!text)return '頻';
 return new Intl.Segmenter('zh-Hant',{granularity:'grapheme'}).segment(text)[Symbol.iterator]().next().value?.segment??'頻';
}
