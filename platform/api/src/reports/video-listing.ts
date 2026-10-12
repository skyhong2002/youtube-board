import {sql} from 'drizzle-orm';
import type {Reader,Row} from '../db/client.js';
import type {VideoRow} from '../contracts.js';
import {video,integer,text,tags,latest} from './normalize.js';
/** Scalar summary columns only: never load comment/archive text for a list page. */
export async function enrichVideoListings(reader:Reader,rows:Row[],scope:NonNullable<VideoRow['listing']>['scope'],names:Map<number,string>):Promise<VideoRow[]>{
 const comments=new Map<string,Row>();if(scope==='channel'&&rows.length){const ids=[...new Set(rows.map(r=>text(r.videoId)))],where=sql`videoId IN (${sql.join(ids.map(id=>sql`${id}`),sql`,`)}) AND BINARY videoId IN (${sql.join(ids.map(id=>sql`BINARY ${id}`),sql`,`)})`;
  const summaries=await reader.rows(sql`SELECT videoId,pageToken,comments_count,authors_count,replies_count,likes_count,ctime,mtime FROM urt_comment WHERE pk IN (SELECT MAX(pk) FROM urt_comment WHERE ${where} GROUP BY BINARY videoId)`);for(const r of summaries)comments.set(text(r.videoId),r);
 }
 const count=(v:unknown)=>{const n=integer(v);return n!==null&&n>=0?n:null;},visible=new Set([1,2,3,4,5,6,60,43,48,49,81]);
 return rows.map(r=>{const row=video(r),summary=comments.get(row.id),complete=!!summary&&!text(summary.pageToken),recorded=complete?count(summary.comments_count):null,shown=scope==='channel'&&recorded!==null?recorded:row.comments,dislikes=count(r.dislikeCount),reaction=count(row.likes)!==null&&dislikes!==null&&count(shown)!==null?row.likes!+dislikes+shown!:null;
  return {...row,updatedAt:latest(row.updatedAt,complete?summary.mtime:null,complete?summary.ctime:null),comments:shown,listing:{scope,providerComments:row.comments,recordedComments:recorded,commentStatus:scope==='channel'?(summary?complete?'complete':'pending':'missing'):null,commentAuthors:complete?count(summary.authors_count):null,commentReplies:complete?count(summary.replies_count):null,commentLikes:complete?count(summary.likes_count):null,likeSharePercent:reaction!==null&&Number.isSafeInteger(reaction)&&reaction>0&&row.likes!==null?row.likes/reaction*100:null,commentsPerThousandViews:row.views!==null&&row.views>0&&count(row.comments)!==null?row.comments!/row.views*1000:null,commentObservedAt:complete?latest(summary.mtime,summary.ctime):null,tags:scope==='taxonomy'?tags(r.tags,names).filter(t=>visible.has(t.id)):[]}};
 });
}
