import {connectEditorialDatabase,frontendDatabases} from '../db/frontend.js';
import {mysqlReviewRepository,type ReviewRepository} from './repository.js';

/** Configuration only: constructing a repository never connects or migrates.
 * Bad/missing isolated configuration leaves the authenticated status route
 * schema-unavailable. Never borrow the source/report credential as fallback. */
export function configuredKeywordReviewRepository(env:NodeJS.ProcessEnv):ReviewRepository|undefined {
 if(env.TS_KEYWORD_REVIEW_ENABLED!=='true'||env.TS_FRONTEND_SCHEMA_MODE!=='isolated')return;
 try{
  const state=frontendDatabases(env).state;
  if(!state)return;
  const schema=new URL(state).pathname.slice(1);
  if(!/^youtube_board_ts(?:_[a-z0-9_]+)?$/.test(schema))return;
  return mysqlReviewRepository(()=>connectEditorialDatabase(env),schema);
 }catch{return;}
}
