import type {Connection,RowDataPacket} from 'mysql2/promise';
import type {workerSchema} from './worker-schema.js';
type Schema=NonNullable<ReturnType<typeof workerSchema>>;
/** SHOW GRANTS on self/PUBLIC needs no mysql.* privileges. Never return/log raw
 * grants: MariaDB includes the current account's authentication hash in USAGE. */
export async function verifyWorkerGrants(db:Connection,schema:Schema,expectedUser:string){
 try{
  const[identity]=await db.query<RowDataPacket[]>('SELECT CURRENT_USER() AS identity');
  const value=String(identity[0]?.identity??''),at=value.indexOf('@'),user=value.slice(0,at),host=value.slice(at+1);
  if(at<1||user!==expectedUser||!/^[a-z][a-z0-9_]{0,31}$/.test(user)||!/^[a-zA-Z0-9_.:%/-]{1,255}$/.test(host))throw Error();
  const principal='`'+user+'`@`'+host+'`',expected=new Map<string,string[]>();
  for(const[table,rights]of Object.entries(schema.tables)){expected.set(schema.mapping[table]!.schema+'.'+table,[...rights].sort());expected.set(schema.facade+'.'+table,[...rights,'SHOW VIEW'].sort());}
  const[rows]=await db.query<RowDataPacket[]>('SHOW GRANTS'),actual=new Map<string,string[]>();let usage=false;
  for(const row of rows){const raw=Object.values(row)[0];if(typeof raw!=='string')throw Error();
   // Strip only the documented native-password hash clause; unsupported syntax
   // fails closed. No authentication value survives beyond this local scope.
   const statement=raw.replace(/ IDENTIFIED BY PASSWORD '[^']*'/,'');
   if(statement==='GRANT USAGE ON *.* TO '+principal){if(usage)throw Error();usage=true;continue;}
   const grant=/^GRANT ([A-Z ,]+) ON `([a-z][a-z0-9_]{0,63})`\.`([a-z][a-z0-9_]{0,63})` TO (.+)$/.exec(statement);
   if(!grant||grant[4]!==principal)throw Error();const key=grant[2]+'.'+grant[3],rights=grant[1]!.split(',').map(r=>r.trim()).sort();if(actual.has(key))throw Error();actual.set(key,rights);
  }
  if(!usage||actual.size!==expected.size||[...expected].some(([key,rights])=>JSON.stringify(actual.get(key))!==JSON.stringify(rights)))throw Error();
  const[publicRows]=await db.query<RowDataPacket[]>('SHOW GRANTS FOR PUBLIC');
  if(publicRows.some(row=>Object.values(row)[0]!=='GRANT USAGE ON *.* TO PUBLIC'))throw Error();
  // Inherited roles may be activated independently of the direct grant syntax.
  const[roles]=await db.query<RowDataPacket[]>('SELECT ROLE_NAME FROM information_schema.APPLICABLE_ROLES');if(roles.length)throw Error();
  const[enabled]=await db.query<RowDataPacket[]>('SELECT ROLE_NAME FROM information_schema.ENABLED_ROLES');if(enabled.some(r=>r.ROLE_NAME!==null&&r.ROLE_NAME!==undefined))throw Error();
 }catch{throw new Error('Worker effective grants do not match the reviewed profile');}
}
