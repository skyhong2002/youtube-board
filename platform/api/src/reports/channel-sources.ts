import {sql} from 'drizzle-orm';
import type {ChannelSource} from '../../../shared/media-assets.js';
import type {Reader,Row} from '../db/client.js';
import {integer,text} from './normalize.js';
/** Presentation identity from an explicit source row; names alone never identify a channel. */
export function channelSource(row:Row):ChannelSource{
 const id=integer(row.u_id??row.channelId),title=text(row.channelTitle??row.media);
 return {channelId:id!==null&&id>0?id:null,channelTitle:title,channelAvatar:null,...(typeof row.youtubeChannelId==='string'?{youtubeChannelId:row.youtubeChannelId}:{})};
}
export function unresolvedChannel(channelTitle:string):ChannelSource{return {channelId:null,channelTitle,channelAvatar:null};}
/** Resolve a label only within the explicit video/snapshot evidence, never a global name lookup. */
export function sourceLabelLookup(sources:ChannelSource[]):(label:string)=>ChannelSource{
 const byName=new Map<string,ChannelSource|null>();
 for(const source of sources){const prior=byName.get(source.channelTitle);if(prior===null)continue;byName.set(source.channelTitle,source.channelId===null||prior&&prior.channelId!==source.channelId?null:source);}
 return label=>{const found=byName.get(label);return found?{...found}:unresolvedChannel(label);};
}
export function sourceForLabel(label:string,sources:ChannelSource[]):ChannelSource{return sourceLabelLookup(sources)(label);}
/** One bounded exact-video query for supplemental display metadata. Existing source data remains authoritative. */
export async function readVideoChannels(reader:Reader,input:string[]):Promise<Map<string,ChannelSource>>{
 const ids=[...new Set(input.filter(id=>/^[A-Za-z0-9_-]{11}$/.test(id)))].slice(0,5000),out=new Map<string,ChannelSource>();
 if(!ids.length)return out;
 const rows=await reader.rows(sql`SELECT v.videoId,v.u_id,LEFT(v.channelId,128) AS youtubeChannelId,LEFT(v.channelTitle,256) AS channelTitle FROM urt_video v WHERE v.videoId IN (${sql.join(ids.map(id=>sql`${id}`),sql`,`)}) AND BINARY v.videoId IN (${sql.join(ids.map(id=>sql`BINARY ${id}`),sql`,`)}) AND v.pk=(SELECT MAX(n.pk) FROM urt_video n WHERE n.videoId=v.videoId AND BINARY n.videoId=BINARY v.videoId) LIMIT 5001`);
 if(rows.length>5000)return out;const wanted=new Set(ids);
 for(const row of rows){const id=text(row.videoId);if(wanted.has(id))out.set(id,channelSource(row));}
 return out;
}
