'use client';
import {useEffect,useState} from 'react';
import {validTagLabel,tagPicturePath,type TagPicture} from '../../../shared/tag-illustration';

type View={kind:'loading'|'disabled'|'unavailable'|'empty'}|{kind:'available';picture:TagPicture};
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const text=(v:unknown,max=1024):v is string=>typeof v==='string'&&v.length<=max&&!/[\p{Cc}\p{Cs}]/u.test(v);
const safeLink=(v:unknown):v is string=>{if(!text(v,2048))return false;try{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}};
export function parseKeywordIllustration(body:unknown,keyword:string):View {
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
export function KeywordIllustrationView({view,onImageError}:{view:View;onImageError?:()=>void}){
 if(view.kind==='disabled')return null;
 return <section className="min-w-0 space-y-1 text-xs text-zinc-500 dark:text-zinc-400" aria-label="新文易數標籤圖片" data-illustration-state={view.kind}>
  {view.kind==='available'?<>
   {view.picture.image?<img src={view.picture.image} alt={view.picture.label+'（新文易數標籤圖片）'} width={96} height={96} loading="lazy" referrerPolicy="no-referrer" onError={onImageError} className="h-24 w-24 object-contain"/>:<span role="img" aria-label={view.picture.label} className="text-5xl">{view.picture.emoji}</span>}
   <p>圖片來源：新文易數</p>
   {view.picture.attribution&&<p className="max-w-72 break-words [overflow-wrap:anywhere]">
    <a href={view.picture.attribution.pageUrl} rel="noopener noreferrer" referrerPolicy="no-referrer" className="text-brand-700 underline dark:text-brand-400">原圖來源</a>
    {' · '}{view.picture.attribution.artist??'作者未記錄'}{' · '}
    {view.picture.attribution.licenseUrl?<a href={view.picture.attribution.licenseUrl} rel="noopener noreferrer" referrerPolicy="no-referrer" className="text-brand-700 underline dark:text-brand-400">{view.picture.attribution.license??'授權條款'}</a>:view.picture.attribution.license??'授權未記錄'}
   </p>}
  </>:<p role="status">{view.kind==='loading'?'正在讀取標籤圖片…':view.kind==='empty'?'標籤圖片：尚未收錄':'標籤圖片暫時無法讀取'}</p>}
 </section>;
}
export default function KeywordIllustration({keyword}:{keyword:string}){
 const [state,setState]=useState<{keyword:string;view:View}>({keyword,view:{kind:'loading'}});
 useEffect(()=>{
  if(!validTagLabel(keyword)){setState({keyword,view:{kind:'unavailable'}});return;}
  const controller=new AbortController(),timer=setTimeout(()=>{controller.abort();setState(s=>s.keyword===keyword?{keyword,view:{kind:'unavailable'}}:s);},7000);
  setState({keyword,view:{kind:'loading'}});
  void (async()=>{
   let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
   try{
    const response=await fetch('/api/v1/keywords/'+encodeURIComponent(keyword)+'/illustration',{credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{Accept:'application/json'},signal:controller.signal});
    if(!response.ok||!response.body||!/^application\/json(?:;|$)/i.test(response.headers.get('content-type')??''))throw Error();
    reader=response.body.getReader();let size=0;const chunks:Uint8Array[]=[];
    while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>131072)throw Error();chunks.push(part.value);}
    const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
    const view=parseKeywordIllustration(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),keyword);
    if(!controller.signal.aborted)setState({keyword,view});
   }catch{if(!controller.signal.aborted)setState({keyword,view:{kind:'unavailable'}});}
   finally{clearTimeout(timer);void reader?.cancel().catch(()=>{});}
  })();
  return()=>{clearTimeout(timer);controller.abort();};
 },[keyword]);
 return <KeywordIllustrationView view={state.keyword===keyword?state.view:{kind:'loading'}} onImageError={()=>setState({keyword,view:{kind:'unavailable'}})}/>;
}
