import {sql} from 'drizzle-orm';
import {DataQueryFailed,DataSourceUnavailable,type Reader} from '../db/client.js';
import {text} from './normalize.js';
export const ADMIN_RANKING_EXCLUSION='admin-ranking-exclusion' as const;
/** Term keys an administrator excluded from the ranking display. The latest approved
 * youtube-ranking-display review per term key wins; term_key hashes source and exact
 * label, so a decision follows the same label into later vocabulary versions. Without
 * the review tables or the report grant (not yet provisioned) there are no overrides: the static
 * display policy still applies and the ranking stays available. */
export async function rankingDisplayExclusions(reader:Reader):Promise<Set<string>>{
 let rows;
 try{rows=await reader.rows(sql`SELECT term_key,JSON_UNQUOTE(JSON_EXTRACT(state_json,'$.decision')) AS decision FROM ts_keyword_reviews WHERE context='youtube-ranking-display' AND status='approved' ORDER BY updated_at,created_at,id LIMIT 20001`,{operation:'ranking-exclusions'});}
 catch(error){
  // Only a missing table or grant means "not provisioned"; outages still fail the section.
  if(error instanceof DataQueryFailed&&error.driverCode==='ER_NO_SUCH_TABLE'||error instanceof DataSourceUnavailable&&error.cause==='ER_TABLEACCESS_DENIED_ERROR')return new Set();
  throw error;
 }
 const latest=new Map<string,string>();for(const r of rows.slice(0,20000))latest.set(text(r.term_key),text(r.decision));
 return new Set([...latest].filter(([,decision])=>decision==='exclude').map(([key])=>key));
}
