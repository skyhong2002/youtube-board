import mysql,{type RowDataPacket} from 'mysql2/promise';
import {sql} from 'drizzle-orm';
import type {FastifyInstance} from 'fastify';
import type {AuthRuntime} from '../auth/index.js';
import {privateAuthReply} from '../auth/index.js';
import {createReader,DataQueryFailed,DataSourceUnavailable,type Reader,type Row} from '../db/client.js';
import {enrichPublicMedia} from '../reports/media.js';
import {integer,tagIds,taipeiSql,text,timestamp} from '../reports/normalize.js';
import type {AccountActivity,AccountActivityList,EditorialActivityKind,ManagedChannel,ManagedChannelList,ManagedChannelStatus} from '../../../shared/manage-contracts.js';
const DAY=86400000,QUIET_DAYS=30,STALE_DAYS=3,CHANNELS_MAX=20000;
/** State-schema DATETIME(3) values are UTC wall time; legacy urt_* values are Taipei and go through timestamp(). */
const utc=(value:unknown)=>{const s=text(value);if(!s)return null;const at=new Date(s.includes('T')?s:s.replace(' ','T')+'Z');return Number.isFinite(+at)?at.toISOString():null;};
const later=(a:string|null,b:string|null)=>!a?b:!b?a:a>b?a:b;
export const editorialKind=(action:string):EditorialActivityKind=>action==='candidate.submit'?'nomination':action.startsWith('candidate.')?'decision':'event';
type Group={id:unknown;n?:unknown;at?:unknown;action?:unknown};
export interface ActivityGroups {follows:Group[];saves:Group[];apiKeys:Group[];feeds:Group[];sessions:Group[];roles:Group[];editorial:Group[]}
/** Per-account counts from the account and audit tables; accounts without any row are left to the caller. */
export function accountActivity(groups:ActivityGroups):AccountActivity[]{
 const out=new Map<number,AccountActivity>();
 const entry=(row:Group)=>{const id=integer(row.id);if(id===null||id<1)return null;let item=out.get(id);if(!item)out.set(id,item={userId:id,follows:0,saves:0,apiKeys:0,feed:false,sessions:0,editorial:{event:0,nomination:0,decision:0},roleChanges:0,lastActiveAt:null});item.lastActiveAt=later(item.lastActiveAt,utc(row.at));return item;};
 const count=(row:Group)=>integer(row.n)??0;
 for(const row of groups.follows){const item=entry(row);if(item)item.follows=count(row);}
 for(const row of groups.saves){const item=entry(row);if(item)item.saves=count(row);}
 for(const row of groups.apiKeys){const item=entry(row);if(item)item.apiKeys=count(row);}
 for(const row of groups.feeds){const item=entry(row);if(item)item.feed=true;}
 // A session is a login, not an action, so it never moves lastActiveAt.
 for(const row of groups.sessions){const item=entry({id:row.id});if(item)item.sessions=count(row);}
 for(const row of groups.roles){const item=entry(row);if(item)item.roleChanges=count(row);}
 for(const row of groups.editorial){const item=entry(row);if(item)item.editorial[editorialKind(text(row.action))]+=count(row);}
 return [...out.values()].sort((a,b)=>a.userId-b.userId);
}
export interface ActivityStore {activity():Promise<AccountActivity[]>;close():Promise<void>}
/** Small read-only pool on the account (state) credentials; keyword-review and candidate tables are outside its grants. */
export function mysqlActivityStore(databaseUrl:string):ActivityStore{
 const pool=mysql.createPool({uri:databaseUrl,connectionLimit:2,queueLimit:16,connectTimeout:3000,dateStrings:true,timezone:'Z',supportBigNumbers:true,bigNumberStrings:true,multipleStatements:false});
 const query=async(statement:string)=>{const [rows]=await pool.query<RowDataPacket[]>({sql:'SET STATEMENT max_statement_time=5 FOR '+statement,timeout:6000});return rows as Group[];};
 return {close:()=>pool.end(),async activity(){
  const [follows,saves,apiKeys,feeds,sessions,roles,editorial]=await Promise.all([
   query('SELECT user_id id,COUNT(*) n,MAX(created_at) at FROM ts_reader_follows GROUP BY user_id'),
   query('SELECT user_id id,COUNT(*) n,MAX(updated_at) at FROM ts_reader_saves GROUP BY user_id'),
   query('SELECT user_id id,SUM(revoked_at IS NULL) n,MAX(GREATEST(created_at,COALESCE(last_used_at,created_at),COALESCE(revoked_at,created_at))) at FROM ts_reader_api_keys GROUP BY user_id'),
   query('SELECT user_id id,created_at at FROM ts_reader_feed_tokens'),
   query('SELECT user_id id,COUNT(*) n FROM ts_auth_sessions WHERE expires_at>UTC_TIMESTAMP(3) GROUP BY user_id'),
   query('SELECT actor_id id,COUNT(*) n,MAX(created_at) at FROM ts_auth_role_audit WHERE actor_id IS NOT NULL GROUP BY actor_id'),
   query("SELECT SUBSTRING(actor,6) id,action,COUNT(*) n,MAX(created_at) at FROM ts_editorial_audit WHERE actor LIKE 'user:%' GROUP BY actor,action LIMIT 10000"),
  ]);
  return accountActivity({follows,saves,apiKeys,feeds,sessions,roles,editorial});
 }};
}
export function channelStatus(row:{archived:boolean;latestVideoAt:string|null;statsAt:string|null},now:Date):ManagedChannelStatus{
 if(row.archived)return 'archived';if(!row.latestVideoAt)return 'empty';
 if(!row.statsAt||+now-Date.parse(row.statsAt)>STALE_DAYS*DAY)return 'stale';
 return +now-Date.parse(row.latestVideoAt)>QUIET_DAYS*DAY?'quiet':'active';
}
/** Every tracked channel, archived included, with collection health; the public directory hides archived ones. */
export async function managedChannels(reader:Reader,now:Date):Promise<ManagedChannelList>{
 const since=taipeiSql(new Date(+now-7*DAY));
 const [rows,latest,recent,names]=await Promise.all([
  reader.rows(sql`SELECT c.u_id,c.youtube_id,LEFT(c.title,256) AS title,c.flag_del,c.ctime,c.stime,c.subscriberCount,c.videoCount,n.tags FROM urt_channel c LEFT JOIN urt_count n ON n.u_id=c.u_id ORDER BY c.u_id LIMIT ${CHANNELS_MAX+1}`),
  reader.rows(sql`SELECT u_id,MAX(publishedAt) AS latest FROM urt_video GROUP BY u_id`),
  reader.rows(sql`SELECT u_id,COUNT(*) AS n FROM urt_video WHERE publishedAt>=${since} GROUP BY u_id`),
  reader.rows(sql`SELECT tag_id,LEFT(tag_name,64) AS tag_name FROM urt_tag ORDER BY tag_id LIMIT 1000`),
 ]);
 if(rows.length>CHANNELS_MAX)throw new DataQueryFailed('MANAGE_CHANNEL_BOUND');
 const byChannel=(list:Row[],key:string)=>new Map(list.map(r=>[integer(r.u_id)??0,r[key]]));
 const latestAt=byChannel(latest,'latest'),week=byChannel(recent,'n'),used=new Set<number>();
 const channels=rows.flatMap((r):ManagedChannel[]=>{
  const id=integer(r.u_id);if(id===null||id<1)return [];
  const tags=tagIds(r.tags),latestVideoAt=timestamp(latestAt.get(id)),statsAt=timestamp(r.stime);for(const tag of tags)used.add(tag);
  return [{channelId:id,channelTitle:text(r.title)||String(id),youtubeChannelId:text(r.youtube_id),status:channelStatus({archived:integer(r.flag_del)!==null&&integer(r.flag_del)!>=1,latestVideoAt,statsAt},now),tags,subscribers:integer(r.subscriberCount),videos:integer(r.videoCount),weekVideos:integer(week.get(id))??0,latestVideoAt,statsAt,addedAt:timestamp(r.ctime)}];
 });
 const tags=names.flatMap(r=>{const id=integer(r.tag_id);return id!==null&&used.has(id)?[{id,name:text(r.tag_name)||String(id)}]:[];});
 return enrichPublicMedia(reader,{channels,tags,generatedAt:now.toISOString(),quietDays:QUIET_DAYS,staleDays:STALE_DAYS});
}
const unavailableCodes=new Set(['ECONNREFUSED','ECONNRESET','ETIMEDOUT','PROTOCOL_CONNECTION_LOST','ER_ACCESS_DENIED_ERROR','ER_DBACCESS_DENIED_ERROR','ER_TABLEACCESS_DENIED_ERROR','ER_STATEMENT_TIMEOUT','ER_NO_SUCH_TABLE','ER_CON_COUNT_ERROR']);
/** Session-admin overview reads behind /auth/admin; Fastify owns /auth in production, so the UI proxy never serves them. */
export async function registerManage(app:FastifyInstance,auth:AuthRuntime,options:{stateUrl?:string;reportsUrl?:string;store?:ActivityStore|null;reader?:Reader;clock?:()=>Date}={}){
 const clock=options.clock??(()=>new Date()),store=options.store!==undefined?options.store:auth.enabled&&options.stateUrl?mysqlActivityStore(options.stateUrl):null,reader=options.reader??createReader(options.reportsUrl);
 app.addHook('onClose',async()=>{if(store&&options.store===undefined)await store.close();if(!options.reader)await reader.close();});
 await app.register(async routes=>{
  routes.setErrorHandler((error,_request,reply)=>{privateAuthReply(reply);const code=error&&typeof error==='object'&&'code' in error?String(error.code):'';const unavailable=error instanceof DataSourceUnavailable||error instanceof DataQueryFailed||unavailableCodes.has(code);return reply.code(unavailable?503:500).send({error:{code:unavailable?'ACCOUNT_UNAVAILABLE':'ACCOUNT_FAILED'}});});
  routes.get('/auth/admin/user-activity',async(req,reply)=>{if(!await auth.requireAdmin(req,reply))return reply;if(!store)return reply.code(503).send({error:{code:'ACCOUNT_UNAVAILABLE'}});return {activity:await store.activity(),generatedAt:clock().toISOString()} satisfies AccountActivityList;});
  routes.get('/auth/admin/channels',async(req,reply)=>{if(!await auth.requireAdmin(req,reply))return reply;return managedChannels(reader,clock());});
 });
}
