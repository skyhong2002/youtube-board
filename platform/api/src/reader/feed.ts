import {canonicalVideoThumbnail} from '../../../shared/media-assets.js';
import {readChannelAvatars} from '../../../shared/media-cache/index.js';
import {sql} from 'drizzle-orm';
import type {Reader,Row} from '../db/client.js';
import {taipeiSql,timestamp} from '../reports/normalize.js';
import {videoTextDigest} from '../reports/video-digest.js';
import {targetUrl,type Target,type Follow,type Saved} from './contracts.js';
import type {AccountFeed,AccountFeedItem} from '../../../shared/account-contracts.js';
const SOURCE='https://tag.observe.tw';
const value=(v:unknown)=>typeof v==='string'?v:String(v??'');
/** Window snapshots remain a bounded, explicitly different upstream scope. */
async function current(reader:Reader){return (await reader.rows(sql`SELECT r.id,OCTET_LENGTH(r.snapshot) AS bytes FROM ts_vocabulary_current c JOIN ts_vocabulary_runs r ON r.id=c.run_id AND r.status='published' WHERE c.source=${SOURCE} LIMIT 1`))[0];}
export async function accountTargets(reader:Reader,items:Pick<Follow|Saved,'kind'|'target'>[]):Promise<Target[]>{
 const found=new Map<string,string>(),channelIdentities:Array<{id:number;channelId:string}>=[];
 const ids=(kind:string)=>items.filter(i=>i.kind===kind).map(i=>i.target);
 const add=(kind:string,rows:Row[])=>{for(const r of rows){found.set(kind+':'+value(r.target),value(r.label));if(kind==='channel')channelIdentities.push({id:Number(r.target),channelId:value(r.youtube_id)});}};
 for(const kind of ['channel','video','event','tag'] as const){const selected=ids(kind);if(!selected.length)continue;const list=sql.join(selected.map(x=>sql`${x}`),sql`,`);
  if(kind==='channel')add(kind,await reader.rows(sql`SELECT CAST(u_id AS CHAR) AS target,LEFT(title,512) AS label,youtube_id FROM urt_channel WHERE u_id IN (${list}) AND (flag_del IS NULL OR flag_del<1)`));
  if(kind==='video')add(kind,await reader.rows(sql`SELECT v.videoId AS target,LEFT(v.title,512) AS label FROM urt_video v WHERE v.videoId IN (${list}) AND v.pk=(SELECT MAX(n.pk) FROM urt_video n WHERE n.videoId=v.videoId AND BINARY n.videoId=BINARY v.videoId)`));
  if(kind==='event')add(kind,await reader.rows(sql`SELECT id AS target,title AS label FROM ts_editorial_events WHERE id IN (${list}) AND merged_into IS NULL`));
  if(kind==='tag'){
   const version=await current(reader);if(!version||Number(version.bytes)>8*1024*1024)continue;
   add(kind,await reader.rows(sql`SELECT term AS target,term AS label FROM ts_vocabulary_terms WHERE run_id=${version.id} AND term IN (${list}) UNION SELECT t.term AS target,t.term AS label FROM ts_vocabulary_runs r JOIN JSON_TABLE(IF(JSON_VALID(r.snapshot) AND OCTET_LENGTH(r.snapshot)<=8388608,COALESCE(JSON_EXTRACT(r.snapshot,'$.terms'),'[]'),'[]'),'$[*]' COLUMNS(term VARCHAR(240) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin PATH '$.term')) t ON TRUE WHERE r.id=${version.id} AND t.term IN (${list})`));
  }
 }
 const avatars=channelIdentities.length?await readChannelAvatars(channelIdentities).catch(()=>new Map()):new Map();
 return items.map(i=>({...(i.kind==='channel'?{avatar:avatars.get(Number(i.target))??null}:i.kind==='video'?{thumbnail:canonicalVideoThumbnail(i.target)}:{}),kind:i.kind,target:i.target,label:found.get(i.kind+':'+i.target)||i.target,url:targetUrl(i.kind,i.target),available:found.has(i.kind+':'+i.target)}));
}
export async function accountFeed(reader:Reader,userId:number,clock:()=>Date):Promise<AccountFeed>{
 const now=clock(),from=new Date(+now-7*86400000),version=await current(reader),vocabularyVersion=version?value(version.id):null;
 const follows=await reader.rows(sql`SELECT kind,target FROM ts_reader_follows WHERE user_id=${userId} ORDER BY kind,target LIMIT 200`),hasTags=follows.some(f=>f.kind==='tag');
 const period={from:from.toISOString(),to:now.toISOString()},coverage:AccountFeed['coverage']={vocabularyVersion,status:hasTags&&!version?'vocabulary-unavailable':'available',limit:150};
 if(!follows.length)return {items:[],period,coverage};
 const channelScope=sql`EXISTS(SELECT 1 FROM ts_reader_follows f WHERE f.user_id=${userId} AND f.kind='channel' AND f.target=CAST(v.u_id AS CHAR))`;
 const tagScope=vocabularyVersion?sql`EXISTS(SELECT 1 FROM ts_video_tag_matches m JOIN ts_video_tag_evidence e ON e.video_id=m.video_id AND e.vocabulary_version=m.vocabulary_version JOIN ts_reader_follows f ON f.user_id=${userId} AND f.kind='tag' AND BINARY f.target=BINARY e.term WHERE m.video_id=v.videoId AND BINARY m.video_id=BINARY v.videoId AND m.vocabulary_version=${vocabularyVersion} AND m.source_pk=v.pk AND BINARY m.source_text_sha256=BINARY ${videoTextDigest()})`:sql`FALSE`;
 const videos=follows.some(f=>f.kind==='channel'||f.kind==='tag')?await reader.rows(sql`SELECT v.videoId,LEFT(v.title,512) AS title,v.publishedAt,v.mtime,v.ctime FROM urt_video v WHERE v.publishedAt>=${taipeiSql(from)} AND v.publishedAt<=${taipeiSql(now)} AND v.pk=(SELECT MAX(n.pk) FROM urt_video n WHERE n.videoId=v.videoId AND BINARY n.videoId=BINARY v.videoId) AND EXISTS(SELECT 1 FROM urt_channel c WHERE c.u_id=v.u_id AND (c.flag_del IS NULL OR c.flag_del<1)) AND (${channelScope} OR ${tagScope}) ORDER BY v.publishedAt DESC,BINARY v.videoId LIMIT 150`):[];
 const events=follows.some(f=>f.kind==='event')?await reader.rows(sql`SELECT e.id,e.title,e.created_at,e.updated_at FROM ts_editorial_events e JOIN ts_reader_follows f ON f.user_id=${userId} AND f.kind='event' AND f.target=e.id WHERE e.merged_into IS NULL AND e.updated_at>=${from.toISOString().slice(0,23).replace('T',' ')} AND e.updated_at<=${now.toISOString().slice(0,23).replace('T',' ')} ORDER BY e.updated_at DESC,e.id LIMIT 150`):[];
 // A vocabulary switch during the request must not imply current-version matches.
 if(hasTags&&value((await current(reader))?.id)!==value(version?.id))return {items:[],period,coverage:{...coverage,status:'changed'}};
 const items:AccountFeedItem[]=[...videos.map(v=>({kind:'video' as const,thumbnail:canonicalVideoThumbnail(value(v.videoId)),target:value(v.videoId),title:value(v.title),url:targetUrl('video',value(v.videoId)),publishedAt:timestamp(v.publishedAt)!,updatedAt:timestamp(v.mtime??v.ctime)})),...events.map(e=>({kind:'event' as const,target:value(e.id),title:value(e.title),url:targetUrl('event',value(e.id)),publishedAt:utc(e.updated_at),updatedAt:utc(e.updated_at)}))];
 return {items:items.filter(i=>!!i.publishedAt).sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt)||a.kind.localeCompare(b.kind)||a.target.localeCompare(b.target)).slice(0,150),period,coverage};
}
function utc(v:unknown){const s=value(v);return /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(?:\.\d{1,6})?$/.test(s)?new Date(s.replace(' ','T')+'Z').toISOString():'';}
const escape=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'');
export function privateRss(feed:AccountFeed,origin:string){
 const base=new URL('/my',origin).href;
 return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>有影儀表板｜我的動態</title><link>${escape(base)}</link><description>近七天符合追蹤的影片與事件；詞彙只使用目前維護版本的新鮮比對證據。</description>${feed.items.map(i=>{const url=new URL(i.url,origin).href;return `<item><title>${escape(i.title)}</title><link>${escape(url)}</link><guid isPermaLink="true">${escape(url)}</guid><pubDate>${new Date(i.publishedAt).toUTCString()}</pubDate></item>`;}).join('')}</channel></rss>`;
}
