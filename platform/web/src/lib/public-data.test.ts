import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readPublicResponse,requireSuccess,PublicDataError} from './public-data';
import ErrorPage from '../app/error';
const fail=(body:unknown,status=503)=>new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
test('public v1 {error,code} and older structured {error:{code}} envelopes both yield the code',async()=>{
 assert.deepEqual(await readPublicResponse(fail({error:'Service temporarily unavailable',code:'UPSTREAM_UNAVAILABLE'})),{ok:false,status:503,code:'UPSTREAM_UNAVAILABLE'});
 assert.deepEqual(await readPublicResponse(fail({error:{code:'NOT_FOUND'}},404)),{ok:false,status:404,code:'NOT_FOUND'});
});
test('missing, malformed or prose error codes fall back without echoing raw text',async()=>{
 for(const body of [{error:'raw database error private value'},{error:'x',code:'raw private value'},{error:{code:42}},{error:null},{},null,'<html>Bad gateway</html>',''])
  assert.deepEqual(await readPublicResponse(fail(body,502)),{ok:false,status:502,code:'API_UNAVAILABLE'});
});
test('transient 503 during ISR throws instead of becoming a cached success',async()=>{
 const result=await readPublicResponse(fail({error:'Service temporarily unavailable',code:'SERVICE_UNAVAILABLE'}));
 assert.throws(()=>requireSuccess(result),(error:unknown)=>error instanceof PublicDataError&&error.status===503&&error.code==='SERVICE_UNAVAILABLE');
});
test('valid envelope still succeeds; invalid success body is not accepted',async()=>{
 const ok=await readPublicResponse(Response.json({data:{n:1},meta:{schemaVersion:1}}));assert.equal(ok.ok,true);
 assert.deepEqual(await readPublicResponse(Response.json({data:{n:1}})),{ok:false,status:502,code:'INVALID_RESPONSE'});
});
test('error boundary shows Traditional Chinese retry and home link, never raw error or digest',()=>{
 const error=Object.assign(new Error('Public API read failed: 503 secret-detail'),{digest:'DIGEST123'});
 const html=renderToStaticMarkup(createElement(ErrorPage,{error,reset:()=>{}}));
 assert.match(html,/資料暫時無法讀取/);assert.match(html,/重新讀取/);assert.match(html,/href="\/"/);assert.match(html,/role="alert"/);
 assert.doesNotMatch(html,/secret-detail|DIGEST123|503|Public API/);
});
