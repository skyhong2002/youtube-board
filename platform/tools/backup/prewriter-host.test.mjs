import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,readdirSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const script=fileURLToPath(new URL('./prewriter-host.sh',import.meta.url));
const run=(args,env={})=>spawnSync('bash',[script,...args],{encoding:'utf8',env:{PATH:process.env.PATH,...env}});
test('host preview makes no Docker or credential request',()=>{const r=run(['--preview']);assert.equal(r.status,0);assert.equal(JSON.parse(r.stdout).serviceUpdates,0);});
test('execution requires pause, manual freeze, account maintenance and absent TS writer acknowledgements',()=>{const gates=['BACKUP_PAUSE_APPROVED','BACKUP_MANUAL_WRITERS_FROZEN','BACKUP_ACCOUNTS_MAINTENANCE_CONFIRMED','BACKUP_TS_WRITERS_STOPPED'];for(const omitted of gates){const env=Object.fromEntries(gates.filter(g=>g!==omitted).map(g=>[g,'true']));assert.equal(run(['--execute'],env).status,2,omitted);}});
function fixture(fn){
 const base=mkdtempSync(path.join(tmpdir(),'yt-prewriter-host-')),bin=path.join(base,'bin'),root=path.join(base,'private');mkdirSync(bin);mkdirSync(root,{mode:0o700});
 const log=path.join(base,'calls'),state=path.join(base,'state');writeFileSync(state,'S');
 const executable=(name,text)=>{const p=path.join(bin,name);writeFileSync(p,'#!/usr/bin/env bash\nset -eu\n'+text);chmodSync(p,0o700);};
 executable('ps','if [[ "$*" == *comm=* ]]; then echo sh; else cat "$MOCK_STATE"; fi\n');
 executable('systemd-run','echo "timer-register" >> "$MOCK_LOG"\n[[ ${MOCK_FAIL:-} != timer ]]\n');
 executable('systemctl',String.raw`
echo "systemctl $*" >> "$MOCK_LOG"
if [[ "$1" == stop ]]; then
 if [[ "$MOCK_FAIL" == after_resume_kill ]]; then
  controller=$(awk '{print $4}' "/proc/$PPID/stat")
  kill -KILL "$controller"
  exit 1
 fi
 [[ "$MOCK_FAIL" != cancel_timeout ]] || exit 124
 touch "$MOCK_STATE.timer-inactive"
 [[ "$MOCK_FAIL" != cancel_not_loaded ]] || exit 1
 [[ "$MOCK_FAIL" != cancel_not_loaded_5 ]] || exit 5
elif [[ "$1" == show ]]; then
 [[ "$MOCK_FAIL" != cancel_transport ]] || exit 1
 if [[ "$MOCK_FAIL" == cancel_unknown ]]; then echo unknown
 elif [[ "$MOCK_FAIL" == cancel_active && "$2" == *.service ]]; then printf 'LoadState=loaded\nActiveState=active\n'
 elif [[ ( "$MOCK_FAIL" == cancel_not_loaded || "$MOCK_FAIL" == cancel_not_loaded_5 ) && "$2" == *.service ]]; then printf 'LoadState=not-found\nActiveState=inactive\n'
 else printf 'LoadState=loaded\nActiveState=inactive\n'; fi
elif [[ "$1" == is-active ]]; then
 if [[ "$MOCK_FAIL" == watchdog_first && ! -f "$MOCK_STATE.watchdog-triggered" ]]; then
  touch "$MOCK_STATE.watchdog-triggered"
  operation=$(cat "$BACKUP_HOST_ROOT/.prewriter-active/operation")
  bash "$MOCK_SCRIPT" --watchdog-resume "$operation"
 fi
 [[ ! -f "$MOCK_STATE.timer-inactive" ]] || exit 3
fi
`);
 executable('docker',String.raw`
echo "docker $1 $2" >> "$MOCK_LOG"
case "$1" in
 ps) if [[ "$*" == *scheduler* ]]; then echo aaaaaaaaaaaa; else echo bbbbbbbbbbbb; fi;;
 inspect) if [[ "$*" == *State.Pid* ]]; then echo 12345; else if [[ "$MOCK_FAIL" == drift && -f "$MOCK_STATE.config" ]]; then echo 'CHANGED-PRIVATE-CONFIG'; else echo 'PRIVATE-CONFIG'; touch "$MOCK_STATE.config"; fi; fi;;
 service) echo 'PRIVATE-SERVICE-SPEC';;
 kill) if [[ "$*" == *STOP* ]]; then if [[ "$MOCK_FAIL" != stop_ignored ]]; then echo T > "$MOCK_STATE"; fi; else [[ "$MOCK_FAIL" != resume ]]; echo S > "$MOCK_STATE"; fi;;
 top)
 case "$MOCK_FAIL" in
  watchdog_drain) operation=$(cat "$BACKUP_HOST_ROOT/.prewriter-active/operation"); bash "$MOCK_SCRIPT" --watchdog-resume "$operation"; printf 'PID STAT COMMAND\n12345 T sh\n12346 S sleep\n';;
  top_zombie) printf 'PID STAT COMMAND\n12345 T sh\n12347 Z php <defunct>\n';;
  top_running) counter=0; [[ ! -f "$MOCK_STATE.top-count" ]] || read -r counter < "$MOCK_STATE.top-count"; counter=$((counter+1)); echo "$counter" > "$MOCK_STATE.top-count"; if [[ $counter == 1 ]]; then stat=R; elif [[ $counter == 2 ]]; then stat=S; else stat=Z; fi; printf 'PID STAT COMMAND\n12345 T sh\n12347 %s php\n' "$stat";;
  top_bad_defunct) printf 'PID STAT COMMAND\n12345 T sh\n12347 Z php unexpected\n';;
  top_live_defunct) printf 'PID STAT COMMAND\n12345 T sh\n12347 S php <defunct>\n';;
  top_missing_stat) printf 'PID STAT COMMAND\n12345 T sh\n12347 php\n';;
  top_bad_stat) printf 'PID STAT COMMAND\n12345 T sh\n12347 garbage php\n';;
  top_init_running) printf 'PID STAT COMMAND\n12345 S sh\n';;
  top_empty) :;;
  top_header) printf 'PID CMD\n12345 T sh\n';;
  top_missing_init) printf 'PID STAT COMMAND\n12346 S sleep\n';;
  top_duplicate_init) printf 'PID STAT COMMAND\n12345 T sh\n12345 T sh\n';;
  top_duplicate_child) printf 'PID STAT COMMAND\n12345 T sh\n12346 S sleep\n12346 S sleep\n';;
  top_malformed) printf 'PID STAT COMMAND\n12345 T sh\nnot-a-pid S sleep\n';;
  top_changed_init) printf 'PID STAT COMMAND\n12345 T php\n';;
  *) printf 'PID STAT COMMAND\n12345 T sh\n12346 S sleep\n';;
 esac;;
 exec)
 if [[ "$*" == *information_schema* ]]; then echo 1000
 elif [[ "$3" == df && "$MOCK_FAIL" == disk ]]; then printf 'Filesystem 1B-blocks Used Available Use%% Mounted\nmock 9999999999 1 1 100%% /tmp\n'
 elif [[ "$3" == df ]]; then printf 'Filesystem 1B-blocks Used Available Use%% Mounted\nmock 9999999999 1 9999999998 1%% /tmp\n'
 elif [[ "$*" == *' probe '* ]]; then [[ "$MOCK_FAIL" != backup ]]; echo lock-released-probe >> "$MOCK_LOG"
 else [[ "$MOCK_FAIL" != backup ]]; sleep .1; echo compression-complete >> "$MOCK_LOG"
 fi;;
 cp) if [[ "$2" == *:/tmp/yt-prewriter-backup-* ]]; then mkdir "$3"; touch "$3/COMPLETE"; printf 'fixture' > "$3/database.sql.gz"; printf 'youtube_board\nyoutube_board_ts\n' > "$3/schemas.tsv"; (cd "$3"; sha256sum database.sql.gz > archive.sha256; sha256sum schemas.tsv > manifests.sha256); fi;;
esac
`);
 const env={PATH:bin+':'+process.env.PATH,BACKUP_PAUSE_APPROVED:'true',BACKUP_MANUAL_WRITERS_FROZEN:'true',BACKUP_ACCOUNTS_MAINTENANCE_CONFIRMED:'true',BACKUP_TS_WRITERS_STOPPED:'true',BACKUP_HOST_ROOT:root,BACKUP_TOOL_PATH:script,MOCK_LOG:log,MOCK_STATE:state,MOCK_FAIL:'',MOCK_SCRIPT:script};
 try{fn({base,root,log,state,env});}finally{rmSync(base,{recursive:true,force:true});}
}
test('host backup resumes scheduler and preserves fingerprints before artifact acceptance',()=>fixture(({root,log,state,env})=>{
 const r=run(['--execute'],env);assert.equal(r.status,0,r.stdout+r.stderr);const dir=readdirSync(root).find(n=>/^\d{8}T/.test(n));assert.ok(existsSync(path.join(root,dir,'HOST_COMPLETE')));assert.ok(existsSync(path.join(root,dir,'CAPTURE_RESUMED')));assert.equal(readFileSync(state,'utf8').trim(),'S');assert.ok(!existsSync(path.join(root,'.prewriter-active')));const calls=readFileSync(log,'utf8');assert.match(calls,/timer-register[\s\S]*docker kill --signal=STOP[\s\S]*docker exec[\s\S]*docker kill --signal=CONT/);assert.doesNotMatch(r.stdout+r.stderr,/PRIVATE/);assert.match(calls,/lock-released-probe[\s\S]*docker kill --signal=CONT[\s\S]*compression-complete/);
}));
test('backup failure resumes scheduler and never accepts artifact',()=>fixture(({root,state,env})=>{
 const r=run(['--execute'],{...env,MOCK_FAIL:'backup'});assert.equal(r.status,1);assert.equal(readFileSync(state,'utf8').trim(),'S');const dir=readdirSync(root).find(n=>/^\d{8}T/.test(n));assert.ok(existsSync(path.join(root,dir,'HOST_INVALID')));assert.ok(!existsSync(path.join(root,dir,'HOST_COMPLETE')));assert.ok(!existsSync(path.join(root,dir,'CAPTURE_RESUMED')));
}));
test('timer registration failure never pauses scheduler',()=>fixture(({log,env})=>{const r=run(['--execute'],{...env,MOCK_FAIL:'timer'});assert.equal(r.status,1);assert.doesNotMatch(readFileSync(log,'utf8'),/--signal=STOP/);}));
test('durable lease rejects a second operation before Docker access',()=>fixture(({root,log,env})=>{mkdirSync(path.join(root,'.prewriter-active'));const r=run(['--execute'],env);assert.equal(r.status,1);assert.ok(!existsSync(log));}));
test('independent watchdog resumes exact original PID and invalidates interrupted operation',()=>fixture(({root,state,env})=>{
 const op=path.join(root,'fixture');mkdirSync(op);writeFileSync(path.join(op,'scheduler.id'),'aaaaaaaaaaaa\n');writeFileSync(path.join(op,'scheduler.pid'),'12345\n');mkdirSync(path.join(root,'.prewriter-active'));writeFileSync(path.join(root,'.prewriter-active/operation'),op+'\n');writeFileSync(state,'T');const r=run(['--watchdog-resume',op],env);assert.equal(r.status,0,r.stderr);assert.ok(existsSync(path.join(op,'WATCHDOG_FIRED')));assert.ok(existsSync(path.join(op,'HOST_INVALID')));assert.equal(readFileSync(state,'utf8').trim(),'S');assert.ok(!existsSync(path.join(root,'.prewriter-active')));
}));
test('watchdog refuses to signal a replacement init process and retains lease',()=>fixture(({root,log,env})=>{
 const op=path.join(root,'fixture');mkdirSync(op);writeFileSync(path.join(op,'scheduler.id'),'aaaaaaaaaaaa\n');writeFileSync(path.join(op,'scheduler.pid'),'99999\n');mkdirSync(path.join(root,'.prewriter-active'));writeFileSync(path.join(root,'.prewriter-active/operation'),op+'\n');const r=run(['--watchdog-resume',op],env);assert.equal(r.status,1);assert.doesNotMatch(readFileSync(log,'utf8'),/docker kill/);assert.ok(existsSync(path.join(root,'.prewriter-active')));
}));

