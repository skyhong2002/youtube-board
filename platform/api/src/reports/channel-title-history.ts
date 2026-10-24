import {sql} from 'drizzle-orm';
import type {ChannelAvatar} from '../../../shared/media-assets.js';
import {readChannelAvatarRevisions} from '../../../shared/media-cache/index.js';
import {DataQueryFailed,DataSourceUnavailable,type Reader} from '../db/client.js';
import type {ChannelNameVersion} from '../contracts.js';
import {text} from './normalize.js';

export const CHANNEL_NAME_HISTORY_LIMIT=50;
/** Pair each observed name with the logo cached while it was current: the newest retained revision
 * cached before the next name appeared (the current name takes the newest revision overall). */
export function nameVersions(rows:Array<{title:string;observedAt:string}>,revisions:ChannelAvatar[]):ChannelNameVersion[]{
 const ascending=[...rows].sort((a,b)=>a.observedAt.localeCompare(b.observedAt));
 return ascending.map((row,i)=>{
  const end=ascending[i+1]?.observedAt,avatar=revisions.filter(r=>end===undefined||r.cachedAt<end).at(-1)??null;
  return {title:row.title,observedAt:row.observedAt,avatar};
 }).reverse();
}
/** Observed channel names, newest first; null when the table or grant is not provisioned. */
export async function channelNameHistory(reader:Reader,id:number,revisions:(id:number)=>Promise<ChannelAvatar[]>=readChannelAvatarRevisions):Promise<ChannelNameVersion[]|null>{
 let rows;
 try{rows=await reader.rows(sql`SELECT title,DATE_FORMAT(observed_at,'%Y-%m-%dT%H:%i:%s.000Z') AS observed FROM ts_channel_title_history WHERE u_id=${id} ORDER BY observed_at DESC,id DESC LIMIT ${CHANNEL_NAME_HISTORY_LIMIT}`,{operation:'channel-read'});}
 catch(error){
  // Only a missing table or grant means "not provisioned"; outages still fail the page.
  if(error instanceof DataQueryFailed&&error.driverCode==='ER_NO_SUCH_TABLE'||error instanceof DataSourceUnavailable&&error.cause==='ER_TABLEACCESS_DENIED_ERROR')return null;
  throw error;
 }
 if(rows.length<2)return [];
 return nameVersions(rows.map(r=>({title:text(r.title),observedAt:text(r.observed)})),await revisions(id));
}
