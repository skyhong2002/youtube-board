import {test} from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
test('review transport redacts URLs and secret-bearing assignments before transmission',()=>{const input=`mysql://user:fixture-password@db/schema\nAuthorization: Bearer fixture-token\nTS_OPS_TOKEN='fixture-ops'\n{"GOOGLE_CLIENT_SECRET":"fixture-secret"}\nAUTH_SESSION_SECRET=fixture-session\nplain evidence retained`;const r=spawnSync('python3',['tools/review-redact.py'],{input,encoding:'utf8'});assert.equal(r.status,0);for(const secret of ['fixture-password','fixture-token','fixture-ops','fixture-secret','fixture-session'])assert.ok(!r.stdout.includes(secret));assert.ok(r.stdout.includes('plain evidence retained'));});
test('bare and camelcase secret keys redact complete quoted scalars including escapes and multiline values',()=>{
 const input=String.raw`TOKEN=fixture-bare-token
password: fixture-bare-password
{"secret":"fixture-quoted-secret","opsToken":"fixture-camel-token"}
API_KEY="fixture-escaped\"quote-tail"
CLIENT_SECRET='fixture-single\'tail'
AUTH_SESSION_SECRET="""fixture-multiline
fixture-second-line"""
const TOKEN = \`fixture-template\`;
const evidence = "retained title";`;
 const r=spawnSync('python3',['tools/review-redact.py'],{input,encoding:'utf8'});assert.equal(r.status,0,r.stderr);
 for(const value of ['fixture-bare-token','fixture-bare-password','fixture-quoted-secret','fixture-camel-token','fixture-escaped','quote-tail','fixture-single','fixture-multiline','fixture-second-line'])assert.ok(!r.stdout.includes(value),value);
 assert.ok(r.stdout.includes('retained title'));
});
test('PEM is removed while unquoted executable camelcase expressions remain reviewable',()=>{const input="-----BEGIN PRIVATE KEY-----\nfixture-private-material\n-----END PRIVATE KEY-----\nconst clientSecret=env.GOOGLE_CLIENT_SECRET;\nconst sessionToken=(request)=>readCookie(request);";const r=spawnSync('python3',['tools/review-redact.py'],{input,encoding:'utf8'});assert.equal(r.status,0);assert.ok(!r.stdout.includes('fixture-private-material'));assert.ok(r.stdout.includes('clientSecret=env.GOOGLE_CLIENT_SECRET'));assert.ok(r.stdout.includes('sessionToken=(request)=>readCookie(request)'));});