test('configuration drift fails acceptance without replacing image or env',()=>fixture(({root,state,env})=>{const r=run(['--execute'],{...env,MOCK_FAIL:'drift'});assert.equal(r.status,1);assert.equal(readFileSync(state,'utf8').trim(),'S');const dir=readdirSync(root).find(n=>/^\d{8}T/.test(n));assert.ok(existsSync(path.join(root,dir,'HOST_INVALID')));assert.ok(!existsSync(path.join(root,dir,'HOST_COMPLETE')));}));
test('failed resume preserves durable lease and independent watchdog',()=>fixture(({root,log,env})=>{const r=run(['--execute'],{...env,MOCK_FAIL:'resume'});assert.equal(r.status,1);assert.ok(existsSync(path.join(root,'.prewriter-active')));assert.doesNotMatch(readFileSync(log,'utf8'),/systemctl stop/);}));

test('insufficient DB temporary disk prevents watchdog registration and STOP',()=>fixture(({log,env})=>{const r=run(['--execute'],{...env,MOCK_FAIL:'disk'});assert.equal(r.status,1);const calls=readFileSync(log,'utf8');assert.doesNotMatch(calls,/timer-register|--signal=STOP/);}));

test('unexpected Docker top output fails closed and resumes before any dump',()=>{for(const failure of ['top_empty','top_header','top_missing_init','top_duplicate_init','top_duplicate_child','top_malformed','top_changed_init','top_missing_stat','top_bad_stat','top_init_running','top_bad_defunct','top_live_defunct'])fixture(({log,state,env})=>{const r=run(['--execute'],{...env,MOCK_FAIL:failure});assert.equal(r.status,1,failure);assert.equal(readFileSync(state,'utf8').trim(),'S',failure);assert.doesNotMatch(readFileSync(log,'utf8'),/compression-complete|lock-released-probe/,failure);});});

