import {sql} from 'drizzle-orm';
import {canonicalVideoThumbnail,type ChannelAvatar} from '../../../shared/media-assets.js';
import {readCachedChannelIds,readChannelAvatars} from '../../../shared/media-cache/index.js';
import type {Reader} from '../db/client.js';

type RecordValue=Record<string,unknown>;
interface Candidate {id:number;expected:string|null;apply:(avatar:ChannelAvatar|null)=>void}
export interface MediaLookup {
 cachedIds():Promise<ReadonlySet<number>>;
 avatars(identities:Array<{id:number;channelId:string}>):Promise<Map<number,ChannelAvatar>>;
}
const defaultLookup:MediaLookup={cachedIds:readCachedChannelIds,avatars:readChannelAvatars};
const positive=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0;
const channelIdFromHref=(href:unknown)=>typeof href==='string'&&/^\/channels\/[1-9]\d*(?:[/?#]|$)/.test(href)?Number(href.match(/^\/channels\/(\d+)/)![1]):null;
const videoIdFromHref=(href:unknown)=>typeof href==='string'?/^\/videos\/([A-Za-z0-9_-]{11})(?:[/?#]|$)/.exec(href)?.[1]??null:null;
// These are opaque historical/provider payloads, not typed public presentation DTOs.
const opaque=new Set(['result','lineage','provenance','evidenceCoverage','coverage','meta','snapshot','before','after','audit']);

/** Presentation-only batch enrichment. Never called for the legacy wire API.
 * Missing/corrupt cache is an ordinary fallback and performs no identity SQL.
 * Exact current identities prevent a reused local ID attaching another source's logo.
 */
export async function enrichPublicMedia<T>(reader:Reader,data:T,lookup:MediaLookup=defaultLookup):Promise<T>{
 const candidates:Candidate[]=[],seen=new WeakSet<object>();let nodes=0;
 const add=(id:unknown,expected:unknown,apply:Candidate['apply'])=>{apply(null);if(positive(id)&&candidates.length<10000)candidates.push({id,expected:typeof expected==='string'?expected:null,apply});};
 const walk=(value:unknown,depth=0):void=>{
  if(!value||typeof value!=='object'||depth>32||nodes++>100000||seen.has(value))return;seen.add(value);
  if(Array.isArray(value)){for(const item of value)walk(item,depth+1);return;}
  const row=value as RecordValue;
  if(typeof row.youtubeId==='string'&&positive(row.id)&&typeof row.youtubeUrl==='string'){
   add(row.id,row.youtubeId,avatar=>{row.avatar=avatar;row.thumbnail=avatar?.url??null;});
  }else if(typeof row.youtubeChannelId==='string'&&typeof row.id==='string'&&typeof row.youtubeUrl==='string'){
   row.thumbnail=canonicalVideoThumbnail(row.id);
   add(row.channelId,row.youtubeChannelId,avatar=>{row.channelAvatar=avatar;});
  }else if(positive(row.channelId)&&typeof row.channelTitle==='string'){
   add(row.channelId,row.youtubeChannelId,avatar=>{row.channelAvatar=avatar;});
  }
  if('value' in row&&typeof row.href==='string'){
   const id=channelIdFromHref(row.href),videoId=videoIdFromHref(row.href);
   if(positive(id))add(id,null,avatar=>{row.media={kind:'channel',channelId:id,avatar};});
   else if(videoId)row.media={kind:'video',videoId,thumbnail:canonicalVideoThumbnail(videoId)};
  }
  for(const [key,item]of Object.entries(row))if(!opaque.has(key)&&key!=='avatar'&&key!=='channelAvatar')walk(item,depth+1);
 };
 walk(data);
 if(!candidates.length)return data;
 try{
  const cached=await lookup.cachedIds(),ids=[...new Set(candidates.map(c=>c.id))].filter(id=>cached.has(id)).slice(0,5000);
  if(!ids.length)return data;
  const rows=await reader.rows(sql`SELECT u_id,youtube_id FROM urt_channel WHERE u_id IN (${sql.join(ids.map(id=>sql`${id}`),sql`,`)}) LIMIT 5001`);
  if(rows.length>5000)return data;
  const requested=new Set(ids),identities=new Map<number,string>(),conflicts=new Set<number>();
  for(const row of rows){const id=Number(row.u_id);if(!requested.has(id)||typeof row.youtube_id!=='string'||!row.youtube_id)continue;const old=identities.get(id);if(old!==undefined&&old!==row.youtube_id)conflicts.add(id);identities.set(id,row.youtube_id);}
  for(const id of conflicts)identities.delete(id);
  const avatars=await lookup.avatars([...identities].map(([id,channelId])=>({id,channelId})));
  for(const c of candidates){const current=identities.get(c.id);if(current!==undefined&&(c.expected===null||c.expected===current))c.apply(avatars.get(c.id)??null);}
 }catch{
  // Optional branding must not turn a usable report into an outage. Never log URLs.
 }
 return data;
}
