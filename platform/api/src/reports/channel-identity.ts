import {sql} from 'drizzle-orm';
import type {Reader} from '../db/client.js';
import {NotFound} from './query.js';
import {text} from './normalize.js';

export interface ChannelIdentity {id:number;title:string;status:'active'|'archived';profileAvailable:boolean}
/** Public retained reports require an existing channel, not an active collector. */
export async function readChannelIdentity(reader:Reader,id:number):Promise<ChannelIdentity>{
 const row=(await reader.rows(sql`SELECT u_id,LEFT(title,256) AS title,flag_del FROM urt_channel WHERE u_id=${id} LIMIT 1`))[0];
 if(!row)throw new NotFound();
 const active=row.flag_del==null||Number(row.flag_del)<1;
 return {id,title:text(row.title),status:active?'active':'archived',profileAvailable:active};
}
export const channelHistoryPaths=new Set(['videos','comments','cloud','trends','ai','ai/days','people','prompt'].map(child=>'/channels/:id/'+child));
export function channelIdentityCoverage(channel:ChannelIdentity){return {channelId:channel.id,channelTitle:channel.title,channelStatus:channel.status,channelProfileAvailable:channel.profileAvailable};}
