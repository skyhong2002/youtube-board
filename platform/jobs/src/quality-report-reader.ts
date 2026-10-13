import mysql,{type Connection,type RowDataPacket,type ExecuteValues} from 'mysql2/promise';
import {MySqlDialect} from 'drizzle-orm/mysql-core';
import type {Reader,Row} from '../../api/src/db/client.js';
import type {SQL} from 'drizzle-orm';
export function qualityReaderError(message:string,error:unknown){
 const value=error as {code?:unknown;errno?:unknown}|null,parts:string[]=[];
 if(typeof value?.code==='string'&&/^[A-Z][A-Z0-9_]{0,63}$/.test(value.code))parts.push(value.code);
 if(typeof value?.errno==='number'&&Number.isSafeInteger(value.errno)&&value.errno>=0&&value.errno<=65535)parts.push(String(value.errno));
 return Error(message+(parts.length?' ['+parts.join('/')+']':''));
}
/** Never return SHOW GRANTS text: USAGE may include an authentication hash. */
export function assertQualityReadGrants(rows:Record<string,unknown>[],publicRows:Record<string,unknown>[],roles:Record<string,unknown>[],expectedSchema:string,sourceSchema?:string){
 const schemas=[expectedSchema,...(sourceSchema?[sourceSchema]:[])];
 if(schemas.some(s=>!/^[a-z][a-z0-9_]{0,63}$/.test(s)||['mysql','information_schema','performance_schema','sys'].includes(s)))throw Error('Invalid quality report schema allowlist');
 if(!rows.length||roles.length)throw Error('Quality report account must have direct read-only grants');
 for(const row of rows){const raw=Object.values(row)[0];if(typeof raw!=='string')throw Error('Invalid quality report grants');
  const text=raw.replace(/ IDENTIFIED BY PASSWORD '[^']*'/,'');
  const match=/^GRANT (USAGE|SELECT|SHOW VIEW|SELECT, SHOW VIEW) ON (\*|`[a-z][a-z0-9_]{0,63}`)\.(\*|`[a-z][a-z0-9_]{0,63}`) TO `[^`]+`@`[^`]+`$/.exec(text);
  if(!match||(match[1]==='USAGE'?(match[2]!=='*'||match[3]!=='*'):!schemas.includes(match[2]!.replaceAll('`',''))))throw Error('Quality report grants exceed the reviewed schema allowlist');
 }
 if(publicRows.some(row=>Object.values(row)[0]!=='GRANT USAGE ON *.* TO PUBLIC'))throw Error('Quality report PUBLIC grants must be empty');
}
export function assertQualityReportIdentity(writer:Record<string,unknown>,reader:Record<string,unknown>,schema:string){
 if(!/^[a-z][a-z0-9_]{0,63}$/.test(schema)||reader.db!==schema||!writer.host||writer.server_id===undefined||String(writer.server_id)!==String(reader.server_id)||writer.host!==reader.host||String(writer.port)!==String(reader.port))throw Error('Quality report database does not match the writer target');
}
export async function createQualityReportReader(env:NodeJS.ProcessEnv,writer:Connection):Promise<Reader>{
 let url:URL;try{url=new URL(env.QUALITY_REPORT_DATABASE_URL??'');if(!['mysql:','mariadb:'].includes(url.protocol))throw Error();}catch{throw Error('A valid quality report database URL is required');}
 const expectedSchema=env.TS_WORKER_SCHEMA_MODE==='facade'?(env.TS_STATE_SCHEMA??'youtube_board_ts'):(env.DB_DATABASE??'youtube_board_rewrite');
 // Host spelling may differ, so validate actual server identity after connecting.
 let db:Connection;try{db=await mysql.createConnection({host:url.hostname,port:Number(url.port||3306),user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),database:decodeURIComponent(url.pathname.slice(1)),dateStrings:true,supportBigNumbers:true,bigNumberStrings:true,multipleStatements:false,connectTimeout:5000,timezone:'Z'});}catch(error){throw qualityReaderError('Quality report database connection unavailable',error);}
 try{
  const identity='SELECT @@hostname AS host,@@server_id AS server_id,@@port AS port,DATABASE() AS db';
  const [[w],[r]]=await Promise.all([writer.query<RowDataPacket[]>({sql:identity,timeout:5000}),db.query<RowDataPacket[]>({sql:identity,timeout:5000})]);
  assertQualityReportIdentity(w[0]??{},r[0]??{},expectedSchema);
  const [grants]=await db.query<RowDataPacket[]>('SHOW GRANTS'),[publicRows]=await db.query<RowDataPacket[]>('SHOW GRANTS FOR PUBLIC'),[roles]=await db.query<RowDataPacket[]>('SELECT ROLE_NAME FROM information_schema.APPLICABLE_ROLES');
  assertQualityReadGrants(grants,publicRows,roles,expectedSchema,env.TS_WORKER_SCHEMA_MODE==='facade'?(env.TS_SOURCE_SCHEMA??'youtube_board'):undefined);
  await db.query("SET SESSION time_zone='+00:00'");await db.query('SET SESSION TRANSACTION READ ONLY');
 }catch(error){await db.end().catch(()=>{});throw qualityReaderError('Quality report target or read-only grants could not be verified',error);}
 const dialect=new MySqlDialect();return {
  async rows<T extends Row>(query:SQL):Promise<T[]>{const q=dialect.sqlToQuery(query);if(!/^select\b/i.test(q.sql.trim()))throw Error('Quality report reader accepts SELECT only');try{const [rows]=await db.execute({sql:'SET STATEMENT max_statement_time=5 FOR '+q.sql,timeout:6000},q.params as ExecuteValues[]);return rows as T[];}catch(error){throw qualityReaderError('Quality coverage query unavailable',error);}},
  close:async()=>{await db.end();}
 };
}
