import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {accountFetch,AccountError,accountMessage,isAccountSession,loginHref,safeNext,commandId} from './account-client';
import type {AccountSession} from '../../../shared/account-contracts';
import ReaderGate from '../app/my/ReaderGate';
import LoginPanel from '../app/login/LoginPanel';
const session:AccountSession={enabled:true,user:{id:1,email:'reader@example.test',name:'讀者',picture:null,role:'reader',adminSource:null},csrfToken:'test-csrf-token'};
test('private API writes use same-origin credentials and CSRF, never URL or bearer tokens',async()=>{
 const calls:{path:string;init:RequestInit|undefined}[]=[];const fetcher=(async(path,init)=>{calls.push({path:String(path),init});return Response.json({saves:[],max:500});}) as typeof fetch;
 await accountFetch('/auth/me/saves',session,{method:'PUT',body:{kind:'video',target:'abcdefghijk',saved:true,note:'註記'}},fetcher);
 assert.equal(calls[0].path,'/auth/me/saves');assert.equal(calls[0].init?.credentials,'same-origin');assert.equal(calls[0].init?.cache,'no-store');assert.equal(new Headers(calls[0].init?.headers).get('x-csrf-token'),'test-csrf-token');assert.equal(new Headers(calls[0].init?.headers).has('authorization'),false);assert.doesNotMatch(calls[0].init?.body as string,/csrf/);
 await accountFetch('/auth/me/feed-token',session,{},fetcher);assert.equal(new Headers(calls[1].init?.headers).has('x-csrf-token'),false);
});
test('private write and arbitrary destination fail before any fetch; server errors cannot echo raw data',async()=>{
 let calls=0;const fetcher=(async()=>{calls++;return Response.json({error:{code:'raw database error private value'}} ,{status:500});}) as typeof fetch;
 await assert.rejects(accountFetch('/auth/me/saves',null,{method:'PUT'},fetcher),{code:'SIGN_IN_REQUIRED'});await assert.rejects(accountFetch('https://example.test/auth/me',session,{},fetcher),{code:'INVALID_REQUEST'});assert.equal(calls,0);
 await assert.rejects(accountFetch('/auth/me/saves',session,{},fetcher),error=>error instanceof AccountError&&!error.message.includes('private value'));assert.equal(accountMessage(new Error('sensitive text')),'操作暫時無法完成，請稍後重試。');
 const expired=(async()=>Response.json({error:{code:'SIGN_IN_REQUIRED'}},{status:401})) as typeof fetch;await assert.rejects(accountFetch('/auth/me/saves',session,{},expired),{code:'SIGN_IN_REQUIRED'});
});
test('session wire validation distinguishes disabled, signed out and verified session',()=>{
 assert.equal(isAccountSession(session),true);assert.equal(isAccountSession({enabled:false,user:null,csrfToken:null}),true);assert.equal(isAccountSession({enabled:true,user:null,csrfToken:null}),true);
 for(const value of [{},null,{enabled:true,csrfToken:null},{...session,enabled:false},{...session,csrfToken:null},{...session,user:{...session.user,id:9007199254740992}}])assert.equal(isAccountSession(value),false);
});
test('login next stays local and login/gates SSR contain no private session data',()=>{
 for(const path of ['https://outside.test','//outside.test','/\\outside.test','/auth/google','/auth/me?x=1','/a\n'])assert.equal(safeNext(path),'/my');
 assert.equal(new URL(loginHref('/keywords/交通/videos?days=7'),'https://youtube.observe.tw').searchParams.get('next'),'/keywords/交通/videos?days=7');
 const gate=renderToStaticMarkup(createElement(ReaderGate,{next:'/my',children:'private account data'}));assert.match(gate,/載入中/);assert.doesNotMatch(gate,/private account data/);
 const panel=renderToStaticMarkup(createElement(LoginPanel,{error:'raw-provider-detail'}));assert.match(panel,/登入未完成/);assert.doesNotMatch(panel,/raw-provider-detail|test-csrf-token|reader@example/);
});

test('editorial local HTTP request IDs use crypto bytes with UUID4 version and variant',()=>{
 const source={getRandomValues:(bytes:Uint8Array)=>{bytes.fill(0xab);return bytes;},randomUUID:undefined} as unknown as Crypto;
 assert.equal(commandId(source),'abababab-abab-4bab-abab-abababababab');assert.match(commandId(),/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('actual editorial workflow errors provide safe recovery guidance rather than raw server detail',()=>{
 for(const [code,expected] of [['PREVIEW_CHANGED',/重新載入後再預覽/],['EXECUTION_GATED',/未開放執行/],['REQUEST_ID_CONFLICT',/請求編號.*另一項異動/],['EVENT_MERGED',/合併後的事件/],['CANDIDATE_ALREADY_DECIDED',/已完成審核/],['REFRESH_UNCHANGED',/沒有變更/]])assert.match(accountMessage(new AccountError(code as string)),expected as RegExp);
 assert.equal(accountMessage(new AccountError('unknown-provider-or-sql-detail')),'操作暫時無法完成，請稍後重試。');
});
