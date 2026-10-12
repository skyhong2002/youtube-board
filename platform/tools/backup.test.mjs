import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url)),script=path.join(root,'backup/consistent-logical.sh'),compare=path.join(root,'backup/compare-manifests.py');
const files=['runtime.tsv','database.tsv','tables.tsv','rows.tsv','ddl.tsv','checksums.tsv','triggers.tsv','routines.tsv','routine-ddl.tsv','events.tsv','event-ddl.tsv'];
const bash=(...args)=>spawnSync('bash',[script,...args],{encoding:'utf8',env:{PATH:process.env.PATH}});
test('backup preview requires no credentials, output path or database process',()=>{
 const result=bash('--preview');assert.equal(result.status,0);assert.deepEqual(JSON.parse(result.stdout),{mode:'preview',method:'bounded-ftwrl-logical',writes:0,locks:0});
});
test('backup rejects unsafe, system, duplicate and excessive schema inventories before accessing a database',()=>{
 for(const schemas of [[],['mysql'],['MYSQL'],['sys'],['source','SOURCE'],['bad/name'],['one','one'],['a'.repeat(65)],Array.from({length:9},(_,i)=>'schema'+i)]){
  const result=bash('--execute',...schemas.map(s=>'--database='+s),'--output=/tmp/never-create-backup-validation');assert.equal(result.status,2,JSON.stringify(schemas));
 }
});
test('backup rejects ambiguous or unknown multi-schema checksums before accessing a database',()=>{
 for(const checksums of ['table','third.table','source.bad.name']){
  const result=spawnSync('bash',[script,'--execute','--database=source','--database=state','--output=/tmp/never-create-backup-validation'],{encoding:'utf8',env:{PATH:process.env.PATH,BACKUP_CHECKSUM_TABLES:checksums}});assert.equal(result.status,2);
 }
});
function fixture(base,names){mkdirSync(base);if(names)writeFileSync(path.join(base,'schemas.tsv'),names.join('\n')+'\n');for(const schema of names?.length>1?names:[null]){const dir=schema?path.join(base,'manifests',schema):base;mkdirSync(dir,{recursive:true});for(const file of files)writeFileSync(path.join(dir,file),'same fixture\n');}}
function withPair(callback){const temp=mkdtempSync(path.join(tmpdir(),'backup-compare-test-'));try{callback(path.join(temp,'source'),path.join(temp,'restored'));}finally{rmSync(temp,{recursive:true,force:true});}}
const cmp=(source,restored)=>spawnSync('python3',[compare,source,restored],{encoding:'utf8'});
test('comparator checks all eleven manifests per schema including dependent facade',()=>withPair((source,restored)=>{
 fixture(source,['source','state','facade']);fixture(restored,['source','state','facade']);const result=cmp(source,restored);assert.equal(result.status,0);assert.match(result.stdout,/files=33 schemas=3/);
 writeFileSync(path.join(restored,'manifests/state/rows.tsv'),'changed private data\n');const failed=cmp(source,restored);assert.equal(failed.status,1);assert.match(failed.stdout,/state\/rows.tsv:different/);assert.doesNotMatch(failed.stdout,/changed private data/);
}));
test('comparator rejects reordered/malformed inventories and missing secondary manifests',()=>withPair((source,restored)=>{
 fixture(source,['source','state']);fixture(restored,['state','source']);assert.equal(cmp(source,restored).status,1);
 writeFileSync(path.join(restored,'schemas.tsv'),'source\n../state\n');assert.equal(cmp(source,restored).status,1);
 writeFileSync(path.join(restored,'schemas.tsv'),'source\nstate\n');rmSync(path.join(restored,'manifests/state/events.tsv'));assert.equal(cmp(source,restored).status,1);
}));
test('single-schema backups retain compatibility with original eleven flat manifests',()=>withPair((source,restored)=>{
 fixture(source,null);fixture(restored,['source']);const result=cmp(source,restored);assert.equal(result.status,0);assert.match(result.stdout,/files=11 schemas=1/);
}));

test('comparator rejects symlink inventory, manifest directory, schema directory, leaf and root',()=>{
 for(const target of ['schemas.tsv','manifests','manifests/state','manifests/state/rows.tsv','.'])withPair((source,restored)=>{
  fixture(source,['source','state']);fixture(restored,['source','state']);const linked=path.join(restored,target);rmSync(linked,{recursive:true,force:true});symlinkSync(path.join(source,target),linked);assert.equal(cmp(source,restored).status,1,target);
 });
});
