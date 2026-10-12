import {canonicalVideoThumbnail} from '../../../shared/media-assets.js';
import {sql} from 'drizzle-orm';
import type {Reader} from '../db/client.js';
import type {Register} from './table.js';
import {BadQuery,NotFound} from './query.js';
import {decode,uuid} from '../../../shared/editorial/contracts.js';
export function registerEditorialPublic(register:Register,reader:Reader){
 register('/editorial/events',async(_p,q)=>{
  const page=Number(q.page??1),term=typeof q.q==='string'?q.q:'';if(!Number.isSafeInteger(page)||page<1||page>100||term.length>100)throw new BadQuery('Invalid event search.');
  const match=term?sql`AND LOCATE(${term},title)>0`:sql``;
  const records=await reader.rows(sql`SELECT id,title,version,created_at,updated_at FROM ts_editorial_events WHERE merged_into IS NULL ${match} ORDER BY updated_at DESC,id LIMIT 25 OFFSET ${(page-1)*25}`);
  return {updatedAt:records[0]?utc(records[0].updated_at):null,events:records.map(e=>({...e,created_at:utc(e.created_at),updated_at:utc(e.updated_at)})),page,limit:25,association:'operator-reviewed',notes:['事件關聯由編輯審核；同名不代表相同事件。','新聞與 YouTube 指標分別呈現，不合併計算。']};
 });
 register('/editorial/events/:id',async(p)=>{
  if(!uuid(p.id))throw new BadQuery('Invalid event UUID.');
  const requestedId=p.id;let id=requestedId,row;const seen=new Set<string>();
  for(let i=0;i<4;i++){if(seen.has(id))throw new Error('Editorial alias cycle');seen.add(id);row=(await reader.rows(sql`SELECT id,title,version,merged_into,created_at,updated_at FROM ts_editorial_events WHERE id=${id}`))[0];if(!row)throw new NotFound();if(!row.merged_into)break;id=String(row.merged_into);}
  if(!row||row.merged_into)throw new Error('Editorial alias depth');
  const sourceIndex=await reader.rows(sql`SELECT s.id,OCTET_LENGTH(s.provenance_json) AS payload_bytes FROM ts_editorial_links l JOIN ts_editorial_sources s ON s.id=l.source_id WHERE l.event_id=${id} AND l.active=1 ORDER BY s.published_at,s.id LIMIT 501`);
  const sourceBytes=sourceIndex.reduce((n,r)=>n+Number(r.payload_bytes),0);
  if(sourceIndex.length>500||sourceBytes>16*1024*1024)throw Object.assign(new Error('Editorial sources exceed capacity.'),{statusCode:422});
  const sources=sourceIndex.length?await reader.rows(sql`SELECT id,kind,source_id,headline,url,published_at,observed_at,source_sha256,provenance_json FROM ts_editorial_sources WHERE id IN (${sql.join(sourceIndex.map(s=>sql`${s.id}`),sql`,`)}) ORDER BY published_at,id`):[];
  const aliases=await reader.rows(sql`SELECT id FROM ts_editorial_events WHERE merged_into=${id} ORDER BY id LIMIT 501`);
  if(aliases.length>500)throw Object.assign(new Error('Editorial history exceeds alias capacity.'),{statusCode:422});
  const eventIds=[id,...aliases.map(e=>String(e.id))];
  // Each branch reads at most100 index entries. Older entries cannot enter the global top100.
  const branches=sql.join(eventIds.map(eventId=>sql`(SELECT sequence FROM ts_editorial_audit_events WHERE event_id=${eventId} ORDER BY sequence DESC LIMIT 100)`),sql` UNION ALL `);
  const historyRows=await reader.rows(sql`SELECT a.sequence,OCTET_LENGTH(a.before_json)+OCTET_LENGTH(a.after_json) AS payload_bytes FROM ts_editorial_audit a JOIN (SELECT DISTINCT sequence FROM (${branches}) candidates ORDER BY sequence DESC LIMIT 100) selected ON selected.sequence=a.sequence ORDER BY a.sequence DESC`);
  if(sourceBytes+historyRows.reduce((n,r)=>n+Number(r.payload_bytes),0)>16*1024*1024)throw Object.assign(new Error('Editorial history exceeds payload capacity.'),{statusCode:422});
  const sequences=historyRows.map(r=>String(r.sequence));
  const changes=sequences.length?await reader.rows(sql`SELECT action,created_at,before_json,after_json FROM ts_editorial_audit WHERE sequence IN (${sql.join(sequences.map(n=>sql`${n}`),sql`,`)}) ORDER BY sequence DESC`):[];
  const current=(await reader.rows(sql`SELECT version,merged_into FROM ts_editorial_events WHERE id=${id}`))[0];
  if(!current||current.merged_into!==null||String(current.version)!==String(row.version))throw Object.assign(new Error('Editorial event changed during this read. Retry the request.'),{statusCode:409});
  return {updatedAt:utc(row.updated_at),requestedId,canonicalId:id,event:{...row,created_at:utc(row.created_at),updated_at:utc(row.updated_at)},sources:sources.map(s=>({...s,...(s.kind==='video'?{thumbnail:canonicalVideoThumbnail(String(s.source_id))}:{}),published_at:utc(s.published_at),observed_at:utc(s.observed_at),provenance:decode(s.provenance_json),provenance_json:undefined})),history:changes.map(c=>({action:c.action,at:utc(c.created_at),before:decode(c.before_json).events,after:decode(c.after_json).events})),historyLimit:100,association:'operator-reviewed',metricPolicy:'news-and-youtube-separate'};
 });
}
function utc(v:unknown){if(v===null||v===undefined)return null;if(v instanceof Date)return v.toISOString();if(typeof v==='string'&&/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(?:\.\d{1,6})?$/.test(v))return new Date(v.replace(' ','T')+'Z').toISOString();throw new Error('Editorial timestamp format invalid');}
