import {sql} from 'drizzle-orm';
import type {Reader,Row} from '../db/client.js';
import {integer,tagIds,text,timestamp} from '../reports/normalize.js';
import {parseChannelSource,sourceVideoId} from '../../../shared/channel-admin.js';
import type {ContentKind,ContentLookup,ContentMatch,YoutubeContentPreview} from '../../../shared/content-admin.js';

export type ContentQuery = {source:string} | {q:string;kind:ContentKind};
/** Parse bounded source/search arguments before any database or public metadata lookup. */
export function parseContentQuery(value:Record<string,unknown>):ContentQuery|null {
 if(value.source!==undefined){
  if(value.q!==undefined||value.kind!==undefined)return null;
  const source=parseChannelSource(value.source);return source?{source}:null;
 }
 if(typeof value.q!=='string'||value.q.trim().length<2||value.q.length>100||/[\u0000-\u001f\u007f]/.test(value.q))return null;
 const kind=value.kind??'live';return kind==='video'||kind==='live'||kind==='channel'?{q:value.q.trim(),kind}:null;
}
const retired=(value:unknown)=>(integer(value)??0)>=1;
const channel=(r:Row|undefined):ContentLookup['channel']=>r&&integer(r.u_id)!>0?{channelId:integer(r.u_id)!,youtubeChannelId:text(r.youtube_id),title:text(r.title),tags:tagIds(r.tags),archived:retired(r.flag_del)}:null;
const href=(kind:ContentKind,id:string)=>kind==='channel'?`/channels/${id}`:kind==='live'?`/live/videos/${encodeURIComponent(id)}/trend`:`/videos/${encodeURIComponent(id)}`;
const match=(kind:ContentKind,r:Row):ContentMatch=>{const id=kind==='channel'?String(r.u_id):text(r.videoId);return {kind,id,title:text(r.title)||id,channelId:integer(r.u_id)??0,href:href(kind,id),...(kind==='live'?{retired:retired(r.del_flag)}:{}),...(kind==='channel'?{youtubeChannelId:text(r.youtube_id)}:{})};};
export async function lookupContent(reader:Reader,query:ContentQuery,now:Date,resolve?:(id:string)=>Promise<YoutubeContentPreview|null>):Promise<ContentLookup>{
 const out:ContentLookup={source:'source'in query?query.source:null,videoId:null,channel:null,video:null,live:null,matches:[],generatedAt:now.toISOString()};
 if('source'in query){
  const id=sourceVideoId(query.source);out.videoId=id;
  if(id){
   const [videos,lives]=await Promise.all([
    reader.rows(sql`SELECT videoId,u_id,LEFT(title,512) AS title,ctime,channelId FROM urt_video WHERE videoId=${id} AND BINARY videoId=BINARY ${id} LIMIT 1`),
    reader.rows(sql`SELECT l.videoId,l.u_id,l.del_flag,LEFT(v.title,512) AS title FROM urt_video_live l LEFT JOIN urt_video v ON v.videoId=l.videoId AND BINARY v.videoId=BINARY l.videoId WHERE l.videoId=${id} AND BINARY l.videoId=BINARY ${id} ORDER BY l.pk DESC LIMIT 1`),
   ]);
   const v=videos[0],l=lives[0];
   if(v){out.video={videoId:id,title:text(v.title)||id,channelId:integer(v.u_id)??0,collectedAt:timestamp(v.ctime)};out.matches.push(match('video',v));}
   if(l){out.live={videoId:id,title:text(l.title)||id,channelId:integer(l.u_id)??0,retired:retired(l.del_flag)};out.matches.push(match('live',l));}
   const uId=integer(v?.u_id)??integer(l?.u_id);
   if(uId){const rows=await reader.rows(sql`SELECT c.u_id,c.youtube_id,LEFT(c.title,256) AS title,c.flag_del,n.tags FROM urt_channel c LEFT JOIN urt_count n ON n.u_id=c.u_id WHERE c.u_id=${uId} LIMIT 1`);out.channel=channel(rows[0]);}
  }else{
   const condition=query.source.startsWith('@')?sql`c.customUrl=${query.source}`:sql`c.youtube_id=${query.source} AND BINARY c.youtube_id=BINARY ${query.source}`;
   const rows=await reader.rows(sql`SELECT c.u_id,c.youtube_id,LEFT(c.title,256) AS title,c.flag_del,n.tags FROM urt_channel c LEFT JOIN urt_count n ON n.u_id=c.u_id WHERE ${condition} ORDER BY c.u_id LIMIT 2`);
   // A stale handle collision is ambiguous; never send an edit to an arbitrary channel.
   if(rows.length===1)out.channel=channel(rows[0]);
  }
  if(id&&resolve){
   out.youtube=await resolve(id);
   if(out.youtube&&!out.channel){
    const youtubeId=out.youtube.channelId;
    const rows=await reader.rows(sql`SELECT c.u_id,c.youtube_id,LEFT(c.title,256) AS title,c.flag_del,n.tags FROM urt_channel c LEFT JOIN urt_count n ON n.u_id=c.u_id WHERE c.youtube_id=${youtubeId} AND BINARY c.youtube_id=BINARY ${youtubeId} ORDER BY c.u_id LIMIT 2`);
    if(rows.length===1)out.channel=channel(rows[0]);
   }
  }
  if(out.channel)out.matches.push({kind:'channel',id:String(out.channel.channelId),title:out.channel.title,channelId:out.channel.channelId,href:href('channel',String(out.channel.channelId))});
  return out;
 }
 const pattern='%'+query.q.replace(/[!%_]/g,'!$&')+'%';
 let rows:Row[];
 if(query.kind==='channel')rows=await reader.rows(sql`SELECT c.u_id,c.youtube_id,LEFT(c.title,256) AS title FROM urt_channel c WHERE c.title LIKE ${pattern} ESCAPE '!' OR (c.youtube_id=${query.q} AND BINARY c.youtube_id=BINARY ${query.q}) OR c.customUrl=${query.q} ORDER BY c.u_id DESC LIMIT 25`);
 else if(query.kind==='video')rows=await reader.rows(sql`SELECT v.videoId,v.u_id,LEFT(v.title,512) AS title FROM urt_video v WHERE v.title LIKE ${pattern} ESCAPE '!' OR v.videoId=${query.q} AND BINARY v.videoId=BINARY ${query.q} ORDER BY v.publishedAt DESC,v.pk DESC LIMIT 25`);
 else rows=await reader.rows(sql`SELECT l.videoId,l.u_id,l.del_flag,COALESCE(LEFT(v.title,512),l.videoId) AS title FROM urt_video_live l LEFT JOIN urt_video v ON v.videoId=l.videoId AND BINARY v.videoId=BINARY l.videoId LEFT JOIN urt_channel c ON c.u_id=l.u_id WHERE v.title LIKE ${pattern} ESCAPE '!' OR c.title LIKE ${pattern} ESCAPE '!' OR l.videoId=${query.q} AND BINARY l.videoId=BINARY ${query.q} ORDER BY COALESCE(l.scheduledStartTime,l.actualStartTime,l.publishedAt) DESC,l.pk DESC LIMIT 25`);
 out.matches=rows.map(r=>match(query.kind,r));return out;
}