test('controller SIGKILL after CONT keeps lease until watchdog recovery and blocks a successor',()=>fixture(({root,log,state,env})=>{
 const killed=run(['--execute'],{...env,MOCK_FAIL:'after_resume_kill'});assert.equal(killed.signal,'SIGKILL');assert.equal(readFileSync(state,'utf8').trim(),'S');assert.ok(existsSync(path.join(root,'.prewriter-active')));const operation=readFileSync(path.join(root,'.prewriter-active/operation'),'utf8').trim();const before=readFileSync(log,'utf8');const blocked=run(['--execute'],env);assert.equal(blocked.status,1);assert.equal(readFileSync(log,'utf8'),before);const recovered=run(['--watchdog-resume',operation],env);assert.equal(recovered.status,0);assert.ok(!existsSync(path.join(root,'.prewriter-active')));
}));
test('stale watchdog cannot CONT a successor sharing the same scheduler',()=>fixture(({root,log,state,env})=>{
 const old=path.join(root,'old'),current=path.join(root,'current');mkdirSync(old);mkdirSync(current);writeFileSync(path.join(old,'scheduler.id'),'aaaaaaaaaaaa\n');writeFileSync(path.join(old,'scheduler.pid'),'12345\n');mkdirSync(path.join(root,'.prewriter-active'));writeFileSync(path.join(root,'.prewriter-active/operation'),current+'\n');writeFileSync(state,'T');const stale=run(['--watchdog-resume',old],env);assert.equal(stale.status,0);assert.equal(readFileSync(state,'utf8'),'T');assert.ok(!existsSync(log));assert.equal(readFileSync(path.join(root,'.prewriter-active/operation'),'utf8').trim(),current);
}));
test('watchdog before STOP revokes lease and prevents late controller STOP',()=>fixture(({log,state,env})=>{const r=run(['--execute'],{...env,MOCK_FAIL:'watchdog_first'});assert.equal(r.status,1);assert.doesNotMatch(readFileSync(log,'utf8'),/--signal=STOP/);assert.equal(readFileSync(state,'utf8').trim(),'S');}));

