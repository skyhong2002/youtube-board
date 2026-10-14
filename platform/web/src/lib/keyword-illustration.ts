import {tagPicturePath,type TagPicture} from '../../../shared/tag-illustration';
export type IllustrationView={kind:'loading'|'disabled'|'unavailable'|'empty'}|{kind:'available';picture:TagPicture};
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const text=(v:unknown,max=1024):v is string=>typeof v==='string'&&v.length<=max&&!/[\p{Cc}\p{Cs}]/u.test(v);
const safeLink=(v:unknown):v is string=>{if(!text(v,2048))return false;try{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}};
export function parseKeywordIllustration(body:unknown,keyword:string):IllustrationView {
 if(!obj(body)||!obj(body.data)||!obj(body.meta)||body.meta.schemaVersion!==1)return {kind:'unavailable'};
 const d=body.data;if(d.keyword!==keyword||d.source!=='https://tag.observe.tw')return {kind:'unavailable'};
 if(d.status==='disabled')return {kind:'disabled'};
 if(d.status!=='available')return {kind:'unavailable'};
 if(d.illustration===null)return {kind:'empty'};
 const p=d.illustration;if(!obj(p)||!text(p.label,256)||!['avatar','place','flag','logo','emoji'].includes(String(p.kind)))return {kind:'unavailable'};
 let image:string|null=null;
 if(p.kind==='emoji'){if(!text(p.emoji,32)||!p.emoji||p.image!==null)return {kind:'unavailable'};}
 else{
  if(!text(p.image,2048)||p.emoji!==null)return {kind:'unavailable'};
  const revision=p.image.split('/').at(-1)!;
  try{if(p.image!==tagPicturePath(keyword,p.kind==='avatar'?'avatar':'visual',revision))return {kind:'unavailable'};}catch{return {kind:'unavailable'};}
  image=p.image;
 }
 let attribution:TagPicture['attribution']=null;
 if(p.attribution!==null){
  const a=p.attribution;if(!obj(a)||!safeLink(a.pageUrl)||(a.licenseUrl!==null&&!safeLink(a.licenseUrl))||(a.artist!==null&&!text(a.artist))||(a.license!==null&&!text(a.license)))return {kind:'unavailable'};
  attribution={pageUrl:a.pageUrl,licenseUrl:a.licenseUrl as string|null,license:a.license as string|null,artist:a.artist as string|null};
 }
 return {kind:'available',picture:{kind:p.kind as TagPicture['kind'],label:p.label,image,emoji:p.kind==='emoji'?p.emoji as string:null,attribution}};
}
