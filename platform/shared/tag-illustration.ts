/** Maintained public tag pictures; no arbitrary remote URL can become a YT asset. */
export const TAG_PICTURE_SOURCE='https://tag.observe.tw';
export type TagPictureKind='avatar'|'place'|'flag'|'logo'|'emoji';
export interface TagPicture {kind:TagPictureKind;label:string;image:string|null;emoji:string|null;attribution:{pageUrl:string;license:string|null;licenseUrl:string|null;artist:string|null}|null}
export const validTagLabel=(tag:unknown):tag is string=>typeof tag==='string'&&tag.length>0&&[...tag].length<=60&&tag===tag.trim()&&!/[\p{Cc}\p{Cs}]/u.test(tag);
export const validTagPictureRevision=(v:unknown):v is string=>typeof v==='string'&&/^[a-z0-9.-]{1,64}$/.test(v);
export function tagPicturePath(tag:string,kind:'avatar'|'visual',revision:string){
 if(!validTagLabel(tag)||!validTagPictureRevision(revision))throw new Error('Invalid tag picture identity');
 return '/media/tag-illustrations/'+encodeURIComponent(tag)+'/'+kind+'/'+revision;
}
/** Relative upstream endpoint, exact keyword, only documented image query keys. */
export function pictureRevision(value:unknown,tag:string,kind:'avatar'|'visual'):string|null {
 if(typeof value!=='string')return null;
 const path='/api/v1/tags/'+encodeURIComponent(tag)+'/'+(kind==='avatar'?'avatar':'visual-image');
 let url:URL;try{url=new URL(value,TAG_PICTURE_SOURCE);}catch{return null;}
 if(url.origin!==TAG_PICTURE_SOURCE||url.username||url.password||url.hash||url.pathname!==path)return null;
 for(const [name,v] of url.searchParams){if(!['v','accent','size','layer'].includes(name)||url.searchParams.getAll(name).length!==1)return null;if(name==='accent'&&!/^[0-9a-f]{6}$/i.test(v))return null;if(name==='size'&&v!=='small')return null;if(name==='layer'&&!['ink','color'].includes(v))return null;}
 const v=url.searchParams.get('v');return validTagPictureRevision(v)?v:null;
}
export function tagPictureUpstream(tag:string,kind:'avatar'|'visual',revision:string){
 tagPicturePath(tag,kind,revision);
 return TAG_PICTURE_SOURCE+'/api/v1/tags/'+encodeURIComponent(tag)+'/'+(kind==='avatar'?'avatar':'visual-image')+'?v='+revision+'&accent=ff0000'+(kind==='avatar'?'&layer=color':'&size=small');
}