test('successful STOP transport without observed stopped state aborts before drain or dump',()=>fixture(({log,env})=>{const r=run(['--execute'],{...env,MOCK_FAIL:'stop_ignored'});assert.equal(r.status,1);assert.doesNotMatch(readFileSync(log,'utf8'),/docker top|compression-complete/);}));

test('watchdog during drain revokes backup launch even with valid process output',()=>fixture(({log,state,env})=>{const r=run(['--execute'],{...env,MOCK_FAIL:'watchdog_drain'});assert.equal(r.status,1);assert.equal(readFileSync(state,'utf8').trim(),'S');assert.doesNotMatch(readFileSync(log,'utf8'),/compression-complete|lock-released-probe/);}));

test('finished zombie provider children are drained while original init remains stopped',()=>fixture(({env})=>{const r=run(['--execute'],{...env,MOCK_FAIL:'top_zombie'});assert.equal(r.status,0,r.stdout+r.stderr);}));
test('running and sleeping provider children remain active until they become zombies',()=>fixture(({state,env})=>{const r=run(['--execute'],{...env,MOCK_FAIL:'top_running'});assert.equal(r.status,0,r.stdout+r.stderr);assert.equal(readFileSync(state+'.top-count','utf8').trim(),'3');}));

test('private operation pointer identifies the exact successful capture notification',()=>fixture(({root,env})=>{const pointer=path.join(root,'exact.operation');const r=run(['--execute'],{...env,BACKUP_OPERATION_RECORD:pointer});assert.equal(r.status,0,r.stdout+r.stderr);const op=readFileSync(pointer,'utf8').trim();assert.ok(op.startsWith(root+'/'));assert.ok(existsSync(path.join(op,'CAPTURE_RESUMED')));assert.ok(existsSync(path.join(op,'scheduler-resumed')));}));

test('unstarted transient service stop exit1 is accepted only with explicit inactive/not-found proof',()=>fixture(({root,env})=>{const r=run(['--execute'],{...env,MOCK_FAIL:'cancel_not_loaded'});assert.equal(r.status,0,r.stdout+r.stderr);assert.ok(!existsSync(path.join(root,'.prewriter-active')));}));
test('active,unknown,transport-failed or timed-out cancellation retains adapter lease',()=>{for(const failure of ['cancel_active','cancel_unknown','cancel_transport','cancel_timeout'])fixture(({root,env})=>{const r=run(['--execute'],{...env,MOCK_FAIL:failure});assert.equal(r.status,1,failure);assert.ok(existsSync(path.join(root,'.prewriter-active')),failure);});});

test('actual host not-found stop exit5 requires and accepts explicit per-unit inactive proof',()=>fixture(({root,env})=>{const r=run(['--execute'],{...env,MOCK_FAIL:'cancel_not_loaded_5'});assert.equal(r.status,0,r.stdout+r.stderr);assert.ok(!existsSync(path.join(root,'.prewriter-active')));}));
