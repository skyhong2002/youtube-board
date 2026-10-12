import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,link} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {compareBundles,parseLosslessJson,compareTrees,normalizeContentType,legacyPaths,validateManifest,limits,ParityInvalid} from './parity-compare.mjs';
const digest=value=>createHash('sha256').update(value).digest('hex');
const script=fileURLToPath(new URL('./parity-compare.mjs',import.meta.url));
function manifest(name='laravel',cases=[]){return {format:'youtube-board-parity-v1',source:{artifacts:[{sha256:'a'.repeat(64)}],rowFingerprint:'b'.repeat(64)},reader:{name,fingerprint:(name==='laravel'?'c':'d').repeat(64)},clock:'2026-05-24T00:00:00Z',origin:'http://parity.local',cases};}
async function pair(t,left=['{"n":1}'],right=left,contentType='application/json'){
 const root=await mkdtemp(join(tmpdir(),'parity-compare-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const dirs=[join(root,'left'),join(root,'right')],manifests=[],paths=[];
 for(let side=0;side<2;side++){
  await mkdir(dirs[side],{mode:0o700});const rows=[];
  for(const [i,raw]of (side?right:left).entries()){
   const id='case-'+i,bodyFile=id+'.body';await writeFile(join(dirs[side],bodyFile),raw,{mode:0o600});
   rows.push({id,request:'/api/api_live_day.php?videoId=CaseExact01&date=2026-05-24'+(i?'&fixture='+i:''),status:200,contentType,bodyFile,bodySha256:digest(raw)});
  }
  manifests.push(manifest(side?'typescript':'laravel',rows));paths.push(join(dirs[side],'manifest.json'));
 }
 const save=async()=>{for(let i=0;i<2;i++)await writeFile(paths[i],JSON.stringify(manifests[i]),{mode:0o600});};await save();
 return {root,dirs,paths,manifests,save,compare:()=>compareBundles(...paths)};
}
const code=expected=>error=>error instanceof ParityInvalid&&error.code===expected;
test('literal GET allowlist stays equal to all 36 registered public compatibility paths',async()=>{
 const source=await readFile(new URL('../api/src/legacy/index.ts',import.meta.url),'utf8');
 const names=[...source.matchAll(/const (?:live|tags|cloud|channels|ai) = (\[[^\n]+\]);/g)].flatMap(m=>JSON.parse(m[1].replaceAll("'",'"')));
 const expected=[...names,'api_duration','api_get_photo'].map(n=>'/api/'+n+'.php').sort();
 assert.equal(legacyPaths.length,36);assert.deepEqual([...legacyPaths].sort(),expected);
});
test('canonical JSON object order compares equal while reader revisions may differ',async t=>{
 const p=await pair(t,['{"a":1,"b":{"z":null,"x":true}}'],[' { "b":{"x":true,"z":null}, "a":1 }\n']);
 const result=await p.compare();assert.equal(result.result,'equal');assert.equal(result.caseCount,1);assert.equal(result.differenceCount,0);assert.equal(result.externalCalls,0);
});
test('numbers are exact original tokens, never rounded or coerced to strings',()=>{
 for(const [a,b]of [['9007199254740992','9007199254740993'],['1','1.0'],['0','-0'],['1e2','100'],['1e9999','1e9998'],['1','"1"']]){
  const changes=[];compareTrees(parseLosslessJson(a),parseLosslessJson(b),(path,kind)=>changes.push({path,kind}));assert.equal(changes.length,1,a+' / '+b);
 }
 const changes=[];compareTrees(parseLosslessJson('9007199254740993123456789'),parseLosslessJson('9007199254740993123456789'),(...args)=>changes.push(args));assert.equal(changes.length,0);
});
test('null, empty collections, array order, exact IDs and numeric-looking keys stay distinct',async t=>{
 const p=await pair(t,['{"id":"AbC","n":null,"a":[1,2],"o":{},"01":1}'],['{"id":"abc","n":0,"a":[2,1],"o":[],"1":1}']);
 const r=await p.compare();assert.equal(r.result,'different');assert.equal(r.differenceCount,7);assert.equal(r.differentCases,1);
 assert.ok(r.differences.some(d=>d.path==='/body/id'));assert.ok(!JSON.stringify(r).includes('AbC'));
});
test('duplicate decoded keys, malformed JSON, lone surrogates and excessive depth/nodes are invalid',()=>{
 for(const body of ['{"a":1,"a":2}','{"a":1,"\\u0061":2}','{"__proto__":{},"__proto__":{}}'])assert.throws(()=>parseLosslessJson(body),code('JSON_DUPLICATE_KEY'));
 for(const body of ['', '[1,]', '{"a":1,}', '01', '+1', 'NaN', '1e', 'true false', '{"x":"bad\ntext"}'])assert.throws(()=>parseLosslessJson(body),code('JSON_SYNTAX'));
 assert.throws(()=>parseLosslessJson('"\\ud800"'),code('JSON_UNICODE'));
 assert.throws(()=>parseLosslessJson('['.repeat(66)+'0'+']'.repeat(66)),code('JSON_DEPTH'));
 assert.throws(()=>parseLosslessJson('['+Array(limits.nodes).fill('0').join(',')+']'),code('JSON_NODES'));
 assert.throws(()=>parseLosslessJson('0',{nodes:limits.totalNodes}),code('JSON_NODES'));
});
test('identical malformed or duplicate-key bodies never obtain an equal result',async t=>{
 const p=await pair(t,['{"a":1,"a":1}']);await assert.rejects(p.compare,code('JSON_DUPLICATE_KEY'));
 const utf=await pair(t,[Buffer.from([0xff])]);await assert.rejects(utf.compare,code('UTF8_INVALID'));
});
test('media/parameter case, quoting and order normalize; omitted charset remains different',async t=>{
 assert.deepEqual(normalizeContentType('Application/JSON; Charset="UTF-8"; profile="sample"'),normalizeContentType('application/json;profile=sample;charset=utf-8'));
 assert.notDeepEqual(normalizeContentType('text/plain; profile=Case'),normalizeContentType('text/plain; profile=case'));
 for(const bad of ['', 'application/json\nsecret', 'text/plain; x="\x01"', 'text/plain; charset=utf-8; Charset=utf-8','text/plain;wat', 'text/plain; x="unterminated'])assert.throws(()=>normalizeContentType(bad),code('CONTENT_TYPE'));
 const p=await pair(t);p.manifests[1].cases[0].contentType='application/json; charset=utf-8';await p.save();
 assert.deepEqual((await p.compare()).differences,[{caseId:'case-0',path:'/contentType',kind:'content-type'}]);
});
test('text/CSV/HTML bytes, whitespace and newline conventions compare exactly',async t=>{
 for(const media of ['text/plain','text/csv','text/html']){
  const p=await pair(t,['id,value\r\nA,1\r\n'],['id,value\nA,1\n'],media);const r=await p.compare();assert.equal(r.differenceCount,1);assert.equal(r.differences[0].kind,'bytes');
 }
});
test('case order is immaterial, but request bytes and ID sets must match',async t=>{
 const p=await pair(t,['{}','[]']);p.manifests[1].cases.reverse();await p.save();assert.equal((await p.compare()).result,'equal');
 p.manifests[1].cases[0].request+='&different=1';await p.save();await assert.rejects(p.compare,code('CASES_MISMATCH'));
 p.manifests[1].cases.pop();await p.save();await assert.rejects(p.compare,code('CASES_MISMATCH'));
});
test('empty bundles, duplicate cases, unknown fields, excess cases and missing provenance are rejected',async t=>{
 const p=await pair(t);const original=p.manifests[0];
 for(const mutate of [m=>m.cases=[],m=>m.cases.push({...m.cases[0]}),m=>m.method='POST',m=>m.source.artifacts=[],m=>m.source.rowFingerprint='',m=>m.source.rowFingerprint=['b'.repeat(64)],m=>m.reader.fingerprint='',m=>m.reader.name='typescript',m=>m.source.artifacts.push(m.source.artifacts[0]),m=>m.cases=Array(41).fill(m.cases[0])]){
  const changed=structuredClone(original);mutate(changed);assert.throws(()=>validateManifest(changed,'left'),ParityInvalid);
 }
});
test('different artifacts, artifact order, source row fingerprints or frozen clocks invalidate comparison',async t=>{
 for(const change of [m=>m.source.artifacts[0].sha256='f'.repeat(64),m=>m.source.rowFingerprint='f'.repeat(64),m=>m.clock='2026-05-25T00:00:00Z']){
  const p=await pair(t);change(p.manifests[1]);await p.save();await assert.rejects(p.compare,ParityInvalid);
 }
 const p=await pair(t);for(const m of p.manifests)m.source.artifacts.push({sha256:'f'.repeat(64)});p.manifests[1].source.artifacts.reverse();await p.save();await assert.rejects(p.compare,code('SOURCE_MISMATCH'));
});
test('clock/origin validation rejects rollover dates, implicit timezones and arbitrary origins',async t=>{
 const p=await pair(t);
 for(const clock of ['2026-02-30T00:00:00Z','2026-05-24T00:00:00','2026-05-24T08:00:00+08:00','invalid']){const m=structuredClone(p.manifests[0]);m.clock=clock;assert.throws(()=>validateManifest(m,'left'),code('CLOCK'));}
 const m=structuredClone(p.manifests[0]);m.clock='2026-05-24T00:00:00.123Z';assert.doesNotThrow(()=>validateManifest(m,'left'));m.origin='http://user:secret@example.invalid';assert.throws(()=>validateManifest(m,'left'),code('ORIGIN'));
});
test('redirects, nonallowlisted paths, traversal, fragments and method injection cannot be captured contracts',async t=>{
 const p=await pair(t);
 for(const request of ['/api/ops/ingestion','/auth/me','/api/../api/api_tag.php','/api/%61pi_tag.php','//parity.local/api/api_tag.php','https://parity.local/api/api_tag.php','/api/api_tag.php#x','/api/api_tag.php\n','/api\\api_tag.php']){const m=structuredClone(p.manifests[0]);m.cases[0].request=request;assert.throws(()=>validateManifest(m,'left'),ParityInvalid);}
 for(const status of [300,301,302,307,308,399]){const m=structuredClone(p.manifests[0]);m.cases[0].status=status;assert.throws(()=>validateManifest(m,'left'),code('REDIRECT'));}
 const m=structuredClone(p.manifests[0]);m.cases[0].method='POST';assert.throws(()=>validateManifest(m,'left'),code('CASE_SCHEMA'));
});
for(const [kind,tokens]of [
 ['decimal',['200.0','200.5']],
 ['exponent',['2e2','200e0','2E+2']],
 ['rounded fraction',['200.00000000000000001','199.99999999999999999']],
])test(`manifest status rejects ${kind} tokens before numeric conversion`,async t=>{
 const p=await pair(t);
 for(const side of [0,1])for(const token of tokens){
  await p.save();
  await writeFile(p.paths[side],JSON.stringify(p.manifests[side]).replace('"status":200',`"status":${token}`));
  await assert.rejects(p.compare,code('STATUS'),`${kind} token on ${side===0?'left':'right'}`);
 }
});
test('body tampering, manifest key duplication and path escape references fail closed',async t=>{
 const p=await pair(t);await writeFile(join(p.dirs[0],'case-0.body'),'changed secret body');await assert.rejects(p.compare,code('BODY_HASH'));
 const q=await pair(t);q.manifests[0].cases[0].bodyFile='../private';await q.save();await assert.rejects(q.compare,code('BODY_REFERENCE'));
 const r=await pair(t);await writeFile(r.paths[0],JSON.stringify(r.manifests[0]).replace('"format":','"format":"tampered","format":'));await assert.rejects(r.compare,code('JSON_DUPLICATE_KEY'));
});
test('symlinked or hardlinked body/manifest files and nonregular bodies are rejected',async t=>{
 for(const kind of ['symlink','hardlink','directory','manifest']){
  const p=await pair(t),body=join(p.dirs[0],'case-0.body'),target=kind==='manifest'?p.paths[0]:body,copy=join(p.root,'outside');
  await writeFile(copy,await readFile(target),{mode:0o600});await rm(target);
  if(kind==='directory')await mkdir(target);else if(kind==='hardlink')await link(copy,target);else await symlink(copy,target);
  await assert.rejects(p.compare,ParityInvalid);
 }
});
test('body, manifest and combined-byte limits are enforced before unbounded reads',async t=>{
 const big=await pair(t,[Buffer.alloc(limits.bodyBytes+1,32)],undefined,'text/plain');await assert.rejects(big.compare,code('FILE_SIZE'));
 const manifestBig=await pair(t);await writeFile(manifestBig.paths[0],' '.repeat(limits.manifestBytes+1));await assert.rejects(manifestBig.compare,code('FILE_SIZE'));
 const total=await pair(t,Array(9).fill('x'.repeat(limits.bodyBytes)),undefined,'text/plain');await assert.rejects(total.compare,code('FILE_SIZE'));
});
test('diff output has bounded paths/counts, hashes unsafe map keys and never includes response values',async t=>{
 const a=Object.fromEntries(Array.from({length:180},(_,i)=>['key'+i,'private-left'])),b=Object.fromEntries(Object.keys(a).map(k=>[k,'private-right']));
 a['secret?raw-key']='secret-value';b['secret?raw-key']='other-secret';const p=await pair(t,[JSON.stringify(a)],[JSON.stringify(b)]),r=await p.compare();
 assert.equal(r.differenceCount,181);assert.equal(r.differences.length,100);assert.equal(r.differencesTruncated,true);assert.ok(r.differences.every(d=>d.path.length<=limits.pathChars));assert.ok(!JSON.stringify(r).includes('private-'));assert.ok(!JSON.stringify(r).includes('secret'));
 const changes=[];compareTrees(parseLosslessJson('{"unsafe key":1}'),parseLosslessJson('{"unsafe key":2}'),(path,kind)=>changes.push({path,kind}));assert.match(changes[0].path,/\/body\/@key-[a-f0-9]{16}$/);
});
test('matching error responses are reported as errors rather than proof of successful behavior',async t=>{
 const p=await pair(t,['{"error":"unavailable"}']);for(const m of p.manifests)m.cases[0].status=503;await p.save();const r=await p.compare();assert.equal(r.result,'equal');assert.equal(r.errorResponseCases,1);
});
test('CLI emits sanitized structured results and distinct equality/difference/invalid exit statuses',async t=>{
 const p=await pair(t),run=(args=p.paths)=>spawnSync(process.execPath,[script,...args],{encoding:'utf8',timeout:10000,env:{PATH:process.env.PATH,DATABASE_URL:'do-not-read',HTTP_PROXY:'http://do-not-contact.invalid'}});
 let r=run();assert.equal(r.status,0);assert.equal(JSON.parse(r.stdout).result,'equal');assert.equal(r.stderr,'');
 p.manifests[1].cases[0].status=404;await p.save();r=run();assert.equal(r.status,1);assert.equal(JSON.parse(r.stdout).result,'different');
 r=run([join(p.root,'sensitive-path-not-in-output'),p.paths[1]]);assert.equal(r.status,2);assert.equal(JSON.parse(r.stdout).result,'invalid');assert.ok(!r.stdout.includes(p.root));assert.ok(!r.stdout.includes('sensitive'));assert.equal(r.stderr,'');
 r=run([]);assert.equal(r.status,2);assert.equal(JSON.parse(r.stdout).error.code,'ARGUMENTS');
});
