import {it,expect} from 'vitest';
import type {Connection} from 'mysql2/promise';
import {workerSchema} from '../../shared/worker-schema.js';
import {verifyWorkerGrants} from '../../shared/worker-grants.js';
const schema=workerSchema({TS_WORKER_SCHEMA_MODE:'facade',DB_DATABASE:'youtube_board_ts_worker',TS_WORKER_WORKFLOW:'youtube.videos.stats'})!,principal='`fixture_worker`@`10.0.0.0/255.255.255.0`';
function connection(extra:string[]=[],publicGrants:string[]=[],role=false){
 const grants=['GRANT USAGE ON *.* TO '+principal+" IDENTIFIED BY PASSWORD '*SYNTHETIC_HASH'",...Object.entries(schema.tables).flatMap(([table,rights])=>['GRANT '+rights.join(', ')+' ON `'+schema.mapping[table]!.schema+'`.`'+table+'` TO '+principal,'GRANT '+[...rights,'SHOW VIEW'].join(', ')+' ON `'+schema.facade+'`.`'+table+'` TO '+principal]),...extra];
 return {query:async(q:string)=>q.startsWith('SELECT CURRENT_USER')?[[{identity:'fixture_worker@10.0.0.0/255.255.255.0'}]]:q==='SHOW GRANTS'?[grants.map(grant=>({grant}))]:q==='SHOW GRANTS FOR PUBLIC'?[publicGrants.map(grant=>({grant}))]:q.includes('APPLICABLE_ROLES')?[role?[{ROLE_NAME:'inherited_role'}]:[]]:[[{ROLE_NAME:null}]]} as unknown as Connection;
}
it('own effective grants can be audited without mysql system table access or returning authentication hashes',async()=>{await expect(verifyWorkerGrants(connection(),schema,'fixture_worker')).resolves.toBeUndefined();});
it('unexpected table/schema/global/routine/proxy/delegation/role/PUBLIC syntax fails closed without raw-grant leakage',async()=>{
 for(const grant of ['GRANT SELECT ON `other`.`secret` TO '+principal,'GRANT SELECT ON `other`.* TO '+principal,'GRANT PROCESS ON *.* TO '+principal,'GRANT EXECUTE ON FUNCTION `other`.`secret` TO '+principal,'GRANT PROXY ON `root`@`%` TO '+principal,'GRANT USAGE ON *.* TO '+principal+' WITH GRANT OPTION','GRANT `some_role` TO '+principal,'UNSUPPORTED MARIADB GRANT *SYNTHETIC_HASH']){
  const error=await verifyWorkerGrants(connection([grant]),schema,'fixture_worker').catch(e=>e);expect(error.message).toBe('Worker effective grants do not match the reviewed profile');expect(error.message).not.toContain('SYNTHETIC');
 }
 await expect(verifyWorkerGrants(connection([],['GRANT SELECT ON *.* TO PUBLIC']),schema,'fixture_worker')).rejects.toThrow('effective grants');await expect(verifyWorkerGrants(connection([],[],true),schema,'fixture_worker')).rejects.toThrow('effective grants');await expect(verifyWorkerGrants(connection(),schema,'wrong_user')).rejects.toThrow('effective grants');
});
