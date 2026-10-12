import mysql,{type Connection} from 'mysql2/promise';
import {connectDatabase} from '../../../jobs/src/database.js';

/** Public source reads and own-state mutations must never share production credentials. */
export function frontendDatabases(env:NodeJS.ProcessEnv){
 if(env.APP_ENV!==undefined&&!['production','local','preview','test'].includes(env.APP_ENV))throw new Error('Invalid frontend application environment');
 if(env.TS_FRONTEND_SCHEMA_MODE!==undefined&&env.TS_FRONTEND_SCHEMA_MODE!==''&&env.TS_FRONTEND_SCHEMA_MODE!=='isolated')throw new Error('Unknown frontend schema mode');
 const reports=env.DATABASE_URL,local=(env.APP_ENV??env.NODE_ENV)!=='production';
 if(!local&&env.TS_FRONTEND_SCHEMA_MODE!=='isolated')throw new Error('Production frontend requires isolated schema mode');
 const auth=env.AUTH_DATABASE_URL||env.TS_DATABASE_URL||(local?reports:undefined);
 const state=env.TS_DATABASE_URL||env.AUTH_DATABASE_URL||(local?reports:undefined);
 if(env.TS_FRONTEND_SCHEMA_MODE==='isolated'){
  const parse=(raw:string|undefined)=>{try{const url=new URL(raw??'');if(url.protocol!=='mysql:'||url.search||url.hash||!url.username||!/^\/youtube_board_ts(?:_[a-z0-9_]+)?$/.test(url.pathname))throw Error();return url;}catch{throw new Error('Invalid isolated frontend database configuration');}};
  const read=parse(reports),own=parse(state),login=parse(auth);
  if(decodeURIComponent(own.username)!==decodeURIComponent(login.username)||decodeURIComponent(own.password)!==decodeURIComponent(login.password))throw new Error('Isolated frontend requires the same auth and own-state principal');
  if([own,login].some(url=>url.hostname!==read.hostname||(url.port||'3306')!==(read.port||'3306')||url.pathname!==read.pathname||decodeURIComponent(url.username)===decodeURIComponent(read.username)))throw new Error('Isolated frontend requires separate read and own-state principals on the same new schema');
 }
 return {reports,auth,state};
}

/** Editorial writes use own-state credentials; they never borrow the report principal. */
export async function connectEditorialDatabase(env:NodeJS.ProcessEnv):Promise<Connection>{
 const url=frontendDatabases(env).state;
 if(url){const db=await mysql.createConnection({uri:url,dateStrings:true,timezone:'Z',supportBigNumbers:true,bigNumberStrings:true,multipleStatements:false,connectTimeout:5000});try{await db.query("SET SESSION sql_mode=CONCAT_WS(',',NULLIF(@@sql_mode,''),'STRICT_ALL_TABLES')");return db;}catch(error){await db.end();throw error;}}
 if((env.APP_ENV??env.NODE_ENV)==='production')throw new Error('Editorial own-state database is not configured');
 return connectDatabase(env);
}
