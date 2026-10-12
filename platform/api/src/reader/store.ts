import mysql,{type Pool,type PoolConnection,type RowDataPacket} from 'mysql2/promise';
import {AccountError,FOLLOWS_MAX,SAVES_MAX,utcSql,utc,type Follow,type FollowKind,type Saved,type SaveKind} from './contracts.js';
export interface AccountStore {
 ready():Promise<boolean>;close():Promise<void>;
 follows(id:number):Promise<Follow[]>;follow(id:number,kind:FollowKind,target:string,on:boolean,at:Date):Promise<void>;
 saves(id:number):Promise<Saved[]>;save(id:number,kind:SaveKind,target:string,on:boolean,note:string,at:Date):Promise<void>;
 feedStatus(id:number):Promise<string|null>;rotateFeed(id:number,hash:string,at:Date):Promise<void>;revokeFeed(id:number):Promise<void>;feedUser(hash:string):Promise<number|null>;
}
/** Separate bounded pool; account writes never use the public report Reader. */
export function mysqlAccountStore(databaseUrl:string):AccountStore{
 const pool=mysql.createPool({uri:databaseUrl,connectionLimit:3,queueLimit:12,connectTimeout:3000,dateStrings:true,timezone:'Z',supportBigNumbers:true,bigNumberStrings:true,multipleStatements:false});
 const query=async<T extends RowDataPacket[]>(statement:string,args:unknown[]=[])=>{const db=await acquire(pool);try{const [rows]=await db.query<T>({sql:'SET STATEMENT max_statement_time=5 FOR '+statement,timeout:6000},args);return rows;}finally{db.release();}};
 const transaction=async(id:number,work:(db:PoolConnection)=>Promise<void>)=>{
  const db=await acquire(pool);try{await db.query({sql:'SET SESSION innodb_lock_wait_timeout=3,max_statement_time=5',timeout:6000});await db.beginTransaction();const [users]=await db.query<RowDataPacket[]>('SELECT id FROM ts_auth_users WHERE id=? AND disabled_at IS NULL FOR UPDATE',[id]);if(!users.length)throw new AccountError('ACCOUNT_UNAVAILABLE',401);await work(db);await db.commit();}catch(error){await db.rollback().catch(()=>{});throw error;}finally{db.release();}
 };
 return {
  async ready(){try{const engines=await query("SELECT COUNT(*) n FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN ('ts_reader_follows','ts_reader_saves','ts_reader_feed_tokens') AND engine='InnoDB'");if(Number(engines[0]?.n)!==3)return false;await query('SELECT user_id,kind,target,created_at FROM ts_reader_follows LIMIT 0');await query('SELECT user_id,kind,target,note,created_at,updated_at FROM ts_reader_saves LIMIT 0');await query('SELECT user_id,token_hash,created_at FROM ts_reader_feed_tokens LIMIT 0');return true;}catch{return false;}},close:()=>pool.end(),
  async follows(id){return (await query('SELECT kind,target,created_at FROM ts_reader_follows WHERE user_id=? ORDER BY created_at DESC,kind,target LIMIT 200',[id])).map(r=>({kind:r.kind as FollowKind,target:String(r.target),createdAt:utc(r.created_at)}));},
  async follow(id,kind,value,on,at){await transaction(id,async db=>{
   if(!on){await db.execute('DELETE FROM ts_reader_follows WHERE user_id=? AND kind=? AND target=?',[id,kind,value]);return;}
   const [rows]=await db.query<RowDataPacket[]>('SELECT target FROM ts_reader_follows WHERE user_id=? AND kind=? AND target=?',[id,kind,value]);if(rows.length)return;
   const [counts]=await db.query<RowDataPacket[]>('SELECT COUNT(*) n FROM ts_reader_follows WHERE user_id=?',[id]);if(Number(counts[0]?.n)>=FOLLOWS_MAX)throw new AccountError('FOLLOW_LIMIT',409);
   await db.execute('INSERT INTO ts_reader_follows (user_id,kind,target,created_at) VALUES (?,?,?,?)',[id,kind,value,utcSql(at)]);
  });},
  async saves(id){return (await query('SELECT kind,target,note,created_at,updated_at FROM ts_reader_saves WHERE user_id=? ORDER BY updated_at DESC,kind,target LIMIT 500',[id])).map(r=>({kind:r.kind as SaveKind,target:String(r.target),note:String(r.note),createdAt:utc(r.created_at),updatedAt:utc(r.updated_at)}));},
  async save(id,kind,value,on,note,at){await transaction(id,async db=>{
   if(!on){await db.execute('DELETE FROM ts_reader_saves WHERE user_id=? AND kind=? AND target=?',[id,kind,value]);return;}
   const [rows]=await db.query<RowDataPacket[]>('SELECT target FROM ts_reader_saves WHERE user_id=? AND kind=? AND target=?',[id,kind,value]);
   if(!rows.length){const [counts]=await db.query<RowDataPacket[]>('SELECT COUNT(*) n FROM ts_reader_saves WHERE user_id=?',[id]);if(Number(counts[0]?.n)>=SAVES_MAX)throw new AccountError('SAVE_LIMIT',409);}
   await db.execute('INSERT INTO ts_reader_saves (user_id,kind,target,note,created_at,updated_at) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE note=VALUES(note),updated_at=VALUES(updated_at)',[id,kind,value,note,utcSql(at),utcSql(at)]);
  });},
  async feedStatus(id){const rows=await query('SELECT created_at FROM ts_reader_feed_tokens WHERE user_id=?',[id]);return rows[0]?utc(rows[0].created_at):null;},
  async rotateFeed(id,hash,at){await transaction(id,async db=>{await db.execute('INSERT INTO ts_reader_feed_tokens(user_id,token_hash,created_at) VALUES(?,?,?) ON DUPLICATE KEY UPDATE token_hash=VALUES(token_hash),created_at=VALUES(created_at)',[id,hash,utcSql(at)]);});},
  async revokeFeed(id){await transaction(id,async db=>{await db.execute('DELETE FROM ts_reader_feed_tokens WHERE user_id=?',[id]);});},
  async feedUser(hash){const rows=await query('SELECT t.user_id FROM ts_reader_feed_tokens t JOIN ts_auth_users u ON u.id=t.user_id WHERE t.token_hash=? AND u.disabled_at IS NULL LIMIT 1',[hash]);const id=Number(rows[0]?.user_id);return Number.isSafeInteger(id)&&id>0?id:null;},
 };
}
async function acquire(pool:Pool):Promise<PoolConnection>{
 let settled=false;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{settled=true;reject(new AccountError('ACCOUNT_UNAVAILABLE',503));},3000);pool.getConnection().then(c=>{if(settled){c.release();return;}settled=true;clearTimeout(timer);resolve(c);},()=>{if(!settled){settled=true;clearTimeout(timer);reject(new AccountError('ACCOUNT_UNAVAILABLE',503));}});});
}
