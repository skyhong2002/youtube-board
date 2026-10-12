import test from 'node:test';
import assert from 'node:assert/strict';
import {request} from 'node:http';
import {connect} from 'node:net';
import {createMaintenanceServer} from '../runtime/account-maintenance.mjs';

async function fixture(t){
 const server=createMaintenanceServer();
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 return server.address().port;
}
function get(port,path,method='GET'){
 return new Promise((resolve,reject)=>{
  const req=request({hostname:'127.0.0.1',port,path,method},res=>{
   const chunks=[];res.on('data',chunk=>chunks.push(chunk));
   res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString()}));
  });req.on('error',reject);req.end();
 });
}
test('rollback responder denies every private path and method without echoing URL secrets',async t=>{
 const port=await fixture(t);
 for(const path of ['/auth','/auth/google/callback?code=not-a-real-code','/auth/me','/feeds/u','/feeds/u/not-a-real-token.xml','/api/ops/editorial','/api/ops/editorial/execute']){
  for(const method of ['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS','TRACE']){
   const r=await get(port,path,method);
   assert.equal(r.status,503);assert.equal(r.headers['cache-control'],'private, no-store');
   assert.equal(r.headers['retry-after'],'300');assert.equal(r.headers['x-robots-tag'],'noindex');
   assert.equal(r.headers['referrer-policy'],'no-referrer');assert.equal(r.headers.location,undefined);
   assert.equal(r.headers['set-cookie'],undefined);
   assert.equal(r.body.includes('not-a-real'),false);
   if(method==='HEAD')assert.equal(r.body,'');else assert.equal(JSON.parse(r.body).error.code,'ACCOUNT_MAINTENANCE');
  }
 }
});
test('exact GET/HEAD probes work with runtime Docker healthcheck and nothing else bypasses',async t=>{
 const port=await fixture(t);
 for(const path of ['/up','/healthz','/runtime/ready']){
  assert.equal((await get(port,path)).status,200);
  assert.equal((await get(port,path,'HEAD')).status,200);
  assert.equal((await get(port,path,'POST')).status,503);
  assert.equal((await get(port,path+'?redirect=/auth')).status,503);
 }
 for(const path of ['/','/unknown','/%61uth/me','//auth/me'])assert.equal((await get(port,path)).status,503);
});
test('CONNECT and WebSocket upgrades cannot bypass maintenance',async t=>{
 const port=await fixture(t);
 for(const line of ['CONNECT /auth HTTP/1.1\r\nHost: local\r\n\r\n','GET /auth HTTP/1.1\r\nHost: local\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n']){
  const response=await new Promise((resolve,reject)=>{
   const socket=connect(port,'127.0.0.1',()=>socket.write(line));let result='';
   socket.setTimeout(2000,()=>socket.destroy(new Error('Socket deadline')));
   socket.on('data',chunk=>{result+=chunk;});socket.on('error',reject);socket.on('end',()=>resolve(result));
  });
  assert.match(response,/^HTTP\/1\.1 503 /);assert.match(response,/Cache-Control: private, no-store/);
  assert.doesNotMatch(response,/101 Switching|200 Connection/);
 }
});
