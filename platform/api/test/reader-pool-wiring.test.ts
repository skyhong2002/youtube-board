import {it,expect,vi} from 'vitest';
import Fastify from 'fastify';
import type {AuthRuntime} from '../src/auth/types.js';
const mocks=vi.hoisted(()=>({store:vi.fn(),reader:vi.fn()}));
vi.mock('../src/reader/store.js',()=>({mysqlAccountStore:mocks.store}));
vi.mock('../src/db/client.js',async importOriginal=>({...await importOriginal<typeof import('../src/db/client.js')>(),createReader:mocks.reader}));
import {registerReaderAccounts} from '../src/reader/routes.js';
it('private reader queries and mutations use own-state credentials, not public report credentials',async()=>{
 const store={ready:async()=>true,close:vi.fn(async()=>{}),feedStatus:vi.fn(async()=>null)},reader={rows:vi.fn(async()=>[]),close:vi.fn(async()=>{})};mocks.store.mockReturnValue(store);mocks.reader.mockReturnValue(reader);
 const user={id:1,email:'fixture@example.invalid',name:null,picture:null,role:'reader' as const,adminSource:null};
 const auth:AuthRuntime={enabled:true,origin:'https://youtube.observe.tw',currentUser:async()=>user,requireReader:async()=>user,requireAdmin:async()=>null,actor:u=>'user:'+u.id};
 const app=Fastify();await registerReaderAccounts(app,auth,{databaseUrl:'mysql://own-state-fixture/new_schema'});
 try{expect(mocks.store).toHaveBeenCalledWith('mysql://own-state-fixture/new_schema');expect(mocks.reader).toHaveBeenCalledWith('mysql://own-state-fixture/new_schema');expect((await app.inject('/auth/me/feed-token')).json()).toEqual({active:false,createdAt:null});expect(store.feedStatus).toHaveBeenCalledWith(1);}finally{await app.close();}
 expect(store.close).toHaveBeenCalledOnce();expect(reader.close).toHaveBeenCalledOnce();
});
