import type {Connection,RowDataPacket,ResultSetHeader} from 'mysql2/promise';
import type {ChannelProfile} from '../../ingestion/src/youtube.js';
import {taipeiSql} from '../../ingestion/src/legacy-db.js';
import {appendAudit,candidateState} from './service.js';
import {canonical,decode,fail,hash,sqlTime,uuid} from './contracts.js';
export interface AdoptionInput {candidateId:string;expectedVersion:number;requestId:string}
export interface AdoptionContext {db:Connection;execute:boolean;actor:string;now:Date;assertOwnership:()=>Promise<void>;profiles:(ids:string[])=>Promise<Map<string,ChannelProfile>>}
/** MyISAM channel inserts cannot roll back. A unique exact UC id makes interrupted insert→audit replay repairable. */
export async function adoptCandidate(ctx:AdoptionContext,input:AdoptionInput){
 if(!uuid(input.candidateId)||!uuid(input.requestId)||!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<1)return fail('INVALID_ADOPTION');
 const {db}=ctx,inputHash=hash(canonical({action:'candidate.adopt',...input}));
 const[requests]=await db.query<RowDataPacket[]>('SELECT input_sha256,actor,result_json FROM ts_editorial_requests WHERE request_id=?',[input.requestId]);
 if(requests[0]){if(requests[0].input_sha256!==inputHash||requests[0].actor!==ctx.actor)return fail('REQUEST_ID_CONFLICT',409);return {...decode(requests[0].result_json),replayed:true};}
 const candidate=await candidateState(db,input.candidateId);if(!candidate)return fail('CANDIDATE_NOT_FOUND',404);if(candidate.version!==input.expectedVersion)return fail('VERSION_CONFLICT',409);if(candidate.status!=='approved')return fail('CANDIDATE_NOT_APPROVED',409);
 const[existing]=await db.query<RowDataPacket[]>('SELECT u_id,youtube_id,flag_del FROM urt_channel WHERE BINARY youtube_id=BINARY ? LIMIT 2',[candidate.channelId]);if(existing.length>1)return fail('AMBIGUOUS_CHANNEL',409);if(existing[0]&&existing[0].flag_del!==null&&Number(existing[0].flag_del)>=1)return fail('EXISTING_CHANNEL_RETIRED',409);
 if(!ctx.execute)return {mode:'dry-run',candidate,existingUId:existing[0]?.u_id??null,externalCalls:0,writes:0};
 await ctx.assertOwnership();
 const profiles=await ctx.profiles([candidate.channelId]),profile=profiles.get(candidate.channelId);if(!profile||profile.id!==candidate.channelId)return fail('PROVIDER_CHANNEL_MISSING',409);
 await ctx.assertOwnership();const at=taipeiSql(ctx.now);let uId=Number(existing[0]?.u_id??0);
 if(!uId){const[result]=await db.execute<ResultSetHeader>('INSERT INTO urt_channel(ctime,mtime,youtube_id,title,description,publishedAt,thumbnails,uploads,viewCount,subscriberCount,videoCount) VALUES(?,?,?,?,?,?,?,?,?,?,?)',[at,at,profile.id,profile.title,profile.description,taipeiSql(new Date(profile.publishedAt)),profile.thumbnail,profile.uploads,profile.statistics.viewCount,profile.statistics.subscriberCount,profile.statistics.videoCount]);uId=result.insertId;}
 // Existing channels are adopted by reference; no taxonomy changes or automatic source refresh.
 await db.beginTransaction();try{
  await ctx.assertOwnership();const current=await candidateState(db,candidate.id);if(!current||current.version!==candidate.version||current.status!=='approved')return fail('VERSION_CONFLICT',409);
  const next={...candidate,status:'adopted',adoptedUId:uId,version:candidate.version+1};
  await db.execute("UPDATE ts_editorial_candidates SET status='adopted',adopted_u_id=?,version=?,updated_at=? WHERE id=?",[uId,next.version,sqlTime(ctx.now),candidate.id]);
  const result={mode:'execute',candidate:next,channelId:profile.id,uId,replayed:false};
  await appendAudit(db,{requestId:input.requestId,action:'candidate.adopt',actor:ctx.actor,reason:'Reviewed approved candidate source adoption',before:{candidate},after:{candidate:next,profile},inputHash,result,at:sqlTime(ctx.now)});
  await ctx.assertOwnership();await db.commit();return result;
 }catch(error){await db.rollback().catch(()=>undefined);throw error;}
}
