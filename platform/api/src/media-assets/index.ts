import type {FastifyInstance} from 'fastify';
import {isChannelAssetId,isMediaRevision} from '../../../shared/media-assets.js';
import {readAvatarBytes} from '../../../shared/media-cache/store.js';

/** Local immutable raster files only. Missing assets never trigger a download. */
export function registerMediaAssets(app:FastifyInstance){
 app.get<{Params:{id:string;revision:string}}>('/media/channels/:id/:revision.png',async(request,reply)=>{
  const root=process.env.MEDIA_CACHE_ROOT,{id,revision}=request.params;
  if(!root||!/^[1-9]\d*$/.test(id)||!isChannelAssetId(Number(id))||!isMediaRevision(revision))return reply.code(404).header('Cache-Control','no-store').send();
  try{
   const body=await readAvatarBytes(root,Number(id),revision),etag=`"${revision}"`;
   reply.header('Content-Type','image/png').header('X-Content-Type-Options','nosniff').header('Cache-Control','public, max-age=31536000, immutable').header('ETag',etag);
   if(request.headers['if-none-match']===etag)return reply.code(304).send();
   return reply.send(body);
  }catch{return reply.code(404).header('Cache-Control','no-store').send();}
 });
}
